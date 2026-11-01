# Requirements — ShopPulse AI

EARS 风格；R = 需求，AC = 验收标准。

## R1 管理员认证
- AC1.1 单管理员，凭据来自环境变量 `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`（scrypt 哈希，提供 `npm run hash-password` 生成）。开发环境可用 `ADMIN_PASSWORD`（明文，仅非生产）。
- AC1.2 登录成功后签发 HMAC 签名、httpOnly、SameSite=Lax（生产 Secure）会话 cookie，有效期 7 天，密钥 `SESSION_SECRET`（生产缺失则拒绝启动登录）。
- AC1.3 所有 `/admin/**` 页面与 `/api/admin/**` 接口未登录时分别重定向到登录页 / 返回 401。
- AC1.4 登录失败按 IP 限流（如 5 次/分钟），比较使用常量时间。

## R2 知识库
- AC2.1 条目字段：类型（faq / policy / shop_info / other）、标题、内容、关键词、启用状态；支持增删改查与搜索。
- AC2.2 检索：基于中文二元组 + 英文词的关键词打分，返回 top-k（默认 4）命中条目及分数。

## R3 商品
- AC3.1 字段：名称、SKU、分类、价格（分为单位存储或 REAL）、库存、描述、卖点、图片 URL、商品链接、启用状态；CRUD。
- AC3.2 Excel（.xlsx）/ CSV 导入：表头支持中英文别名（名称/name、价格/price、SKU、分类/category、库存/stock、描述/description、卖点/selling_points、图片/image、链接/url）；按 SKU（有则）upsert；返回成功 / 失败行数与逐行错误；文件 ≤ 5MB、≤ 5000 行；提供 CSV 模板下载。

## R4 文案工作台
- AC4.1 选择商品、目标人群、卖点（可编辑）、语气（活泼 / 专业 / 温馨 / 高级感 / 幽默），选择平台：小红书、朋友圈、电商详情页、抖音脚本（可多选，默认全选）。
- AC4.2 输出包含 emoji，每个平台一个卡片 + 一键复制；保存生成历史。
- AC4.3 违反《广告法》极限词（最、第一、国家级、100%、根治 等）或违法请求（假货、刷单、虚假功效、医疗功效承诺）时拒绝或清理并给出提示。

## R5 聊天挂件
- AC5.1 一段 `<script src=".../widget.js" data-site-key="..." async></script>` 即可在任意网站右下角显示浮动按钮与聊天窗口；Shadow DOM 隔离样式；中英文自动/可配。
- AC5.2 SSE 流式输出；会话 ID 存 localStorage，服务端保留多轮上下文（最近 N 轮）。
- AC5.3 回答仅基于检索到的知识库与商品；价格、政策、物流时效等不在资料中时，明确说不确定并建议转人工，不得编造。
- AC5.4 识别转人工请求（人工、真人、客服、投诉、human、agent 等），标记会话 `needs_human` 并在挂件中提示。
- AC5.5 回答相关商品时，以服务端数据库数据（真实价格）渲染商品卡片（名称、价格、图片、链接）。
- AC5.6 违法/不当请求礼貌拒绝。

## R6 站点、限流与 CORS
- AC6.1 站点（site）含 `site_key`（公开）、名称、允许域名列表、每分钟请求上限。
- AC6.2 挂件接口按 site_key + 客户端 IP 限流，超限返回 429。
- AC6.3 CORS：仅当 `Origin` 在该站点允许域名中才回 `Access-Control-Allow-Origin`，否则 403；OPTIONS 预检同理。

## R7 会话与意图分析
- AC7.1 会话列表（站点、开始时间、消息数、是否需人工、主要意图），详情查看全部消息，可标记已处理。
- AC7.2 规则意图分类：商品咨询、价格优惠、物流配送、退换售后、投诉、转人工、其他；面板展示各意图占比、近 7 天会话数、转人工率、热门问题词。

## R8 LLM 与 Mock
- AC8.1 OpenAI 兼容 `/chat/completions`，`stream: true`；`SHOPPULSE_LLM_BASE_URL`（默认网关）、`SHOPPULSE_LLM_MODEL`（默认 deepseek-v4.1-flash）、`SHOPPULSE_LLM_API_KEY`；超时与错误处理。
- AC8.2 无 key 时 Mock 模式：基于检索结果模板化流式回答与文案，UI 显示"演示模式"标识。
- AC8.3 `SHOPPULSE_REQUIRE_LLM=1`（生产）时缺 key 则 `/api/health` 报错状态，且不进入 mock。

## R9 国际化
- AC9.1 后台与挂件中英双语，默认中文，可切换，偏好存 cookie / localStorage。

## R10 非功能
- AC10.1 `npm test` 全部通过；`npm run build` 成功（standalone 输出）。
- AC10.2 仓库不含任何密钥；`.env.example` 列出全部变量。
- AC10.3 内存友好：生产 Node 进程目标 < 300MB RSS。
- AC10.4 文档：README、DELIVERY.md、DEPLOY.md（zz 部署步骤、挂件嵌入代码、管理员指南，线上 URL 标 TBD）、MIT LICENSE。
