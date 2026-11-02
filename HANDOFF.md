# ShopPulse AI — 接管提示词 / HANDOFF

> 本文件**不含任何密码、API Key、Token**；凭据只以「文件位置」引用。更新时间：2026-11-02 17:40（UTC+8），对应 commit `341d6e3` 之后。

---

## 0. 快速启动提示词（直接复制给接管的 AI）

```
你将接替 Grok Bot，作为 ShopPulse AI 项目的「监督者 / Supervisor」。项目负责人：段志超（用中文、简短汇报）。
先完整阅读仓库根目录的 HANDOFF.md、PLAN.md、specs/、log/deployment.md，再行动。
工作方式（Kiroween）：先计划 → specs → tasks；代码交给 Claude Code（~/bin/cc-wb，deepseek-v4-pro，effort max），
Codex（gpt-6-luna，low reasoning；升档前先问用户）负责审查与前端 UI / 落地页 / 生图。你只监督、验收、记录，不亲自写大段代码。
每一步写入 log/deployment.md（中文要点，UTC+8 时间戳）并提交。
硬规则：不做重试循环（失败两次就简化/跳过并上报）；省用量；push / deploy / 发布必须用户明确同意；
绝不输入密码或验证码、绝不打印密钥，凭据只写入 600 权限文件；不碰 zz 上的 x-ui/xray、WorkBuddy 网关 8788、
其他 Caddy 站点（dyc.dycxy.shop、shop.dycxy.shop、tutor.dycxy.shop）；不编造客户、数据、评价。
线上：https://shop-ai.dycxy.shop 。生产服务器 zz（192.74.249.13，SSH 端口 22491，root，经用户 Windows 电脑跳转）。
第一件事：确认工作区干净、npm test 与 npm run build 通过，然后向用户简短汇报现状并询问下一步。
```

---

## 1. 项目背景与目标
- **ShopPulse AI**：面向中国中小商家（通用零售）的「AI 客服聊天挂件 + 营销文案助手」，中英双语（中文优先），MIT 开源（尚未建 GitHub 仓库）。
- 商家后台：知识库（FAQ/退换货/店铺信息）、商品 CRUD + CSV/JSON/Excel 导入、文案工作台（小红书 / 朋友圈 / 抖音脚本 / 电商详情页）、会话收件箱（标签、备注、坐席回复、快捷回复、人工接管）、报表（含 CSV 导出）、站点设置（site key、允许域名、欢迎语、限流、嵌入代码）。
- 可嵌入挂件 `public/widget.js`：一段 `<script data-site-key>`，Shadow DOM（closed），SSE 流式回复、多轮、基于知识库与商品回答、商品价格卡片、转人工、移动端全屏。
- 多用户（v0.2 起）：每个用户的数据（站点、知识库、商品、会话、快捷回复、报表）按 user_id 隔离；admin 与普通 user 角色。
- 安全原则：不得编造知识库之外的价格/政策（price guard）；拒绝违法/虚假宣传；无 API Key 时 Mock 模式，生产强制真实模型（`SHOPPULSE_REQUIRE_LLM`）。

## 2. 架构与技术栈
- Next.js 14.2.35 App Router + TypeScript + Tailwind + lucide-react；`output: 'standalone'`；`images.unoptimized: true`（生产无 sharp）。
- 数据库：SQLite（better-sqlite3），迁移用 `PRAGMA user_version`，当前 **v3**；迁移在**首个 DB 请求时惰性执行**（不是启动时）。
- LLM：OpenAI 兼容接口，生产经 WorkBuddy 网关（zz 本机 8788），默认模型 `deepseek-v4.1-flash`（环境变量可改）；SSE 流式。
- 认证：会话 Cookie（`SESSION_SECRET` 签名），密码哈希；中间件保护 `/admin`。
- i18n：`src/lib/i18n/zh.ts` / `en.ts`（键必须两边一致，有测试校验），Cookie `shoppulse_locale`。
- 测试：Vitest（35 个文件，484 个用例），`npm test`；构建 `npm run build`。

## 3. 仓库结构
| 路径 | 说明 |
|---|---|
| `PLAN.md` | 项目计划与已确认配置 |
| `specs/requirements.md`、`design.md`、`tasks.md` | Kiroween 规格与任务清单 |
| `specs/multi-user.md`、`merchant-features.md`、`landing-v2.md` | 多用户、商家功能（v0.3）、落地页 v2 设计简报 |
| `log/deployment.md` | **全部步骤日志**（中文、UTC+8）——接管后继续追加 |
| `DEPLOY.md` | 部署手册（首次安装、升级、回滚、Caddy、备份） |
| `DELIVERY.md`、`README.md` | 交付说明 / 使用说明 |
| `src/app/` | 页面与 API（`page.tsx` 落地页、`admin/`、`login/`、`demo/`、`api/`） |
| `src/components/`、`src/lib/` | 组件；db、auth、llm、i18n 等库 |
| `public/widget.js`、`public/landing/` | 挂件脚本；落地页图片（Codex 生图 + 真实截图 webp） |
| `deploy/` | `build-release.sh`、`install.sh`、`user.mjs`、`backup.sh`、`sqlite-backup.mjs`、systemd 单元、`Caddyfile.shop-ai.dycxy.shop`、`shoppulse.env.example` |
| `tests/` | Vitest 用例 |
| `screenshots/`、`docs/demo/` | 截图；演示视频与中文字幕 |
| `dist/` | 发布 tarball（不提交） |

## 4. 当前状态（2026-11-02）
- 线上版本：commit `341d6e3`（落地页 v2 + 挂件 X 关闭修复），DB v3。
- 已完成：v0.1 基础功能 → v0.2 多用户与隔离 → v0.3 收件箱标签/备注/坐席回复、快捷回复、欢迎语、报表 → 后台 UI 改版 → 落地页 v2（SaleSmartly 风格结构，真实截图 + Codex 生图）→ 挂件 `[hidden]` 被 `display:flex` 覆盖导致 X 关不掉的修复。
- 账号：admin（id 1）+ 试用 trial1–3（id 2–4，各自默认站点，数据为空）。
- 未做：GitHub 建库/推送（**用户需自己登录 GitHub**）。

### 后续想法（未开始，需用户确认优先级）
1. 双栏收件箱（会话列表 + 对话详情同屏）。
2. 轻量 CRM（客户档案、标签分层、跟进记录）。
3. 群发 / 批量消息（注意合规与限流）。
4. 多渠道接入（目前只有网站挂件）。
5. 团队（同一店铺多坐席、角色权限）。
6. 流程自动化（关键词/意图触发、自动分配）。
7. Demo 模式的 `[policy]` 标签（用户提出的想法，具体期望需向用户确认）。
8. 自助注册流程（目前只能用 `deploy/user.mjs` 由管理员创建账号）。

## 5. 线上与 zz 部署
- 线上地址：**https://shop-ai.dycxy.shop**（登录 `/login`，演示 `/demo`，健康检查 `/api/health`）。
- DNS：Cloudflare 管理 `dycxy.shop`，`shop-ai` A 记录 → `192.74.249.13`（Caddy 通过 Let's Encrypt 自动签发证书；修改 DNS 前先确认 Cloudflare 代理状态）。
- 服务器 **zz**：`192.74.249.13`，SSH 端口 **22491**，用户 root，**只能经用户的 Windows 电脑**（Grok Bot 的 machine：DESKTOP-2LFM16F）执行 `ssh -o BatchMode=yes -p 22491 root@192.74.249.13 "..."`；zz 时钟为 UTC。
  - 经验：PowerShell 会破坏复杂的内联命令 → 在本地写好脚本，打包 tgz，先复制到 Windows，再 `scp -P 22491` 到 zz `/tmp`，`tar -xzf` 后 `bash` 执行。
  - zz 上没有 `sqlite3` CLI，查库用 release 内 `node_modules/better-sqlite3`。
- systemd：`shoppulse-ai.service`（Next standalone，监听 `127.0.0.1:8802`，用户 `shoppulse`）；`shoppulse-backup.service` + `.timer`（每日 03:20 在线备份）。
- 路径：
  - 程序：`/opt/shoppulse-ai/releases/<UTC时间戳>-<commit>/`，当前版本软链 `/opt/shoppulse-ai/current`；
  - 环境变量文件：`/opt/shoppulse-ai/shoppulse.env`（600；变量名见 `deploy/shoppulse.env.example`，**勿打印内容**）；
  - 数据：`/var/lib/shoppulse-ai/shoppulse.db`（WAL）；
  - 备份：`/var/backups/shoppulse-ai/`（`shoppulse-YYYYMMDD-HHMMSS.db.gz`、升级前 `shoppulse-pre-vX.db.gz`、手工副本目录 `manual-pre-vX-<时间>/`）。
- 凭据文件（**只引用路径，不要读出/打印**）：admin → zz `/root/shoppulse-admin.txt`；试用账号 → zz `/root/shoppulse-trial-accounts.txt` 及 `C:\Users\10534\Desktop\shoppulse-trial-accounts.txt`；LLM Key 在 env 文件里。
- Caddy：`/etc/caddy/Caddyfile` 中的 `shop-ai.dycxy.shop` 站点块（模板 `deploy/Caddyfile.shop-ai.dycxy.shop`）：`reverse_proxy 127.0.0.1:8802`，`flush_interval -1`（SSE），SSE 路径不压缩，以及 **`header_down Location` 重写**（把 `http://127.0.0.1:8802` 改为公网域名，修复中间件重定向）。**保留此重写**；修改前先备份 Caddyfile、`caddy validate` 后 `reload`；**不碰其他站点块**。

### 升级流程（已验证 3 次）
1. 本地：`bash deploy/build-release.sh` → `dist/shoppulse-ai-<ver>-<ts>-linux-x64.tar.gz` + `.sha256`（检查 BUILD_INFO 的 commit/dirty）。
2. 复制到 Windows → scp 到 zz `/tmp`，`sha256sum -c`。
3. 备份：`systemctl start shoppulse-backup.service`，复制最新备份为 `shoppulse-pre-vX.db.gz`（`gzip -t`，600），并手工复制 `shoppulse.db*`（db + wal + shm）到 `manual-pre-vX-<时间>/`（700）。
4. `umask 022`；解压（目录名**没有** `-linux-x64` 后缀）；记录旧版本路径到 `/root/shoppulse-prev-release.txt`；`bash /tmp/<dir>/deploy/install.sh --tarball /tmp/<file>.tar.gz --yes`；`chmod 755 /opt/shoppulse-ai /opt/shoppulse-ai/releases`。
5. 验证（HTTPS）：`/`、`/demo`、`/widget.js`、`/login`、`/landing/*.webp` 200；`/api/health` ok 且 `mode=llm`；`/admin` 307 → `https://shop-ai.dycxy.shop/login?next=%2Fadmin`；admin 与 trial1 登录；一次真实聊天 SSE（`mock:false`）；首个请求后 `user_version` 正确。
6. **回滚**（失败时，不要反复重试）：停服务 → 删除 `shoppulse.db-wal/-shm` → 从 `manual-pre-vX-*` 复制回 `shoppulse.db*` → `ln -sfn $(cat /root/shoppulse-prev-release.txt) /opt/shoppulse-ai/current` → 启动 → 查 health。保留旧 release 目录不删。

### 创建用户
```
runuser -u shoppulse -- env SHOPPULSE_DB_PATH=/var/lib/shoppulse-ai/shoppulse.db \
  node /opt/shoppulse-ai/current/deploy/user.mjs add <username> --out /root/<file>.txt --site-origin https://shop-ai.dycxy.shop
```
命令：`list` / `add` / `reset-password` / `disable` / `enable`。密码追加写入 `--out` 文件（0600），**从不打印**；只输出 site key。交给用户前整理成带登录 URL 的 600 文件。

## 6. 用户的工作规则（必须遵守）
- **Kiroween**：先写计划（PLAN）→ specs（requirements/design/tasks）→ 分批实现，每个任务带测试、单独提交。
- **分工**：Claude Code（`~/bin/cc-wb`，默认 `deepseek-v4-pro`，`--effort max`；不要设置 `CC_MODEL`）写代码；Codex（`$(npm prefix -g)/bin/codex`，`gpt-6-luna`，`low`；**升到更高档位前先问用户**）负责审查、前端 UI、落地页与生图（内置 `image_gen`）；接管的 AI **只监督**：派任务、验收（测试/构建/截图/真实浏览器）、纠偏、记录。
- **日志**：每一步写入 `log/deployment.md`（中文要点，UTC+8），并提交。
- **不循环**：同一问题失败两次 → 简化或跳过，记录并上报。
- **省用量**：少读大段输出，简短汇报。
- **push / deploy / 发布 / 发帖**：必须用户明确同意，逐次确认。
- **凭据**：绝不替用户输入密码或验证码；绝不打印密钥/密码；凭据只写入 600 文件并报告路径。
- **zz 禁区**：x-ui / xray 及其端口、WorkBuddy 网关 8788、其他 Caddy 站点（dyc.dycxy.shop、shop.dycxy.shop、tutor.dycxy.shop）、无关的系统设置。
- **真实性**：不编造客户、Logo、评价、统计数据；示例定价必须标注「示例」。
- **用户**：段志超（项目负责人），偏好中文、简短汇报；时间按 UTC+8 报告。
