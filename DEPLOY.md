# 部署指南 — ShopPulse AI on zz

> **状态：已部署（2026-11-02 10:56 UTC+8，commit 679d7ca）。**
> 线上地址：**https://shop-ai.dycxy.shop**

目标服务器 **zz**（`192.74.249.13`，2 核 / 1.9G + 1G swap）。同一台机器上已运行：

| 现有服务 | 说明 | 本项目的处理 |
| --- | --- | --- |
| Caddy | `dyc.dycxy.shop`、`shop.dycxy.shop`、`tutor.dycxy.shop` | **只追加**新站点块，绝不改动现有块 |
| AI tutor | `tutor.dycxy.shop`，监听 **8801** | 不触碰；本项目用 **8802** |
| WorkBuddy 网关 | 监听 **8788**（LLM API） | 仅作为上游调用 |
| x-ui | 面板/代理 | 不触碰 |

## 1. 前置条件

- 域名 `shop-ai.dycxy.shop` 的 **DNS A 记录** 指向 `192.74.249.13`（当前经公共 DNS 查询为 NXDOMAIN，需先在 DNS 服务商处添加；Caddy 自动签发证书依赖它）。添加前用 `dig +short shop-ai.dycxy.shop @8.8.8.8` 确认。
- **Node 主版本必须与构建机一致（当前构建机为 Node 24）**。`better-sqlite3` 是 ABI 相关的原生模块，构建产物中的 `.node` 绑定只能在同一 Node 主版本的运行时加载。检查：

  ```bash
  node -v    # zz 上应显示 v24.x
  ```

  若 zz 不是 Node 24：要么在 zz 上安装 Node 24（如 nodesource 仓库或官方二进制），要么在同样 Node 版本的机器上重新构建。**不要**在 zz 上执行 `npm rebuild`/`npm install` 来“修复” —— 发布包不带源码与 devDependencies。
- 构建机与 zz 同为 `linux/x64`（当前构建机：`x86_64`）。
- zz 上已安装 `sqlite3` CLI（`apt install sqlite3`）；若没有，`backup.sh` 会自动回退到 `deploy/sqlite-backup.mjs`（使用发布包内的 better-sqlite3）。
- 端口 8802 未被占用：`ss -tlnp | grep 8802`。部署前再次复核。

## 2. 在 box 上构建发布包

```bash
cd /path/to/shoppulse-ai
bash deploy/build-release.sh
```

脚本会：

1. `npm ci`（除非 `--skip-install`）并 `npm run build`（除非 `--skip-build`）；
2. 校验 `.next/standalone/server.js`、`.next/static`、`public/widget.js` 与 better-sqlite3 原生绑定；
3. 打包 `.next/standalone` + `.next/static` + `public` + `deploy/` + 文档 为 `dist/shoppulse-ai-<version>-<UTC时间>-linux-x64.tar.gz`；
4. 生成 `.sha256`，并在包内写入 `BUILD_INFO`（版本、commit、Node 版本/主版本、平台架构）。

上传并校验：

```bash
scp dist/shoppulse-ai-*.tar.gz dist/shoppulse-ai-*.tar.gz.sha256 zz:/tmp/
ssh zz 'cd /tmp && sha256sum -c shoppulse-ai-*.tar.gz.sha256'
```

## 3. 在 zz 上安装 / 升级

```bash
ssh zz
sudo mkdir -p /opt/shoppulse-ai
sudo tar -xzf /tmp/shoppulse-ai-*.tar.gz -C /tmp
sudo bash /tmp/shoppulse-ai-*/deploy/install.sh --tarball /tmp/shoppulse-ai-*.tar.gz
```

`install.sh` 会：

- 校验 `BUILD_INFO` 中的 **Node 主版本与本机一致**，不一致直接失败（ABI 保护）；
- 创建系统用户 `shoppulse`、目录 `/opt/shoppulse-ai/releases/<id>`、`/var/lib/shoppulse-ai`、`/var/backups/shoppulse-ai`；
- 将 `current` 软链切换到新版本，**保留最近 3 个版本**用于回滚；
- 首次安装时从 `deploy/shoppulse.env.example` 生成 `/opt/shoppulse-ai/shoppulse.env` 并 `chmod 600`（自动生成随机 `SESSION_SECRET`，填充 DB 路径）；**已存在的 env 文件绝不覆盖**；
- 安装 `shoppulse-ai.service`、`shoppulse-backup.service` / `.timer`，`daemon-reload`，启用并重启服务；
- 轮询 `http://127.0.0.1:8802/api/health` 最多 30 秒。

首次安装后按提示编辑 env（见下一节），再 `sudo systemctl restart shoppulse-ai`。

### 环境文件

```bash
sudo install -m 600 /dev/null /opt/shoppulse-ai/shoppulse.env   # 仅当文件不存在
sudo editor /opt/shoppulse-ai/shoppulse.env
sudo chmod 600 /opt/shoppulse-ai/shoppulse.env
sudo chown root:root /opt/shoppulse-ai/shoppulse.env
```

必填项：

```dotenv
SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db
SHOPPULSE_LLM_BASE_URL=http://192.74.249.13:8788/v1
SHOPPULSE_LLM_MODEL=deepseek-v4.1-flash
SHOPPULSE_LLM_API_KEY=<网关密钥>
SHOPPULSE_REQUIRE_LLM=1
# 仅当 Node 只经 Caddy 反向代理暴露时设为 1：限流取 X-Forwarded-For 最右侧
# （由 Caddy 追加）的一跳；若 8802 可被公网直连，必须保持 0，否则客户端可伪造。
SHOPPULSE_TRUST_PROXY=1
# 后台「站点管理」嵌入代码使用的外部访问地址（不要依赖请求头）。
SHOPPULSE_PUBLIC_BASE_URL=https://shop-ai.dycxy.shop
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<scrypt salt:hash>
SESSION_SECRET=<install.sh 已生成>
```

生成密码哈希（不会进入 shell 历史）：

```bash
echo 'your-strong-password' | node /opt/shoppulse-ai/current/deploy/hash-password.mjs --stdin
```

`shoppulse.env` 必须 **chmod 600、root:root**；服务以 `shoppulse` 用户运行，通过 systemd 读取环境文件。**不要**把密钥写进 unit 文件、命令行参数或任何日志。

### systemd unit 要点

`deploy/shoppulse-ai.service`：

- `PORT=8802`、`HOSTNAME=127.0.0.1`（仅本机监听，外网经 Caddy）；
- `MemoryHigh=320M`、`MemoryMax=400M`，配合 `Restart=on-failure`；zz 只有 1.9G 内存且还跑着 tutor/网关/x-ui，不要把上限调高；
- 只允许写 `/var/lib/shoppulse-ai`（`ProtectSystem=strict` + `ReadWritePaths`），`PrivateTmp`、`NoNewPrivileges` 等加固项；
- `ExecStart=/usr/bin/env node .../server.js`，依赖 PATH 中的 Node 24。

常用命令：

```bash
sudo systemctl status shoppulse-ai
sudo journalctl -u shoppulse-ai -n 100 --no-pager
sudo systemctl restart shoppulse-ai
```

### 回滚

```bash
ls -1 /opt/shoppulse-ai/releases/
sudo ln -sfn /opt/shoppulse-ai/releases/<上一个版本> /opt/shoppulse-ai/current.new
sudo mv -Tf /opt/shoppulse-ai/current.new /opt/shoppulse-ai/current
sudo systemctl restart shoppulse-ai
```

数据在 `/var/lib/shoppulse-ai/shoppulse.db`，升级/回滚都不会动它。

### 升级到 v0.2（多用户）

> **状态：步骤已准备，尚未在生产执行。** 执行前需另有明确批准。

v0.2 会在服务启动时把数据库从 schema v1 迁移到 v2（新增 `users` 表、所有业务表的 `owner_id`、按 owner 的 SKU 唯一约束；存量数据全部归 user 1 / `admin`）。迁移一次性、在事务中完成，**旧版本无法读取 v2 数据库**，所以升级前必须备份，回滚必须同时恢复数据库。

#### 1. 备份生产数据库

先触发一次在线备份（使用当前 release 的 `backup.sh`）：

```bash
sudo systemctl start shoppulse-backup.service
sudo ls -lh /var/backups/shoppulse-ai/
```

把刚生成的备份另存为“升级前”副本，并校验：

```bash
LATEST="$(sudo ls -1t /var/backups/shoppulse-ai/shoppulse-*.db.gz | head -n1)"
sudo cp -a "$LATEST" /var/backups/shoppulse-ai/shoppulse-pre-v0.2.db.gz
sudo gzip -t /var/backups/shoppulse-ai/shoppulse-pre-v0.2.db.gz
sudo chmod 600 /var/backups/shoppulse-ai/shoppulse-pre-v0.2.db.gz
```

确认 `PRAGMA user_version` 仍为 1（升级前的状态），并记下当前 release 路径供回滚：

```bash
sqlite3 /var/lib/shoppulse-ai/shoppulse.db 'PRAGMA user_version;'   # 1
readlink -f /opt/shoppulse-ai/current                                # 记下 <旧 release>
```

#### 2. 构建、上传并升级（env 不变）

在构建机上：

```bash
cd /path/to/shoppulse-ai
git log --oneline -1          # 确认是包含 v0.2 的提交
bash deploy/build-release.sh
scp dist/shoppulse-ai-*.tar.gz dist/shoppulse-ai-*.tar.gz.sha256 zz:/tmp/
```

在 zz 上校验并安装：

```bash
ssh zz
cd /tmp && sha256sum -c shoppulse-ai-*.tar.gz.sha256
sudo tar -xzf /tmp/shoppulse-ai-*.tar.gz -C /tmp
sudo bash /tmp/shoppulse-ai-*/deploy/install.sh --tarball /tmp/shoppulse-ai-*.tar.gz
```

`install.sh` 只切换 `current` 软链、重启服务，**不会覆盖** `/opt/shoppulse-ai/shoppulse.env`。服务启动时自动执行 v2 迁移；`install.sh` 末尾的健康检查通过即表示迁移成功。随后确认：

```bash
sqlite3 /var/lib/shoppulse-ai/shoppulse.db 'PRAGMA user_version;'   # 2
sqlite3 /var/lib/shoppulse-ai/shoppulse.db "SELECT id, username, role FROM users;"
# 1|admin|admin（若 ADMIN_USERNAME 不同，首次启动会把它重命名为该用户名）
curl -fsS http://127.0.0.1:8802/api/health | jq .
```

管理员仍用原 `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` 登录，存量数据不变。

#### 3. 创建试用账号

CLI 在发布包内（`deploy/user.mjs`），使用发布包自带的 better-sqlite3，无需源码或 tsx。密码只写入 `--out` 文件（自动创建为 0600），**不会**出现在 stdout/stderr；每个新用户会自动获得一个默认站点（随机 site key，允许域名取自 `--site-origin`，限流 30），站点 key 会打印出来（不是秘密），可直接给朋友用于嵌入挂件。

以 `shoppulse` 用户运行（数据库属主），先建 3 个试用账号：

```bash
sudo runuser -u shoppulse -- env SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db \
  node /opt/shoppulse-ai/current/deploy/user.mjs add trial1 \
  --out /var/lib/shoppulse-ai/trial-accounts.txt \
  --site-origin https://shop-ai.dycxy.shop
```

`trial2`、`trial3` 同理（改用户名）。若朋友的站点域名不是 `https://shop-ai.dycxy.shop`，把 `--site-origin` 换成实际嵌入挂件的站点 origin（含协议、不带路径），可重复传多个。

确认账号清单（不含哈希、不含密码）：

```bash
sudo runuser -u shoppulse -- env SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db \
  node /opt/shoppulse-ai/current/deploy/user.mjs list
```

#### 4. 保管凭据文件

`--out` 文件必须放在 `shoppulse` 可写目录（如 `/var/lib/shoppulse-ai`），生成后立即移到 root-only 位置：

```bash
sudo mv /var/lib/shoppulse-ai/trial-accounts.txt /root/shoppulse-trial-accounts.txt
sudo chown root:root /root/shoppulse-trial-accounts.txt
sudo chmod 600 /root/shoppulse-trial-accounts.txt
sudo ls -l /root/shoppulse-trial-accounts.txt        # -rw------- root root
```

再取回本机桌面（`C:\Users\10534\Desktop\shoppulse-trial-accounts.txt`）：

```powershell
scp root@zz:/root/shoppulse-trial-accounts.txt C:\Users\10534\Desktop\shoppulse-trial-accounts.txt
```

取回后按需删除服务器上的副本；**不要**把该文件提交到仓库、粘贴到聊天或写进任何日志。

日常账号操作（均以 `shoppulse` 用户、指向生产 DB 运行）：

```bash
# 重置密码：旧会话立即失效，新密码追加到 --out 文件（先写到可写目录）
sudo runuser -u shoppulse -- env SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db \
  node /opt/shoppulse-ai/current/deploy/user.mjs reset-password trial1 \
  --out /var/lib/shoppulse-ai/trial-accounts.txt
sudo mv /var/lib/shoppulse-ai/trial-accounts.txt /root/shoppulse-trial-accounts.txt
sudo chown root:root /root/shoppulse-trial-accounts.txt && sudo chmod 600 /root/shoppulse-trial-accounts.txt

# 停用 / 恢复：disable 会让该用户现有会话立即失效
sudo runuser -u shoppulse -- env SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db \
  node /opt/shoppulse-ai/current/deploy/user.mjs disable trial1
sudo runuser -u shoppulse -- env SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db \
  node /opt/shoppulse-ai/current/deploy/user.mjs enable trial1
```

注意 `--out` 必须位于 `shoppulse` 可写目录（上面的示例写到 `/var/lib/shoppulse-ai` 后再用 root 移走）；`/root` 不可由 `shoppulse` 写入。CLI 要求数据库已是 schema v2，否则会提示先启动一次服务完成迁移。

#### 5. 回滚

v2 迁移不可逆，回滚 = 恢复升级前数据库 + 切回旧 release：

```bash
sudo systemctl stop shoppulse-ai
# 保留现场（诊断用）
sudo mv /var/lib/shoppulse-ai/shoppulse.db /var/lib/shoppulse-ai/shoppulse.db.v2-failed
sudo rm -f /var/lib/shoppulse-ai/shoppulse.db-wal /var/lib/shoppulse-ai/shoppulse.db-shm
# 恢复升级前备份
sudo gzip -dc /var/backups/shoppulse-ai/shoppulse-pre-v0.2.db.gz | sudo tee /var/lib/shoppulse-ai/shoppulse.db >/dev/null
sudo chown shoppulse:shoppulse /var/lib/shoppulse-ai/shoppulse.db
# 与现有数据库权限保持一致（backup.sh 恢复演练使用 750 目录 + 属主可写）
sudo chmod 600 /var/lib/shoppulse-ai/shoppulse.db
# 切回旧 release（用第 1 步记下的路径）
sudo ln -sfn /opt/shoppulse-ai/releases/<旧 release> /opt/shoppulse-ai/current.new
sudo mv -Tf /opt/shoppulse-ai/current.new /opt/shoppulse-ai/current
sudo systemctl start shoppulse-ai
sqlite3 /var/lib/shoppulse-ai/shoppulse.db 'PRAGMA user_version;'   # 1
curl -fsS http://127.0.0.1:8802/api/health | jq .
```

确认恢复后再删除 `shoppulse.db.v2-failed`（其中包含升级后创建的试用账号，保留到确认不再需要为止）。`shoppulse.env` 与 Caddy 配置无需改动。

## 4. Caddy 反向代理（新增站点块）

> **不要重写 Caddyfile。** 现有 `dyc.dycxy.shop`、`shop.dycxy.shop`、`tutor.dycxy.shop`（→ 8801）等站点块必须原样保留。只追加 `shop-ai.dycxy.shop` 块。

```bash
# 1) 备份（带时间戳）
sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)"

# 2) 追加站点块（片段随发布包提供，也可从仓库 deploy/ 目录取）
sudo tee -a /etc/caddy/Caddyfile < /opt/shoppulse-ai/current/deploy/Caddyfile.shop-ai.dycxy.shop

# 3) 校验后再 reload（校验失败不要 reload）
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy

# 4) 检查
sudo systemctl status caddy --no-pager
curl -I https://shop-ai.dycxy.shop/
```

站点块内容（见 `deploy/Caddyfile.shop-ai.dycxy.shop`）：

```caddyfile
shop-ai.dycxy.shop {
	@not_sse not path /api/widget/chat
	encode @not_sse zstd gzip

	reverse_proxy 127.0.0.1:8802 {
		header_down Location "^https?://(localhost|127\.0\.0\.1):8802" "https://shop-ai.dycxy.shop"
		flush_interval -1
	}

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}
```

`header_down Location` 把 Next.js middleware 基于监听地址生成的绝对跳转（`https://localhost:8802/login`）改写为公网域名。`flush_interval -1` 关闭反向代理缓冲，SSE 增量才能实时到达浏览器；同时跳过对 `/api/widget/chat` 的压缩。

Caddy 自动为 `shop-ai.dycxy.shop` 申请 Let's Encrypt 证书 —— 前提是 DNS A 记录已生效、80/443 可从公网访问。若证书签发失败，先查 DNS 与防火墙，**不要**删除现有站点的证书配置。

## 5. 验证

```bash
# 本机健康检查：llm.mode 应为 "llm"，ok=true
curl -fsS http://127.0.0.1:8802/api/health | jq .

# 经 Caddy
curl -fsS https://shop-ai.dycxy.shop/api/health | jq .

# 静态挂件
curl -fsS https://shop-ai.dycxy.shop/widget.js | head -c 120; echo

# SSE 首 token（应逐块到达，而非一次性返回）
curl -N -sS https://shop-ai.dycxy.shop/api/widget/chat \
  -H 'Content-Type: application/json' -H 'Origin: https://YOUR-MERCHANT-SITE' \
  -d '{"siteKey":"YOUR_SITE_KEY","message":"你们什么时候发货？","locale":"zh"}'
```

后台登录：`https://shop-ai.dycxy.shop/admin`。首次登录后到「站点管理」确认允许域名包含商家站点，再复制嵌入代码。

### 反向代理与客户端 IP

生产环境 Node 只监听 `127.0.0.1:8802`，所有请求都经 Caddy 转发：

- `SHOPPULSE_TRUST_PROXY=1`：登录限流与挂件限流使用 `X-Forwarded-For` 的**最右侧**一跳（Caddy 追加的真实连接地址），客户端自带的左侧值被忽略，无法通过轮换 XFF 绕过限流。
- 未设置该变量（默认 0）时完全忽略 `X-Forwarded-For` / `X-Real-IP`，仅使用服务端看到的连接地址（测试或直连场景为 `unknown`，共用同一限流桶）。
- 切勿在 8802 可被公网直连时开启该变量。

### 嵌入代码的外部地址

`SHOPPULSE_PUBLIC_BASE_URL` 指定嵌入代码使用的规范 origin（如 `https://shop-ai.dycxy.shop`），优先于任何请求头，杜绝伪造 Host 生成恶意脚本地址。生产 env 模板已预填；未配置时才回退到受信任代理头 / 服务端请求 URL。

### 资源占用

```bash
systemctl show shoppulse-ai -p MemoryCurrent,MemoryMax
ps -o pid,rss,cmd -C node
```

目标 RSS < 300MB（设计目标），硬上限 400MB。若持续触顶，先看 `journalctl -u shoppulse-ai` 是否有异常流量或大请求。

## 6. 备份与恢复

`shoppulse-backup.timer` 每天 03:20（±5 分钟随机抖动）运行，执行：

```bash
/opt/shoppulse-ai/current/deploy/backup.sh \
  --db /var/lib/shoppulse-ai/shoppulse.db \
  --dest /var/backups/shoppulse-ai \
  --retention-days 14
```

- 使用 SQLite 在线备份 API（`sqlite3 DB ".backup ..."`，无 CLI 时回退到 `sqlite-backup.mjs`），运行中也可安全备份；
- 每个备份做 `PRAGMA integrity_check`，通过后 gzip 原子写入 `shoppulse-YYYYmmdd-HHMMSS.db.gz`（chmod 600）；
- 删除超过 14 天的 `shoppulse-*.db.gz`；
- `flock` 防止并发；临时文件两小时后自动清理。

手动测试与恢复：

```bash
sudo systemctl start shoppulse-backup.service
sudo ls -lh /var/backups/shoppulse-ai/
sudo systemctl list-timers shoppulse-backup.timer

# 恢复（先停服务，保留现场）
sudo systemctl stop shoppulse-ai
sudo cp -a /var/lib/shoppulse-ai/shoppulse.db /var/lib/shoppulse-ai/shoppulse.db.before-restore
sudo gunzip -c /var/backups/shoppulse-ai/shoppulse-<stamp>.db.gz | sudo tee /var/lib/shoppulse-ai/shoppulse.db >/dev/null
sudo chown shoppulse:shoppulse /var/lib/shoppulse-ai/shoppulse.db
sudo systemctl start shoppulse-ai
```

## 7. 排查

| 症状 | 检查 |
| --- | --- |
| 服务启动即退出 | `journalctl -u shoppulse-ai`；常见原因：Node 主版本不匹配（ABI 错误）、env 文件权限/路径、`SESSION_SECRET`/`ADMIN_PASSWORD_HASH` 缺失 |
| `/api/health` 返回 503 | `llm.mode=misconfigured`：`SHOPPULSE_REQUIRE_LLM=1` 但没有 `SHOPPULSE_LLM_API_KEY`，或生产缺会话/管理员配置 |
| 聊天一次性返回/不流式 | Caddy 块缺少 `flush_interval -1`；确认没有其他代理/CDN 缓冲 |
| 挂件 403 / CORS | 浏览器 Origin 不在该 site 的允许域名中；后台「站点管理」补充（含协议与端口，不能带路径） |
| 429 | 该 site 的每分钟限流触顶；按需调整 1–600 |
| 证书未签发 | `shop-ai.dycxy.shop` A 记录是否生效；80/443 是否放行；`journalctl -u caddy` |
| 内存超限被重启 | `systemctl show shoppulse-ai -p MemoryCurrent`；排查异常流量，勿盲目调高 `MemoryMax` |

## 8. 变更清单（部署时逐项打勾）

- [ ] DNS A 记录 `shop-ai.dycxy.shop → 192.74.249.13` 已生效
- [ ] zz Node 主版本 = 构建机（24），`linux/x64`
- [ ] 8802 空闲，现有 8801/8788 未被影响
- [ ] 发布包 sha256 校验通过
- [ ] `install.sh` 通过 Node 主版本检查，服务 active
- [ ] `shoppulse.env` chmod 600、root:root，包含真实 Key 与密码哈希
- [ ] `/api/health` 返回 200，`llm.mode=llm`
- [ ] Caddyfile 已备份，`caddy validate` 通过，reload 后现有三个站点仍正常
- [ ] HTTPS 证书签发成功，SSE 实时流式
- [ ] 后台登录、站点允许域名、嵌入代码正确
- [ ] 备份 timer 已启用，手动备份与恢复演练通过

**线上 URL：https://shop-ai.dycxy.shop**（2026-11-02 部署）。
