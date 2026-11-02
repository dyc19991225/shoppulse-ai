# v0.3 Merchant workspace features (SaleSmartly-inspired) + restyle

Requested by user 2026-11-02 11:55 / 11:58 (UTC+8). Local only. Reference: SaleSmartly public site and public help center
(help-en.salesmartly.com: Chat quick start, Multi-function chat window, Customer management, Data analysis, Automation). We borrow
**module ideas and layout/visual style only** — no copy, logos, screenshots or assets. No invented numbers/customers: every metric
is a real per-user DB aggregate, otherwise an empty state.

## SaleSmartly admin modules (from public docs)
| SaleSmartly module | What it does | Fit for ShopPulse (single-site small merchant, widget chat + AI) |
|---|---|---|
| Chat / omnichannel inbox | unified conversation workspace, agent replies, robot hosting / human takeover | **Yes** – we have widget conversations + handoff flag, but no agent reply |
| Quick reply / script library | saved phrases sent into a chat | **Yes** – cheap, very useful |
| Session tags + visitor tags/notes | mark conversations/customers, filter, QA review | **Yes** – conversation tags + internal note |
| Add to FAQ from a message | turn a visitor question into knowledge-base corpus | **Yes** – we have a KB |
| Automation: welcome message / auto reply | trigger → reply rules | **Partly** – per-site welcome message (full flow builder: too big) |
| Reports: service overview, comprehensive report, customer analysis | sessions, messages, response time, trends, filters | **Yes** – reports summary page |
| Contact list / CRM, bulk messaging, multi-channel (WhatsApp/IG…), team seats & assignment, translation, ad attribution | | No (no channels/contacts/teams in our stack) – out of scope |

## Selected (priority order; if scope is too big ship F1–F3 and list the rest)
- **F1 Reports summary** `/admin/reports` + `GET /api/admin/reports/summary?days=7|30|90` (default 7, anything else → 400).
  Owner-scoped (conversations via `sites.owner_id`, copy_history/kb/products via `owner_id`). Returns:
  `range {from,to,days}`, `kpis {conversations, messages, visitorMessages, aiReplies, agentReplies, handoffs, handoffRate, handled, pendingHandoffs, copiesGenerated, kbEntries, products}`,
  `daily [{date, conversations, messages, handoffs, copies}]` (every day in range present, zero-filled, UTC dates),
  `intents [{intent, count}]`, `topQuestions [{text, count}]` (normalised visitor messages, top 10), `sites [{id,name,conversations}]`.
  Page: KPI cards, a daily trend chart (inline SVG, no new chart dependency), intent bars, top questions, per-site table,
  range switch 7/30/90; empty state when there is no data. Dashboard `/admin` links to it.
- **F2 Quick replies** (script library). Table `quick_replies(id, owner_id, title, content ≤2000, created_at, updated_at)`.
  CRUD `GET/POST /api/admin/quick-replies`, `PUT/DELETE /api/admin/quick-replies/[id]` (other owner → 404). Admin page
  `/admin/quick-replies`; in the conversation detail the reply box offers a quick-reply picker that inserts the text.
- **F3 Inbox: agent reply + tags + note.**
  - `POST /api/admin/conversations/[id]/messages {content}` stores a message with role `agent` (owner-scoped; 404 otherwise),
    updates `last_at`. Optional `markHandled`.
  - Widget receives agent replies: `GET /api/widget/messages?site_key&conversation_id&visitor_id&after=<ISO>` returns only
    `agent` messages of that conversation when site key, origin check (same rules as chat) and visitor_id all match; the
    widget polls every 5 s only while the panel is open and the conversation has needs_human (or after the first agent
    message), stops on close. Rate-limited like chat.
  - Conversations get `tags TEXT NOT NULL DEFAULT '[]'` (≤10 tags, each 1–20 chars, trimmed, dedup) and `note TEXT NOT NULL DEFAULT ''`
    (≤2000); `PATCH /api/admin/conversations/[id] {tags?, note?, handled?}`; list supports `?tag=`; UI chips + note box.
- **F4 Add to knowledge base from a conversation**: in conversation detail, a visitor message has "加入知识库" which opens the
  KB create form prefilled (question = visitor text, answer = following AI/agent reply). Uses the existing owner-scoped KB API.
- **F5 Welcome message per site**: `sites.welcome_message TEXT NOT NULL DEFAULT ''` (≤500), editable on the sites page,
  returned by `/api/widget/config`, shown by the widget as the first assistant bubble (not stored as a message).

Schema: one migration v3 (quick_replies, conversations.tags/note, sites.welcome_message, index quick_replies(owner_id)).
Role `agent` must be accepted everywhere messages are read (conversation detail, stats count agent replies separately; LLM history
for the next visitor turn includes agent messages as assistant turns).

## Restyle (Codex, one pass each)
Landing page and admin backend in a clean SaaS style inspired by SaleSmartly's layout: left icon+label sidebar with grouped
sections (工作台 / 对话 / 知识与商品 / 营销 / 设置), top bar with page title + user, light grey canvas, white rounded cards,
one brand accent colour, KPI cards with small trend labels from real data, generous spacing; landing: hero with product
screenshot-style mock built from our own UI (no fake logos/customer counts/ratings), feature grid, how-it-works, CTA.
Tailwind/CSS already in the project only; no new UI dependencies. Screenshots into `screenshots/`.

## Tests
Per feature: owner isolation (other user → 404 / not listed / not counted), validation (400), report aggregates on a seeded
fixture with exact numbers and zero-filled days, widget messages endpoint (wrong visitor/site/origin → 403/404, only agent
messages after `after`), migration v3 on a v2 DB.
