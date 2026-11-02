# Tasks — ShopPulse AI

每个任务：实现 + 测试 + 单独 git commit（`T<n>: ...`）。

- [x] T1 脚手架：Next.js 14 App Router + TS + Tailwind + lucide-react + Vitest；`output: 'standalone'`；`.gitignore`（.env*、!.env.example、data/、*.db）、`.env.example`、MIT LICENSE、README 初稿；`/api/health`。
- [x] T2 配置 + DB：`config.ts`（env 解析、校验）；better-sqlite3 迁移与仓储（kb、products、sites、conversations、messages、copy_history）；默认站点种子；示例数据种子脚本 `npm run seed`。测试。
- [x] T3 LLM 层：OpenAI 兼容流式客户端（SSE 解析、超时、错误）、MockProvider、选择逻辑、`SHOPPULSE_REQUIRE_LLM`。测试（mock fetch）。
- [x] T4 认证 + i18n：scrypt 哈希、`hash-password` 脚本、签名会话、登录/登出 API、middleware、登录限流；zh/en 字典与切换。测试。
- [x] T5 检索 + 安全 + 意图 + 转人工：`retrieval.ts`、`safety.ts`（违法请求 + 广告法极限词）、`intent.ts`、`handoff.ts`、价格编造检查。测试。
- [x] T6 知识库与商品：admin API + 页面 CRUD；CSV/Excel 导入（papaparse + exceljs）、模板下载。测试（含导入解析）。
- [x] T7 聊天 API：`/api/widget/chat` SSE、`/api/widget/config`、CORS、限流、多轮上下文、商品卡片事件、入库。测试。
- [x] T8 挂件：`public/widget.js`（Shadow DOM、SSE 解析、商品卡片、转人工提示、中英文）+ `/demo` 演示页。
- [x] T9 文案工作台：`/api/admin/copywrite` + 页面（4 平台、emoji、一键复制、历史）。测试。
- [x] T10 会话与分析：会话列表/详情/标记已处理、`/api/admin/stats` 意图面板；站点管理页（site key、允许域名、限流、嵌入代码）。测试。
- [x] T11 部署产物与文档：`deploy/`（systemd unit、Caddy 片段、build-release.sh、install.sh、backup.sh）、README、DEPLOY.md、DELIVERY.md（URL TBD）。
- [ ] T12 本地真实网关验收（流式聊天首 token 计时、4 平台文案计时、CSV 导入）+ Codex 终审 + 修复。
