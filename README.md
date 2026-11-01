# ShopPulse AI

面向中国中小商家的 **AI 客服聊天挂件 + 营销文案助手**。
An AI customer-service chat widget and marketing copywriting assistant for small retailers.

> 状态：开发中（M2 基础阶段）。部署与线上地址 TBD。

## 功能

- 商家后台：知识库（FAQ / 退换货政策 / 店铺信息）、商品管理与 Excel/CSV 导入、文案工作台（小红书 / 朋友圈 / 电商详情页 / 抖音脚本）、会话记录与意图分析、站点与限流设置。
- 可嵌入挂件：一段 `<script>` 即可在任意网站右下角显示，SSE 流式回复、多轮上下文、基于知识库与商品回答、转人工提示、商品卡片。
- 无 API Key 时自动进入 Mock 演示模式；生产可要求必须使用真实模型。

## 技术栈

Next.js 14（App Router）+ TypeScript（strict）+ Tailwind CSS 3 + lucide-react + better-sqlite3 + Vitest。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 按需填写，切勿提交
npm run seed                 # 可选：写入示例知识库与商品
npm run dev                  # http://localhost:3000
```

生成管理员密码哈希并写入 `.env.local`：

```bash
npm run hash-password -- 'your-password'   # 输出 salt:hash
# .env.local
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD_HASH=<上一步输出>
# SESSION_SECRET=<随机 32 字节 hex>
```

生成 `SESSION_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

访问 `http://localhost:3000/admin` 会自动跳转到 `/login`。未登录访问 `/api/admin/*` 返回 401。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建（standalone） |
| `npm test` | Vitest 单元/路由测试 |
| `npm run seed` | 初始化数据库并写入示例数据 |

## 目录

```
src/app/      Next.js App Router 页面与 API
src/lib/      配置、数据库、LLM、检索、安全、i18n 等
public/       挂件脚本与静态资源
scripts/      种子与工具脚本
tests/        Vitest 测试（使用临时 SQLite 文件）
specs/        需求、设计、任务
```

## 许可

[MIT](./LICENSE)
