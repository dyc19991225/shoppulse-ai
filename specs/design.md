# Design — ShopPulse AI

## 架构
```
任意商家网站 ──<script widget.js>──► /api/widget/chat (SSE, CORS+限流)
                                         │
管理员浏览器 ──► /admin/* (Next.js RSC/客户端) ──► /api/admin/* (cookie 会话)
                                         │
                          lib/ (retrieval, safety, intent, llm, db)
                                         │
                       SQLite (better-sqlite3, data/shoppulse.db, WAL)
                                         │
                 WorkBuddy 网关 (OpenAI 兼容, SSE) / MockProvider
```

## 目录
- `src/app/` — 页面：`/`（落地页）、`/login`、`/admin`（总览+意图面板）、`/admin/knowledge`、`/admin/products`、`/admin/copywriting`、`/admin/conversations`、`/admin/sites`、`/demo`（挂件演示页）。
- `src/app/api/` — `health`、`auth/login|logout`、`admin/knowledge`、`admin/products`、`admin/products/import`、`admin/copywrite`、`admin/conversations`、`admin/stats`、`admin/sites`、`widget/chat`（POST SSE）、`widget/config`（GET）。
- `public/widget.js` — 原生 JS（无依赖，< 15KB），Shadow DOM，fetch + ReadableStream 解析 SSE。
- `src/lib/` — `config.ts`、`db.ts`（迁移+仓储）、`auth.ts`、`llm/`（openai.ts、mock.ts、index.ts）、`retrieval.ts`、`safety.ts`、`intent.ts`、`handoff.ts`、`ratelimit.ts`、`cors.ts`、`importer.ts`、`copywriting.ts`、`chat.ts`、`i18n/`（zh.ts、en.ts）。
- `tests/` — Vitest 单元 + 路由处理器测试（临时 SQLite 文件）。

## 数据模型
- `kb_entries(id, type, title, content, keywords, enabled, created_at, updated_at)`
- `products(id, sku UNIQUE NULL, name, category, price REAL, stock INT, description, selling_points, image_url, url, enabled, created_at, updated_at)`
- `sites(id, name, site_key UNIQUE, allowed_origins TEXT(JSON), rate_limit_per_min INT, created_at)` — 首次启动自动创建 "默认站点"（允许 localhost）。
- `conversations(id TEXT, site_id, visitor_id, started_at, last_at, needs_human INT, handled INT, top_intent)`
- `messages(id, conversation_id, role, content, intent, created_at)`
- `copy_history(id, product_id, params JSON, outputs JSON, created_at)`

## 聊天流程（/api/widget/chat）
1. CORS 检查 Origin ∈ site.allowed_origins；限流（内存滑动窗口，key=site_key+IP）。
2. 输入校验（≤ 1000 字）；安全检查（违法 → 固定拒绝语）；转人工检测 → 标记 + 发送 `handoff` 事件。
3. 意图分类并入库；检索 KB top-4 + 商品 top-3。
4. System prompt：只能依据【资料】回答；资料没有的价格/政策/时效必须说"暂无该信息，可为您转人工"；不得给出资料外的价格；中文优先，跟随用户语言；简洁。
5. 历史：最近 6 轮。
6. SSE 事件：`meta`（conversationId, mock）、`products`（来自 DB 的卡片）、`delta`（文本片段）、`handoff`、`done`、`error`。
7. 回答结束后后置检查：若回答包含资料中不存在的价格数字（¥/元 金额），追加更正提示（防编造）。

## 文案流程（/api/admin/copywrite）
- 输入：productId、audience、sellingPoints[]、tone、platforms[]、lang。
- 安全前置（违法/虚假宣传请求拒绝）→ 每个平台独立 prompt（平台格式规则：小红书标题+正文+话题标签；朋友圈短文案；详情页结构化卖点段落；抖音 15–30s 分镜脚本）→ 并行调用（非流式，JSON 返回）→ 后置极限词清理并返回 warnings。

## 认证
- scrypt(N=16384) 哈希 `salt:hash` hex；会话 token = base64url(payload).HMAC-SHA256；middleware 校验 `/admin` 与 `/api/admin`（Edge 中用 Web Crypto 验签）。

## 安全
- 所有 SQL 参数化；输入长度限制；导入文件大小限制；挂件内容用 textContent 渲染（无 innerHTML 注入）；商品链接仅允许 http(s)。
- 密钥只从环境读取；日志不输出密钥。

## 部署（zz，待确认）
- box：`npm ci && npm run build` → `.next/standalone` + `.next/static` + `public` 打包 `release.tgz`（含为 linux-x64 编译的 better-sqlite3；zz 上 Node 主版本需与 box 一致）。
- zz：`/opt/shoppulse-ai`，系统用户 `shoppulse`，systemd `shoppulse-ai.service`（`PORT=8802 HOSTNAME=127.0.0.1`，`MemoryMax=400M`），环境文件 `/opt/shoppulse-ai/shoppulse.env`（chmod 600）。
- Caddy：新增 `shop-ai.dycxy.shop { reverse_proxy 127.0.0.1:8802 }`（SSE 需 `flush_interval -1`），先备份 Caddyfile，`caddy validate` 后 reload。
- 备份：SQLite 每日 `.backup` 到 `/var/backups/shoppulse-ai`，保留 14 天。
