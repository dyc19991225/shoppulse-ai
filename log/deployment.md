# ShopPulse AI — 部署与工作日志

时间均为 Asia/Shanghai（UTC+8）。密钥从不打印。

- 2026-11-02 07:22 (UTC+8) 立项：git init（main），写 PLAN.md（项目负责人：段志超）、specs/requirements.md、design.md、tasks.md。WorkBuddy 网关 /v1/models 可达（含 deepseek-v4.1-flash）。
- 2026-11-02 07:22 (UTC+8) 域名检查（dns.google）：shop-ai.dycxy.shop、ai.dycxy.shop 均 NXDOMAIN（未使用）；dyc/tutor 指向 192.74.249.13。建议端口 127.0.0.1:8802（8801 为 AI tutor）。
- 2026-11-02 15:30 (UTC+8) 完成 T1（脚手架 + /api/health）、T2（config + SQLite 迁移/仓储 + seed）、T3（OpenAI 兼容流式 LLM + Mock + 选择逻辑）、T4（scrypt 认证、签名会话、登录/登出 API、middleware、登录限流、zh/en i18n）。
- 2026-11-02 07:38 (UTC+8) 批次1（Claude Code, effort max，约 15 分钟）：T1 脚手架、T2 配置+SQLite、T3 LLM 流式客户端+Mock、T4 认证+i18n，各自提交；npm test 101 passed；npm run build 成功。仅 .env.example 被跟踪。
- 2026-11-02 07:42 (UTC+8) 完成 T5：retrieval（中文二元组+英文词打分）、safety（违法请求拦截 + 广告法极限词清理）、intent（7 类规则意图）、handoff（显式/投诉转人工）、price-guard（资料外价格检测与更正提示）；新增 63 个测试，npm test 164 passed。
- 2026-11-02 07:45 (UTC+8) 完成 T6：知识库/商品 admin API + 双语后台（侧边栏布局、知识库与商品 CRUD 页面）、CSV/Excel 导入（papaparse + exceljs，中英文表头别名、按 SKU upsert、逐行错误、5MB/5000 行限制）、CSV 模板下载；新增 30 个测试，npm test 194 passed；tsc 通过。
