import type { DB } from './db';
import { INTENTS, type Intent } from './intent';

/**
 * Merchant reporting (F1). Every number is a real aggregate over the owner's
 * rows — conversations via `sites.owner_id`, copy history / KB / products via
 * `owner_id`. Day buckets are UTC dates and always zero-filled.
 */

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportRangeDays = (typeof REPORT_RANGES)[number];
export const DEFAULT_REPORT_DAYS: ReportRangeDays = 7;
export const REPORT_DAYS_PARAM = 'days';
export const TOP_QUESTIONS_LIMIT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportRange {
  from: string;
  to: string;
  days: number;
}

export interface ReportKpis {
  conversations: number;
  messages: number;
  visitorMessages: number;
  aiReplies: number;
  agentReplies: number;
  handoffs: number;
  handoffRate: number;
  handled: number;
  /** All-time backlog: handoff conversations still unhandled (not scoped to the report range). */
  pendingHandoffs: number;
  copiesGenerated: number;
  kbEntries: number;
  products: number;
  /** Handoff conversations only; null until at least one agent reply exists. */
  avgAgentFirstResponseSec: number | null;
}

export interface ReportToday {
  conversations: number;
  /** All-time backlog, not "today": same value as ReportKpis.pendingHandoffs. */
  pendingHandoffs: number;
}

export interface DailyReportRow {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  conversations: number;
  messages: number;
  handoffs: number;
  copies: number;
}

export interface ReportIntent {
  intent: Intent;
  count: number;
}

export interface ReportTopQuestion {
  text: string;
  count: number;
}

export interface ReportSite {
  id: number;
  name: string;
  conversations: number;
}

export interface ReportSummary {
  range: ReportRange;
  kpis: ReportKpis;
  today: ReportToday;
  daily: DailyReportRow[];
  intents: ReportIntent[];
  topQuestions: ReportTopQuestion[];
  sites: ReportSite[];
}

export function isReportDays(value: unknown): value is ReportRangeDays {
  return (REPORT_RANGES as readonly unknown[]).includes(value);
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** NFKC + whitespace-collapsed message text; used for grouping and display. */
export function normalizeQuestion(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

interface ReportOptions {
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export function getReportSummary(
  db: DB,
  ownerId: number,
  days: number,
  options: ReportOptions = {},
): ReportSummary {
  const now = options.now ?? new Date();
  const start = new Date(utcDayStart(now).getTime() - (days - 1) * DAY_MS);
  const endExclusive = new Date(utcDayStart(now).getTime() + DAY_MS);
  const from = start.toISOString();
  const toExclusive = endExclusive.toISOString();

  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { count: number } | undefined)?.count ?? 0;

  const ownedConversations = `FROM conversations c JOIN sites s ON s.id = c.site_id
    WHERE s.owner_id = ? AND c.started_at >= ? AND c.started_at < ?`;
  const ownedMessages = `FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN sites s ON s.id = c.site_id
    WHERE s.owner_id = ? AND m.created_at >= ? AND m.created_at < ?`;

  const conversations = count(`SELECT COUNT(*) AS count ${ownedConversations}`, ownerId, from, toExclusive);
  const handoffs = count(
    `SELECT COUNT(*) AS count ${ownedConversations} AND c.needs_human = 1`,
    ownerId,
    from,
    toExclusive,
  );
  const handled = count(
    `SELECT COUNT(*) AS count ${ownedConversations} AND c.handled = 1`,
    ownerId,
    from,
    toExclusive,
  );

  const messageRow = (
    db
      .prepare(
        `SELECT COUNT(*) AS messages,
                SUM(m.role = 'user') AS visitor_messages,
                SUM(m.role = 'assistant') AS ai_replies,
                SUM(m.role = 'agent') AS agent_replies
         ${ownedMessages}`,
      )
      .get(ownerId, from, toExclusive) as
      | {
          messages: number;
          visitor_messages: number | null;
          ai_replies: number | null;
          agent_replies: number | null;
        }
      | undefined
  ) ?? { messages: 0, visitor_messages: 0, ai_replies: 0, agent_replies: 0 };

  const pendingHandoffs = count(
    `SELECT COUNT(*) AS count FROM conversations c
     JOIN sites s ON s.id = c.site_id
     WHERE s.owner_id = ? AND c.needs_human = 1 AND c.handled = 0`,
    ownerId,
  );

  const kpis: ReportKpis = {
    conversations,
    messages: Number(messageRow.messages),
    visitorMessages: Number(messageRow.visitor_messages ?? 0),
    aiReplies: Number(messageRow.ai_replies ?? 0),
    agentReplies: Number(messageRow.agent_replies ?? 0),
    handoffs,
    handoffRate: conversations > 0 ? handoffs / conversations : 0,
    handled,
    pendingHandoffs,
    copiesGenerated: count(
      `SELECT COUNT(*) AS count FROM copy_history
       WHERE owner_id = ? AND created_at >= ? AND created_at < ?`,
      ownerId,
      from,
      toExclusive,
    ),
    kbEntries: count('SELECT COUNT(*) AS count FROM kb_entries WHERE owner_id = ?', ownerId),
    products: count('SELECT COUNT(*) AS count FROM products WHERE owner_id = ?', ownerId),
    avgAgentFirstResponseSec: averageAgentFirstResponseSec(db, ownerId, from, toExclusive),
  };

  return {
    range: {
      from,
      // Whole UTC days: the last day is included in full.
      to: new Date(endExclusive.getTime() - 1).toISOString(),
      days,
    },
    kpis,
    today: {
      conversations: count(
        `SELECT COUNT(*) AS count FROM conversations c
         JOIN sites s ON s.id = c.site_id
         WHERE s.owner_id = ? AND c.started_at >= ? AND c.started_at < ?`,
        ownerId,
        `${dayKey(utcDayStart(now))}T00:00:00.000Z`,
        toExclusive,
      ),
      pendingHandoffs,
    },
    daily: dailyRows(db, ownerId, days, start, from, toExclusive),
    intents: intentRows(db, ownerId, from, toExclusive),
    topQuestions: topVisitorQuestions(db, ownerId, from, toExclusive),
    sites: siteRows(db, ownerId, from, toExclusive),
  };
}

/**
 * Mean seconds between a handoff conversation's first visitor message and its
 * first agent reply. F3 introduces `role = 'agent'`; until a conversation has
 * one it contributes nothing, and the whole metric stays null with no data.
 * The schema has no handoff timestamp, so the first visitor message stands in
 * for "the visitor message after needs_human".
 */
function averageAgentFirstResponseSec(
  db: DB,
  ownerId: number,
  from: string,
  toExclusive: string,
): number | null {
  const row = db
    .prepare(
      `SELECT AVG(MAX(0.0, (julianday(a.first_agent) - julianday(v.first_visitor)) * 86400.0)) AS avg_sec
       FROM conversations c
       JOIN sites s ON s.id = c.site_id
       JOIN (SELECT conversation_id, MIN(created_at) AS first_agent
             FROM messages WHERE role = 'agent' GROUP BY conversation_id) a
         ON a.conversation_id = c.id
       JOIN (SELECT conversation_id, MIN(created_at) AS first_visitor
             FROM messages WHERE role = 'user' GROUP BY conversation_id) v
         ON v.conversation_id = c.id
       WHERE s.owner_id = ? AND c.needs_human = 1
         AND c.started_at >= ? AND c.started_at < ?`,
    )
    .get(ownerId, from, toExclusive) as { avg_sec: number | null } | undefined;
  // julianday() arithmetic carries float noise; whole seconds are enough.
  return row?.avg_sec == null ? null : Math.round(Number(row.avg_sec));
}

function dailyRows(
  db: DB,
  ownerId: number,
  days: number,
  start: Date,
  from: string,
  toExclusive: string,
): DailyReportRow[] {
  const conversationRows = db
    .prepare(
      `SELECT substr(c.started_at, 1, 10) AS day,
              COUNT(*) AS conversations,
              SUM(c.needs_human = 1) AS handoffs
       FROM conversations c JOIN sites s ON s.id = c.site_id
       WHERE s.owner_id = ? AND c.started_at >= ? AND c.started_at < ?
       GROUP BY day`,
    )
    .all(ownerId, from, toExclusive) as { day: string; conversations: number; handoffs: number }[];
  const messageRows = db
    .prepare(
      `SELECT substr(m.created_at, 1, 10) AS day, COUNT(*) AS messages
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN sites s ON s.id = c.site_id
       WHERE s.owner_id = ? AND m.created_at >= ? AND m.created_at < ?
       GROUP BY day`,
    )
    .all(ownerId, from, toExclusive) as { day: string; messages: number }[];
  const copyRows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS copies
       FROM copy_history
       WHERE owner_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY day`,
    )
    .all(ownerId, from, toExclusive) as { day: string; copies: number }[];

  const conversations = new Map(conversationRows.map((row) => [row.day, row]));
  const messages = new Map(messageRows.map((row) => [row.day, Number(row.messages)]));
  const copies = new Map(copyRows.map((row) => [row.day, Number(row.copies)]));

  return Array.from({ length: days }, (_, index) => {
    const date = dayKey(new Date(start.getTime() + index * DAY_MS));
    const conversationRow = conversations.get(date);
    return {
      date,
      conversations: Number(conversationRow?.conversations ?? 0),
      messages: messages.get(date) ?? 0,
      handoffs: Number(conversationRow?.handoffs ?? 0),
      copies: copies.get(date) ?? 0,
    };
  });
}

function intentRows(db: DB, ownerId: number, from: string, toExclusive: string): ReportIntent[] {
  const rows = db
    .prepare(
      `SELECT c.top_intent AS intent, COUNT(*) AS count
       FROM conversations c JOIN sites s ON s.id = c.site_id
       WHERE s.owner_id = ? AND c.started_at >= ? AND c.started_at < ?
       GROUP BY c.top_intent`,
    )
    .all(ownerId, from, toExclusive) as { intent: string; count: number }[];
  const counts = new Map(rows.map((row) => [row.intent, Number(row.count)]));
  return INTENTS.map((intent) => ({ intent, count: counts.get(intent) ?? 0 })).sort(
    (a, b) => b.count - a.count || INTENTS.indexOf(a.intent) - INTENTS.indexOf(b.intent),
  );
}

/** Groups normalised visitor messages verbatim, most frequent first. */
function topVisitorQuestions(
  db: DB,
  ownerId: number,
  from: string,
  toExclusive: string,
  limit = TOP_QUESTIONS_LIMIT,
): ReportTopQuestion[] {
  const rows = db
    .prepare(
      `SELECT m.content FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN sites s ON s.id = c.site_id
       WHERE s.owner_id = ? AND m.role = 'user'
         AND m.created_at >= ? AND m.created_at < ?
       ORDER BY m.created_at DESC
       LIMIT 5000`,
    )
    .all(ownerId, from, toExclusive) as { content: string }[];

  const counts = new Map<string, { text: string; count: number }>();
  for (const { content } of rows) {
    const text = normalizeQuestion(content);
    if (!text) continue;
    const key = text.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { text, count: 1 });
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, limit);
}

function siteRows(db: DB, ownerId: number, from: string, toExclusive: string): ReportSite[] {
  return (
    db
      .prepare(
        `SELECT s.id, s.name, COUNT(c.id) AS conversations
         FROM sites s
         LEFT JOIN conversations c
           ON c.site_id = s.id AND c.started_at >= ? AND c.started_at < ?
         WHERE s.owner_id = ?
         GROUP BY s.id
         ORDER BY conversations DESC, s.id ASC`,
      )
      .all(from, toExclusive, ownerId) as { id: number; name: string; conversations: number }[]
  ).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    conversations: Number(row.conversations),
  }));
}

/** Daily rows as the CSV export served by GET /api/admin/reports/summary.csv. */
export function reportSummaryCsv(summary: Pick<ReportSummary, 'daily'>): string {
  const header = 'date,conversations,messages,handoffs,copies';
  const lines = summary.daily.map((row) =>
    [row.date, row.conversations, row.messages, row.handoffs, row.copies].join(','),
  );
  return `${header}\n${lines.join('\n')}\n`;
}
