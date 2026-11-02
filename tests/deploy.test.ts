import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Deployment artifacts (T11): systemd units, Caddy site block, build/install/
 * backup scripts and the delivery docs. These tests are deliberately static for
 * the privileged parts (systemd/Caddy) and behavioural for the scripts we can
 * run unprivileged: backup.sh (with a fake sqlite3 CLI) and build-release.sh
 * staging logic (via a temp fixture tree).
 */

const ROOT = path.resolve(__dirname, '..');
const DEPLOY = path.join(ROOT, 'deploy');

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const tempDirs: string[] = [];
function tempDir(prefix = 'shoppulse-deploy-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('systemd unit', () => {
  const unit = read('deploy/shoppulse-ai.service');

  it('runs the standalone server on loopback:8802 with a memory ceiling', () => {
    expect(unit).toContain('[Service]');
    expect(unit).toContain('WorkingDirectory=/opt/shoppulse-ai/current');
    expect(unit).toContain('ExecStart=/usr/bin/env node /opt/shoppulse-ai/current/server.js');
    expect(unit).toContain('Environment=PORT=8802');
    expect(unit).toContain('Environment=HOSTNAME=127.0.0.1');
    expect(unit).toMatch(/MemoryMax=400M/);
    expect(unit).toMatch(/Restart=on-failure/);
  });

  it('loads the env file and runs as the unprivileged shoppulse user', () => {
    expect(unit).toContain('EnvironmentFile=/opt/shoppulse-ai/shoppulse.env');
    expect(unit).toContain('User=shoppulse');
    expect(unit).toContain('NODE_ENV=production');
    expect(unit).toMatch(/NoNewPrivileges=true/);
    expect(unit).toMatch(/ProtectSystem=strict/);
    expect(unit).toContain('ReadWritePaths=/var/lib/shoppulse-ai');
    expect(unit).toContain('WantedBy=multi-user.target');
  });
});

describe('Caddy site block', () => {
  const caddy = read('deploy/Caddyfile.shop-ai.dycxy.shop');

  it('proxies shop-ai.dycxy.shop to 8802 with SSE flushing', () => {
    expect(caddy).toContain('shop-ai.dycxy.shop {');
    expect(caddy).toContain('reverse_proxy 127.0.0.1:8802');
    expect(caddy).toContain('flush_interval -1');
  });

  it('does not touch the existing sites or the tutor port', () => {
    for (const site of ['dyc.dycxy.shop', 'shop.dycxy.shop', 'tutor.dycxy.shop']) {
      expect(caddy).not.toMatch(new RegExp(`^${site.replace(/\./g, '\\.')}\\s*\\{`, 'm'));
    }
    expect(caddy).not.toContain('8801');
    expect(caddy).not.toContain('8788');
    expect(caddy).not.toMatch(/^\s*import\s/m);
  });

  it('does not compress the SSE endpoint', () => {
    expect(caddy).toContain('@not_sse not path /api/widget/chat');
    expect(caddy).toMatch(/encode @not_sse/);
  });
});

describe('backup timer', () => {
  it('runs daily and keeps 14 days', () => {
    const timer = read('deploy/shoppulse-backup.timer');
    const service = read('deploy/shoppulse-backup.service');
    expect(timer).toContain('OnCalendar=*-*-* 03:20:00');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('WantedBy=timers.target');
    expect(service).toContain('deploy/backup.sh');
    expect(service).toContain('--retention-days 14');
    expect(service).toContain('--db /var/lib/shoppulse-ai/shoppulse.db');
  });
});

describe('env example', () => {
  const env = read('deploy/shoppulse.env.example');

  it('lists the production variables without embedding a secret', () => {
    expect(env).toContain('SHOPPULSE_DB_PATH=');
    expect(env).toContain('SHOPPULSE_LLM_BASE_URL=');
    expect(env).toContain('SHOPPULSE_LLM_MODEL=');
    expect(env).toContain('SHOPPULSE_LLM_API_KEY=');
    expect(env).toContain('SHOPPULSE_REQUIRE_LLM=1');
    expect(env).toContain('ADMIN_PASSWORD_HASH=');
    expect(env).toContain('SESSION_SECRET=');
    expect(env).toMatch(/SHOPPULSE_LLM_API_KEY=\s*$/m);
    expect(env).toMatch(/SESSION_SECRET=\s*$/m);
    expect(env).toMatch(/ADMIN_PASSWORD_HASH=\s*$/m);
  });

  it('documents chmod 600', () => {
    expect(env.toLowerCase()).toContain('chmod 600');
  });
});

describe('script syntax and permissions', () => {
  const scripts = ['build-release.sh', 'install.sh', 'backup.sh'];

  it.each(scripts)('%s is executable and passes bash -n', (name) => {
    const file = path.join(DEPLOY, name);
    const mode = fs.statSync(file).mode;
    expect(mode & 0o111).not.toBe(0);
    const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });

  it('node helpers parse', () => {
    for (const name of ['hash-password.mjs', 'sqlite-backup.mjs', 'user.mjs']) {
      const result = spawnSync(process.execPath, ['--check', path.join(DEPLOY, name)], {
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it('build-release.sh refuses unknown flags', () => {
    const result = spawnSync('bash', [path.join(DEPLOY, 'build-release.sh'), '--nope'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown option');
  });

  it('install.sh refuses to run unknown flags / missing tarball before touching the system', () => {
    const result = spawnSync('bash', [path.join(DEPLOY, 'install.sh'), '--nope'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown option');

    const missing = spawnSync('bash', [path.join(DEPLOY, 'install.sh'), '--yes'], {
      encoding: 'utf8',
    });
    expect(missing.status).not.toBe(0);
    // Either "must run as root" or "--tarball is required" — both are safe.
    expect(missing.stderr).toMatch(/must run as root|--tarball is required/);
  });
});

describe('backup.sh', () => {
  it('backs up with sqlite3 .backup, verifies integrity, prunes old files', () => {
    const dir = tempDir();
    const dbFile = path.join(dir, 'shoppulse.db');
    const backupDir = path.join(dir, 'backups');
    fs.writeFileSync(dbFile, 'not-a-real-db');
    fs.mkdirSync(backupDir);

    // Fake sqlite3: `.backup 'OUT'` copies the source; PRAGMA returns ok.
    const fakeSqlite = path.join(dir, 'fake-sqlite3.sh');
    fs.writeFileSync(
      fakeSqlite,
      `#!/usr/bin/env bash
set -e
if [[ "$2" == ".backup '"*"'" ]]; then
  out="\${2#.backup \\'}"; out="\${out%\\'}"
  cp "$1" "$out"
elif [[ "$2" == "PRAGMA integrity_check;" ]]; then
  echo ok
else
  exit 1
fi
`,
    );
    fs.chmodSync(fakeSqlite, 0o755);

    const old = path.join(backupDir, 'shoppulse-20200101-000000.db.gz');
    fs.writeFileSync(old, 'old');
    const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, oldTime, oldTime);

    const result = spawnSync(
      'bash',
      [path.join(DEPLOY, 'backup.sh'), '--db', dbFile, '--dest', backupDir, '--retention-days', '14'],
      {
        encoding: 'utf8',
        env: { ...process.env, SQLITE3_BIN: fakeSqlite },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('wrote ');
    expect(result.stdout).toContain('pruned 1 old backup');

    const backups = fs
      .readdirSync(backupDir)
      .filter((name) => /^shoppulse-\d{8}-\d{6}(-\d+)?\.db\.gz$/.test(name));
    expect(backups).toHaveLength(1);
    expect(fs.existsSync(old)).toBe(false);

    const gz = path.join(backupDir, backups[0]);
    const mode = fs.statSync(gz).mode & 0o777;
    expect(mode).toBe(0o600);

    const restored = execFileSync('bash', ['-c', `gzip -dc '${gz}'`], { encoding: 'utf8' });
    expect(restored).toBe('not-a-real-db');
  });

  it('rejects a missing database and a bad retention value', () => {
    const dir = tempDir();
    const missing = spawnSync(
      'bash',
      [path.join(DEPLOY, 'backup.sh'), '--db', path.join(dir, 'nope.db'), '--dest', dir],
      { encoding: 'utf8' },
    );
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('database not found');

    const badRetention = spawnSync(
      'bash',
      [path.join(DEPLOY, 'backup.sh'), '--retention-days', '0'],
      { encoding: 'utf8' },
    );
    expect(badRetention.status).not.toBe(0);
    expect(badRetention.stderr).toContain('positive integer');
  });

  it('falls back to the node backup helper when sqlite3 is unavailable', () => {
    const dir = tempDir();
    const dbFile = path.join(dir, 'shoppulse.db');
    fs.writeFileSync(dbFile, 'db-bytes');
    const out = path.join(dir, 'copy.db');

    // Exercise the helper directly with a fake better-sqlite3 package: the
    // import path used by the release layout is deploy/../node_modules.
    const fakeModules = path.join(dir, 'node_modules', 'better-sqlite3', 'lib');
    fs.mkdirSync(fakeModules, { recursive: true });
    fs.writeFileSync(
      path.join(fakeModules, 'index.js'),
      `import fs from 'node:fs';
       export default class FakeDatabase {
         constructor(file, opts) {
           if (opts && opts.fileMustExist && !fs.existsSync(file)) throw new Error('missing');
           this.file = file;
         }
         async backup(target) { fs.copyFileSync(this.file, target); }
         pragma(name) { return name === 'integrity_check' ? 'ok' : 0; }
         close() {}
       }`,
    );
    fs.writeFileSync(
      path.join(dir, 'node_modules', 'better-sqlite3', 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', version: '0.0.0', type: 'module', main: 'lib/index.js' }),
    );
    const helperDir = path.join(dir, 'deploy');
    fs.mkdirSync(helperDir);
    fs.copyFileSync(path.join(DEPLOY, 'sqlite-backup.mjs'), path.join(helperDir, 'sqlite-backup.mjs'));

    const result = spawnSync(
      process.execPath,
      [path.join(helperDir, 'sqlite-backup.mjs'), '--db', dbFile, '--out', out],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
    expect(fs.readFileSync(out, 'utf8')).toBe('db-bytes');
  });
});

describe('hash-password helper', () => {
  it('produces a salt:hash accepted by the app verifier', async () => {
    const { verifyPassword } = await import('@/lib/auth/password');
    const result = spawnSync(process.execPath, [path.join(DEPLOY, 'hash-password.mjs'), '--stdin'], {
      input: 'correct horse battery staple\n',
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const hash = result.stdout.trim();
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = spawnSync(process.execPath, [path.join(DEPLOY, 'hash-password.mjs'), '--stdin'], {
      input: '\n',
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
  });
});

describe('build-release.sh', () => {
  it('packs standalone, static, public and deploy into a tarball with BUILD_INFO', () => {
    const dir = tempDir('shoppulse-build-');
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.next', 'standalone', 'node_modules', 'better-sqlite3', 'build', 'Release'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repo, '.next', 'static', 'chunks'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'public'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'deploy'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.next', 'standalone', 'server.js'), '// server');
    fs.writeFileSync(
      path.join(repo, '.next', 'standalone', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
      'fake-binding',
    );
    fs.writeFileSync(path.join(repo, '.next', 'static', 'chunks', 'app.js'), '// js');
    fs.writeFileSync(path.join(repo, 'public', 'widget.js'), '// widget');
    // Run a copy of the real script from inside the fixture so ROOT_DIR
    // resolves to the fixture rather than this repository.
    fs.copyFileSync(
      path.join(DEPLOY, 'build-release.sh'),
      path.join(repo, 'deploy', 'build-release.sh'),
    );
    for (const file of ['install.sh', 'backup.sh']) {
      fs.writeFileSync(path.join(repo, 'deploy', file), '# stub');
    }
    fs.copyFileSync(path.join(DEPLOY, 'user.mjs'), path.join(repo, 'deploy', 'user.mjs'));
    for (const file of ['README.md', 'DEPLOY.md', 'DELIVERY.md', 'LICENSE']) {
      fs.writeFileSync(path.join(repo, file), 'doc');
    }
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'shoppulse-ai', version: '9.9.9' }),
    );

    const out = path.join(dir, 'dist');
    const result = spawnSync(
      'bash',
      [path.join(repo, 'deploy', 'build-release.sh'), '--skip-install', '--skip-build', '--out', out],
      { encoding: 'utf8', cwd: repo },
    );

    expect(result.status, result.stderr).toBe(0);
    const tarballs = fs.readdirSync(out).filter((name) => name.endsWith('.tar.gz'));
    expect(tarballs).toHaveLength(1);
    expect(fs.existsSync(path.join(out, `${tarballs[0]}.sha256`))).toBe(true);
    expect(fs.readFileSync(path.join(out, `${tarballs[0]}.sha256`), 'utf8')).toMatch(
      new RegExp(`${tarballs[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
    );

    const extract = path.join(dir, 'extract');
    fs.mkdirSync(extract);
    execFileSync('tar', ['-xzf', path.join(out, tarballs[0]), '-C', extract]);
    const pkgRoot = fs.readdirSync(extract)[0];
    const packed = path.join(extract, pkgRoot);
    expect(fs.existsSync(path.join(packed, 'server.js'))).toBe(true);
    expect(fs.existsSync(path.join(packed, '.next', 'static', 'chunks', 'app.js'))).toBe(true);
    expect(fs.existsSync(path.join(packed, 'public', 'widget.js'))).toBe(true);
    expect(fs.existsSync(path.join(packed, 'deploy', 'install.sh'))).toBe(true);
    // User management CLI travels with the release so it can run on the server.
    expect(fs.existsSync(path.join(packed, 'deploy', 'user.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(packed, 'DEPLOY.md'))).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          packed,
          'node_modules',
          'better-sqlite3',
          'build',
          'Release',
          'better_sqlite3.node',
        ),
      ),
    ).toBe(true);

    const buildInfo = fs.readFileSync(path.join(packed, 'BUILD_INFO'), 'utf8');
    expect(buildInfo).toContain('version=9.9.9');
    expect(buildInfo).toMatch(/^node_major=\d+$/m);
    expect(buildInfo).toContain(`platform=${process.platform}`);
    expect(buildInfo).toContain(`arch=${process.arch}`);
  });

  it('fails clearly when the standalone build output is missing', () => {
    const dir = tempDir('shoppulse-build-');
    fs.mkdirSync(path.join(dir, '.next'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'deploy'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'shoppulse-ai', version: '0.0.0' }),
    );
    fs.copyFileSync(
      path.join(DEPLOY, 'build-release.sh'),
      path.join(dir, 'deploy', 'build-release.sh'),
    );

    const result = spawnSync(
      'bash',
      [
        path.join(dir, 'deploy', 'build-release.sh'),
        '--skip-install',
        '--skip-build',
        '--out',
        path.join(dir, 'dist'),
      ],
      { encoding: 'utf8', cwd: dir },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('server.js missing');
  });
});

describe('install.sh', () => {
  const install = read('deploy/install.sh');

  it('guards the better-sqlite3 ABI by comparing Node major versions', () => {
    expect(install).toContain('BUILD_INFO');
    expect(install).toContain('node_major');
    expect(install).toContain('Node major mismatch');
    expect(install).toContain('ABI');
  });

  it('keeps existing env files, forces 0600, and switches current atomically', () => {
    expect(install).toContain('chmod 600 "$ENV_FILE"');
    expect(install).toContain('[[ ! -f "$ENV_FILE" ]]');
    expect(install).toContain('ln -sfn "$RELEASE_DIR" "$PREFIX/current.new"');
    expect(install).toContain('mv -Tf "$PREFIX/current.new" "$PREFIX/current"');
    expect(install).toContain('systemctl daemon-reload');
    expect(install).toContain('/api/health');
  });

  it('creates the unprivileged user and writable data directory', () => {
    expect(install).toContain('useradd --system');
    expect(install).toContain('chown "$RUN_USER:$RUN_USER" "$DATA_DIR"');
    expect(install).toContain('mkdir -p "$PREFIX/releases" "$DATA_DIR" "$BACKUP_DIR"');
  });
});

describe('docs', () => {
  it('README covers features, quickstart, mock mode, env vars and tests', () => {
    const readme = read('README.md');
    expect(readme).toContain('## 功能');
    expect(readme).toContain('## 快速开始');
    expect(readme).toContain('### Mock 演示模式');
    expect(readme).toContain('### 环境变量');
    expect(readme).toContain('### 脚本与测试');
    expect(readme).toContain('## English');
    expect(readme).toContain('TBD');
  });

  it('DEPLOY documents zz constraints, Caddy safety and Node ABI matching', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('2 核 / 1.9G');
    expect(deploy).toContain('8801');
    expect(deploy).toContain('8788');
    expect(deploy).toContain('x-ui');
    expect(deploy).toContain('caddy validate');
    expect(deploy).toContain('flush_interval -1');
    expect(deploy).toContain('chmod 600');
    expect(deploy).toContain('Node 24');
    expect(deploy).toContain('DNS A 记录');
    expect(deploy).toContain('https://shop-ai.dycxy.shop');
  });

  it('DEPLOY has the v0.2 multi-user upgrade runbook (prepared, not run)', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('### 升级到 v0.2（多用户）');
    expect(deploy).toContain('shoppulse-pre-v0.2.db.gz');
    expect(deploy).toContain('PRAGMA user_version');
    expect(deploy).toContain('runuser -u shoppulse');
    expect(deploy).toContain(
      'SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db',
    );
    expect(deploy).toContain('/opt/shoppulse-ai/current/deploy/user.mjs add trial1');
    expect(deploy).toContain('--out /var/lib/shoppulse-ai/trial-accounts.txt');
    expect(deploy).toContain('--site-origin https://shop-ai.dycxy.shop');
    expect(deploy).toContain('/root/shoppulse-trial-accounts.txt');
    expect(deploy).toContain('shoppulse-trial-accounts.txt');
    // Rollback restores the DB backup and the previous release symlink.
    expect(deploy).toContain('shoppulse.db.v2-failed');
    expect(deploy).toContain('releases/<旧 release>');
    expect(deploy).toContain('mv -Tf /opt/shoppulse-ai/current.new /opt/shoppulse-ai/current');
  });

  it('DELIVERY has features, acceptance checklist, embed snippet and acceptance results', () => {
    const delivery = read('DELIVERY.md');
    expect(delivery).toContain('## 1. 功能清单');
    expect(delivery).toContain('## 2. 挂件嵌入代码');
    expect(delivery).toContain('## 3. 管理员指南');
    expect(delivery).toContain('## 4. 验收清单');
    expect(delivery).toContain('## 5. Acceptance results');
    expect(delivery).toContain('data-site-key=');
    // Deployment remains pending until the user confirms.
    expect(delivery).toContain('TBD');
  });
});
