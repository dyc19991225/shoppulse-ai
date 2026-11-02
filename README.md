# ShopPulse AI

**AI 客服聊天挂件 + 营销文案助手**，面向中国中小零售商家。
An embeddable AI customer-service widget and marketing copywriting studio for small retailers.

[中文](#中文) · [English](#english) · [部署 DEPLOY](./DEPLOY.md) · [交付 DELIVERY](./DELIVERY.md)

> 状态：功能开发完成（T1–T11），等待本地真实网关验收（T12）与生产部署确认。
> Status: feature-complete, pending real-gateway acceptance and deployment confirmation.
> 线上地址 / Live URL: **TBD**

---

## 中文

### 功能

- **商家后台**（单管理员登录）
  - 知识库：FAQ、退换货政策、店铺信息等条目 CRUD 与检索。
  - 商品：商品 CRUD，Excel（.xlsx）/ CSV 批量导入（按 SKU upsert，逐行错误反馈），CSV 模板下载。
  - 文案工作台：小红书、朋友圈、电商详情页、抖音脚本四平台并行生成，带 emoji、一键复制、生成历史。
  - 会话与意图：会话列表/详情/标记已处理，近 7 天会话数、转人工率、意图占比、热门问题。
  - 站点管理：site key、允许域名、每分钟限流、嵌入代码一键复制。
- **可嵌入挂件**：一段 `<script>` 即用；Shadow DOM 隔离样式；SSE 流式回复；多轮上下文；基于知识库与商品回答；转人工提示；服务端真实商品卡片。
- **内容安全**：违法/虚假宣传请求拦截；广告法极限词清理与提示；回答中资料外价格后置检查并更正。
- **无 Key 也能跑**：无 `SHOPPULSE_LLM_API_KEY` 时自动进入 Mock 演示模式，开箱即用；生产可强制要求真实模型。
- **中英双语**：后台与挂件均支持中文/英文切换，默认中文。

### 技术栈

Next.js 14（App Router，standalone 输出）· TypeScript strict · Tailwind CSS 3 · lucide-react · better-sqlite3（WAL）· Vitest。
OpenAI 兼容 LLM 网关（默认 `deepseek-v4.1-flash`），仅流式读取 `content`，忽略 `reasoning_content`。

### 快速开始

```bash
npm install
cp .env.example .env.local     # 按需填写；.env* 已被 .gitignore 忽略
npm run seed                   # 可选：写入示例知识库、商品与默认站点
npm run dev                    # http://localhost:3000
```

生成管理员密码哈希（scrypt）：

```bash
npm run hash-password -- 'your-password'   # 输出 salt:hash
```

`.env.local`：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<上一步输出>
SESSION_SECRET=<随机 32 字节 hex>
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

访问 `http://localhost:3000/admin` 会自动跳转到 `/login`。未登录访问 `/api/admin/*` 返回 401。
挂件演示页：`http://localhost:3000/demo`。

### Mock 演示模式

- 未设置 `SHOPPULSE_LLM_API_KEY` 时，聊天与文案使用确定性的 Mock 生成器，仍会走检索、安全、意图与商品卡片逻辑；后台显示“演示模式”标识。
- 设置 `SHOPPULSE_LLM_API_KEY` 后自动切换到真实网关。
- 生产建议设置 `SHOPPULSE_REQUIRE_LLM=1`：缺少 Key 时 `/api/health` 返回 503 且绝不回退到 Mock。
- 网关地址、模型、超时均可通过环境变量覆盖；密钥只从环境读取，不会写入日志或响应。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SHOPPULSE_DB_PATH` | `./data/shoppulse.db` | SQLite 数据库路径；测试使用临时文件 |
| `SHOPPULSE_LLM_BASE_URL` | `http://192.74.249.13:8788/v1` | OpenAI 兼容网关地址 |
| `SHOPPULSE_LLM_MODEL` | `deepseek-v4.1-flash` | 模型名 |
| `SHOPPULSE_LLM_API_KEY` | 空 | 网关密钥；为空时 Mock 模式；切勿提交 |
| `SHOPPULSE_LLM_TIMEOUT_MS` | `60000` | LLM 请求超时 |
| `SHOPPULSE_REQUIRE_LLM` | `0` | `1` 时缺 Key 即视为配置错误，不回退 Mock |
| `ADMIN_USERNAME` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD_HASH` | 空 | scrypt `salt:hash`，生产必填 |
| `ADMIN_PASSWORD` | 空 | 仅开发环境可用的明文回退 |
| `SESSION_SECRET` | 空 | 会话签名密钥，生产必填 |

生产运行由 systemd 传入 `NODE_ENV=production`、`PORT=8802`、`HOSTNAME=127.0.0.1`。
完整示例见 [`.env.example`](./.env.example)。

### 挂件嵌入

在商家站点 `</body>` 前加入：

```html
<script src="https://shop-ai.dycxy.shop/widget.js" data-site-key="YOUR_SITE_KEY" async></script>
```

`YOUR_SITE_KEY` 与允许域名在后台「站点管理」中配置；修改后在挂件配置页复制最新代码。
线上域名 **TBD**，部署前请使用实际域名（见 [DEPLOY.md](./DEPLOY.md)）。

### 脚本与测试

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建（`.next/standalone`） |
| `npm start` | 运行生产构建（非 standalone 方式） |
| `npm test` | Vitest 单元/路由/脚本测试（临时 SQLite 文件） |
| `npm run seed` | 初始化数据库并写入示例数据 |
| `npm run hash-password -- 'pw'` | 生成管理员密码哈希 |
| `bash deploy/build-release.sh` | 构建并打包部署产物 |
| `bash deploy/backup.sh` | SQLite 在线备份（14 天保留） |

测试覆盖配置、数据库迁移与仓储、LLM 流式解析、认证/中间件、检索/安全/意图/转人工/价格防编造、CRUD 与导入、聊天 SSE/CORS/限流、挂件脚本（jsdom）、文案、会话与统计、站点，以及部署脚本。

### 目录

```
src/app/        页面与 API（App Router）
src/components/ 后台 UI 组件
src/lib/        配置、数据库、LLM、检索、安全、i18n 等
public/         widget.js 与静态资源
scripts/        种子与密码工具
tests/          Vitest 测试
deploy/         systemd、Caddy、构建/安装/备份脚本
specs/          需求、设计、任务
```

### 部署

目标服务器 zz（2 核 / 1.9G），systemd + 现有 Caddy 新增站点块，详见 [DEPLOY.md](./DEPLOY.md)。
**生产部署与域名需用户确认，目前尚未部署；线上 URL TBD。**

### 许可

[MIT](./LICENSE)

---

## English

### What it does

- **Admin console** (single admin): knowledge base (FAQs, policies, shop info), products with Excel/CSV import, copywriting studio for Xiaohongshu / WeChat Moments / product detail page / Douyin script with emoji and one-click copy, conversation history with intent analytics and human-handoff flags, and widget site management (site key, allowed origins, rate limit, embed snippet).
- **Embeddable widget**: one `<script>` tag, Shadow DOM styling, SSE streaming, multi-turn context, knowledge-base-grounded answers, handoff notice, real product cards.
- **Safety**: blocks illegal/false-advertising requests, cleans China Advertising Law superlatives, and corrects prices not present in the knowledge base.
- **Mock mode**: without an API key the app runs deterministically out of the box; production can require the real model.
- **Bilingual**: Chinese-first admin and widget with an English switch.

### Quickstart

```bash
npm install
cp .env.example .env.local
npm run seed          # optional demo data
npm run dev           # http://localhost:3000
```

Create an admin password hash with `npm run hash-password -- 'your-password'`, then set `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` in `.env.local`. Sign in at `/admin`; try the widget at `/demo`.

### Tests and build

```bash
npm test        # Vitest, temporary SQLite files
npm run build   # Next.js standalone output in .next/
```

### Deployment

Deployment artifacts live in [`deploy/`](./deploy) and are documented in [DEPLOY.md](./DEPLOY.md). Live URL: **TBD** (not deployed yet; pending confirmation).

### License

[MIT](./LICENSE)
