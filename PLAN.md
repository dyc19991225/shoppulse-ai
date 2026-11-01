# ShopPulse AI — 项目计划（PLAN）

**项目负责人：段志超**

面向中国中小商家（通用零售）的「AI 客服聊天挂件 + 营销文案助手」。

## 目标
1. 商家后台（单管理员登录）：知识库 CRUD（FAQ / 退换货政策 / 店铺信息）、商品 CRUD + Excel/CSV 导入、文案工作台（小红书 / 朋友圈 / 电商详情页 / 抖音脚本，带 emoji、一键复制）、会话记录 + 客户意图分析面板、挂件站点设置（站点 key、允许域名、限流、嵌入代码）。
2. 可嵌入的右下角浮动聊天挂件（一段 `<script>`）：SSE 流式回复、多轮上下文、基于知识库与商品回答、识别转人工并标记、渲染商品卡片。
3. API：聊天（流式）、文案生成、知识库、商品导入；SQLite 存储。
4. 无 API Key 时自动 Mock 模式，开箱即用；生产必须使用真实模型并经过实测。
5. 内容安全：拒绝违法 / 虚假宣传请求；挂件不得编造知识库之外的价格或政策。
6. 按站点 key 限流；CORS 仅放行已配置域名。

## 已确认配置
| 项 | 选择 |
|---|---|
| P1 行业 | 通用零售 |
| P2 模型 | WorkBuddy 网关（OpenAI 兼容）`http://192.74.249.13:8788/v1`，默认 `deepseek-v4.1-flash`，可配置；密钥运行时读环境变量 `SHOPPULSE_LLM_API_KEY` |
| P4 部署 | 服务器 zz（192.74.249.13，2 核 / 1.9G + 1G swap），systemd + 现有 Caddy 新站点块；Next.js 在 box 上 standalone 构建后上传。**生产部署与域名需用户确认，暂不部署** |
| P5 技术栈 | Next.js 14 App Router + TypeScript + Tailwind + lucide-react；better-sqlite3；Vitest |
| P6 语言 | 中英双语，中文优先 |
| P7 仓库 | GitHub 公开仓库 `shoppulse-ai`（用户名待定）。**暂不建库、不推送**；只提交 `.env.example`，`.gitignore` 覆盖 `.env*`；MIT LICENSE + README |
| P8 导入 | Excel（.xlsx）/ CSV |

## 工作流
- Grok Bot 监督；Claude Code（`~/bin/cc-wb`，deepseek-v4.1-flash）写代码；Codex（gpt-6-luna，low）仅在最后审查，或在 Claude Code 同一问题失败两次时接手。卡住时简化或跳过并记录，不做 Codex 重试循环。
- Kiroween 流程：PLAN → specs/requirements.md → specs/design.md → specs/tasks.md → 按批实现，每个任务带测试并单独提交。
- 每一步记录在 `log/deployment.md`（UTC+8 时间戳）。绝不打印或提交密钥。

## 里程碑
- M1 规划与 specs
- M2 基础：脚手架、DB、LLM Provider、认证、i18n
- M3 业务：知识库 / 商品 / 导入、检索与安全、聊天 SSE、挂件、文案
- M4 会话分析、部署产物、文档
- M5 本地真实网关验收（流式聊天、4 平台文案、CSV 导入）+ Codex 终审
- M6（待用户确认）zz 生产部署 + 域名 + GitHub 推送

## 部署建议（待确认）
- 域名：`shop-ai.dycxy.shop`（首选）或 `ai.dycxy.shop`；2026-11-02 经公共 DNS 查询均未解析（NXDOMAIN），未被占用。
- 端口：`127.0.0.1:8802`（8801 已被 AI tutor 占用；部署前在 zz 上用 `ss -tlnp` 复核）。
