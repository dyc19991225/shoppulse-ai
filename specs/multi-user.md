# Multi-user + per-user data isolation (v0.2)

Approved by user 2026-11-02 11:07 (UTC+8). Local implementation only; production deploy needs a separate explicit OK.

## Goals
- Several login accounts (friends' trial accounts), each seeing **only its own** products, knowledge base, copy history, sites, conversations and stats.
- The current env-based admin (`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`) keeps working and owns all pre-existing data.
- Users are managed by a CLI on the server (`deploy/user.mjs`); no public sign-up.

## Data model (schema v2, `migrate()` in src/lib/db.ts)
- `users(id INTEGER PK, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('admin','user')) DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, session_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`.
- Migration v2 inserts the bootstrap admin row **id=1, username 'admin', role admin, password_hash ''** (so existing rows have a valid owner) and adds `owner_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)` to `kb_entries`, `products`, `copy_history`, `sites`; existing rows therefore belong to user 1. Indexes on owner_id.
- `products.sku` uniqueness becomes **per owner** (`UNIQUE(owner_id, sku)`): rebuild the products table inside the migration (SQLite cannot drop a column constraint), preserving ids and data; `foreign_keys` must be handled correctly during the rebuild (copy_history.product_id references products).
- Conversations/messages have no owner column; their owner is `sites.owner_id` via `conversations.site_id`.
- Migration runs in one transaction; v1 → v2 must work on a copy of a populated v1 DB (test it).

## Env admin bootstrap / fallback
- On DB open (runtime, `getDb`), `ensureEnvAdmin(db, config)`: if `ADMIN_USERNAME` differs from the bootstrap row's username and no user has that name, rename user 1 to it (only while user 1 still has an empty password hash); if the admin row's `password_hash` is empty, the env hash is used for login (not copied, so rotating the env hash keeps working).
- Login: look up the user by username (case-insensitive); reject disabled users; verify scrypt hash from DB; for the env admin user, accept the env `ADMIN_PASSWORD_HASH` (or the dev-only `ADMIN_PASSWORD`) when the DB hash is empty. Same generic error + existing rate limit for all failures; keep timing-stable dummy verify when the user is unknown.

## Sessions
- Session payload: `sub` (username), `uid` (user id), `ver` (session_version). Edge middleware keeps verifying only the signature/expiry.
- Every admin API/page resolves the session to a **current DB user**: must exist, not disabled, uid+username match, `ver` equals `session_version`. Otherwise 401 (API) / redirect to login (page). Legacy sessions without uid (issued before v2) are rejected (users simply log in again).
- `disable` and `reset-password` bump `session_version` → existing sessions die.

## Isolation rules
- Every repository function for kb, products, sites, copy_history, conversations, messages and stats takes an `ownerId` and filters by it — list, get, update, delete, import/upsert-by-SKU, CSV template is static. Get/update/delete of another owner's id returns **404** (never 403, never the row).
- Conversations: list/detail/mark-handled join `sites` and filter `sites.owner_id = ownerId`.
- Stats (7-day sessions, handoff rate, intent mix, top questions) only over the owner's sites.
- Copywriting: product lookup by id must be owner-scoped; history owner-scoped.
- Site create assigns `owner_id`; site_key stays globally unique (it is the public widget id).
- Widget (`/api/widget/chat`, `/api/widget/config`): resolve the site by key, then retrieve KB + products **only for `site.owner_id`**; price guard uses the same owner-scoped products.
- Roles: `admin` and `user` see only their own data in the UI/API (keeps the code simple). Role is shown in the sidebar; no cross-user admin view in this version.
- Sidebar shows the logged-in username.

## CLI `deploy/user.mjs` (plain Node ESM, runs inside the standalone release with its bundled better-sqlite3; no tsx)
```
node deploy/user.mjs <command> [args] [--db PATH]   # default --db = $SHOPPULSE_DB_PATH
  list                                   # id, username, role, disabled, created_at (no hashes)
  add <username> --out FILE [--role user|admin] [--site-origin https://...]
  reset-password <username> --out FILE
  disable <username>  |  enable <username>
```
- Refuses to run unless `PRAGMA user_version` ≥ 2 (start the service once to migrate) — never duplicates migration logic.
- `add`/`reset-password` generate a strong random password (≥ 20 chars, URL-safe, from crypto.randomBytes), hash with the same scrypt parameters as src/lib/auth/password.ts (N=16384, r=8, p=1, 32-byte key, `salthex:hashhex`), and **append** `username<TAB>password` lines to `--out` (created with mode 0600; refuse if `--out` is missing). The password is never written to stdout/stderr.
- `add` also creates one default site for the new user (random site key, allowed origins from `--site-origin` if given, rate limit 30) so the widget works immediately; prints the site key (not secret).
- Usernames: `^[a-z0-9][a-z0-9_.-]{1,31}$`, unique case-insensitively.
- Exit non-zero with a clear message on errors; uses a transaction; busy_timeout 5000.

## Tests (vitest)
- Migration v1→v2 on a populated DB: all rows owner 1, ids preserved, per-owner SKU uniqueness, copy_history links intact.
- Auth: DB user login, disabled user rejected, wrong password, env-admin fallback, session_version bump invalidates sessions, legacy session rejected.
- Isolation: two users; A cannot list/get/update/delete/import-over B's kb/products/sites/conversations/copy history/stats, including guessed ids (404).
- Widget: chat for B's site key retrieves only B's KB/products.
- CLI: add/list/disable/reset-password against a temp DB; password only in the out file (mode 600), not stdout.

## Deploy (prepared, NOT run) — see DEPLOY.md "升级到 v0.2（多用户）"
1. Backup prod DB (`systemctl start shoppulse-backup.service` + manual copy).
2. Build release, upload, `install.sh` upgrade (env untouched) → service restart runs migration v2 automatically.
3. Create trial1–3 with the CLI as the `shoppulse` user, collect the credentials file, copy to `C:\Users\10534\Desktop\shoppulse-trial-accounts.txt`.
