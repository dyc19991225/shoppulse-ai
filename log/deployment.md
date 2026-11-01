# ShopPulse AI — 部署与工作日志

时间均为 Asia/Shanghai（UTC+8）。密钥从不打印。

- 2026-11-02 07:22 (UTC+8) 立项：git init（main），写 PLAN.md（项目负责人：段志超）、specs/requirements.md、design.md、tasks.md。WorkBuddy 网关 /v1/models 可达（含 deepseek-v4.1-flash）。
- 2026-11-02 07:22 (UTC+8) 域名检查（dns.google）：shop-ai.dycxy.shop、ai.dycxy.shop 均 NXDOMAIN（未使用）；dyc/tutor 指向 192.74.249.13。建议端口 127.0.0.1:8802（8801 为 AI tutor）。
- 2026-11-02 15:30 (UTC+8) 完成 T1（脚手架 + /api/health）、T2（config + SQLite 迁移/仓储 + seed）、T3（OpenAI 兼容流式 LLM + Mock + 选择逻辑）、T4（scrypt 认证、签名会话、登录/登出 API、middleware、登录限流、zh/en i18n）。
