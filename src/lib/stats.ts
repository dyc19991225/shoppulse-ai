import type { DB } from './db';
import { INTENTS, type Intent } from './intent';
import { tokenize } from './retrieval';

/**
 * Conversation analytics for the admin overview (AC7.2).
 *
 * - Conversation totals, last-7-day volume, handoff rate.
 * - Intent shares from `conversations.top_intent`.
 * - Top question terms from user messages, tokenized with the same CJK
 *   bigram + Latin word tokenizer used by retrieval.
 */

export const STATS_RANGE_DAYS = 7;
export const TOP_QUESTIONS_LIMIT = 10;

export interface IntentStat {
  intent: Intent;
  count: number;
  /** Share of last-7-day conversations, 0..1. */
  share: number;
}

export interface TopQuestion {
  term: string;
  count: number;
}

export interface StatsPayload {
  rangeDays: number;
  since: string;
  totals: {
    conversations: number;
    kbEntries: number;
    products: number;
    copyHistory: number;
    sites: number;
  };
  last7Days: {
    conversations: number;
    needsHuman: number;
    handled: number;
  };
  handoffRate: number;
  intents: IntentStat[];
  topQuestions: TopQuestion[];
}

/** Terms that carry no topical signal, plus question particles. */
const STOP_TERMS = new Set([
  '你好',
  '您好',
  '请问',
  '可以',
  '什么',
  '怎么',
  '怎样',
  '如何',
  '多少',
  '这个',
  '那个',
  '这些',
  '那些',
  '我们',
  '你们',
  '他们',
  '一下',
  '有没有',
  '是否',
  '麻烦',
  '谢谢',
  '知道',
  '就是',
  '还是',
  '但是',
  '因为',
  '所以',
  '如果',
  '需要',
  '想要',
  '帮我',
  '我要',
  '我想',
  'hello',
  'please',
  'thanks',
  'thank',
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'have',
  'what',
  'how',
  'can',
  'you',
]);

/** Bigrams containing these characters are usually sentence glue, not topics. */
const GLUE_CHARS = /[的了呢吗吧啊呀哦嗯么什怎哪太很都就也还又再不要想能会吗嘛]/;

export function isTopicTerm(term: string): boolean {
  if (term.length < 2) return false;
  if (STOP_TERMS.has(term)) return false;
  if (/^[a-z]+$/.test(term)) return term.length >= 3 || STOP_TERMS.has(term);
  // CJK: drop bigrams that are mostly particles.
  return !GLUE_CHARS.test(term);
}

export interface StatsOptions {
  now?: Date;
  rangeDays?: number;
}

export function getStats(db: DB, options: StatsOptions = {}): StatsPayload {
  const rangeDays = options.rangeDays ?? STATS_RANGE_DAYS;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { count: number } | undefined)?.count ?? 0;

  const totals = {
    conversations: count('SELECT COUNT(*) AS count FROM conversations'),
    kbEntries: count('SELECT COUNT(*) AS count FROM kb_entries'),
    products: count('SELECT COUNT(*) AS count FROM products'),
    copyHistory: count('SELECT COUNT(*) AS count FROM copy_history'),
    sites: count('SELECT COUNT(*) AS count FROM sites'),
  };

  const last7Days = {
    conversations: count('SELECT COUNT(*) AS count FROM conversations WHERE started_at >= ?', since),
    needsHuman: count(
      'SELECT COUNT(*) AS count FROM conversations WHERE started_at >= ? AND needs_human = 1',
      since,
    ),
    handled: count(
      'SELECT COUNT(*) AS count FROM conversations WHERE started_at >= ? AND handled = 1',
      since,
    ),
  };

  const handoffRate =
    last7Days.conversations > 0 ? last7Days.needsHuman / last7Days.conversations : 0;

  const intentRows = db
    .prepare(
      `SELECT top_intent AS intent, COUNT(*) AS count
       FROM conversations
       WHERE started_at >= ?
       GROUP BY top_intent`,
    )
    .all(since) as { intent: string; count: number }[];
  const intentCounts = new Map(intentRows.map((row) => [row.intent, Number(row.count)]));

  const intents: IntentStat[] = INTENTS.map((intent) => {
    const intentCount = intentCounts.get(intent) ?? 0;
    return {
      intent,
      count: intentCount,
      share: last7Days.conversations > 0 ? intentCount / last7Days.conversations : 0,
    };
  }).sort((a, b) => b.count - a.count);

  const topQuestions = topQuestionTerms(db, since);

  return { rangeDays, since, totals, last7Days, handoffRate, intents, topQuestions };
}

/** Counts topic terms across recent user messages, most frequent first. */
export function topQuestionTerms(
  db: DB,
  since: string,
  limit = TOP_QUESTIONS_LIMIT,
): TopQuestion[] {
  const rows = db
    .prepare(
      `SELECT content FROM messages
       WHERE role = 'user' AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 2000`,
    )
    .all(since) as { content: string }[];

  const counts = new Map<string, number>();
  for (const { content } of rows) {
    for (const term of tokenize(content)) {
      if (!isTopicTerm(term)) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([term, termCount]) => ({ term, count: termCount }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, Math.max(1, limit));
}
