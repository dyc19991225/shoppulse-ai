import type { DB, KbEntry, Product } from './db';
import { listKbEntries, listProducts } from './db';

/**
 * Lightweight lexical retrieval for Chinese + English.
 *
 * Chinese has no spaces, so queries and documents are tokenized into CJK
 * bigrams (plus single characters for one-character runs) together with
 * lower-cased Latin/digit words. Each field is weighted so a title hit beats a
 * description hit. Everything is in-memory and deterministic — the catalogs are
 * small (a few thousand rows at most) and retrieval must stay fast on a 2-core
 * box.
 */

export interface Scored<T> {
  item: T;
  score: number;
  /** Tokens that matched somewhere in the item. */
  matched: string[];
}

export interface RetrievalOptions {
  limit?: number;
  /** Only consider enabled rows (default true). */
  enabledOnly?: boolean;
}

const CJK_RUN = /[㐀-䶿一-鿿豈-﫿]+/g;
const LATIN_WORD = /[a-z0-9]+(?:[._-][a-z0-9]+)*/g;

/** Extracts normalized search tokens (CJK bigrams + Latin words). */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase().normalize('NFKC');
  const tokens = new Set<string>();

  for (const word of normalized.match(LATIN_WORD) ?? []) {
    if (word.length >= 2) tokens.add(word);
  }

  for (const run of normalized.match(CJK_RUN) ?? []) {
    const chars = Array.from(run);
    if (chars.length === 1) {
      tokens.add(chars[0]);
      continue;
    }
    for (let index = 0; index < chars.length - 1; index += 1) {
      tokens.add(chars[index] + chars[index + 1]);
    }
  }

  return [...tokens];
}

interface WeightedField {
  text: string;
  weight: number;
}

function scoreFields(
  queryTokens: string[],
  normalizedQuery: string,
  fields: WeightedField[],
): { score: number; matched: string[] } {
  const matched = new Set<string>();
  let score = 0;

  for (const token of queryTokens) {
    for (const field of fields) {
      if (field.text.toLowerCase().includes(token)) {
        score += field.weight;
        matched.add(token);
        // A token only contributes once per field, but the loop above is
        // per-field; break is unnecessary because each field is visited once.
      }
    }
  }

  // Bonus for the whole query appearing verbatim in a high-weight field.
  const primary = fields[0];
  if (normalizedQuery.length >= 2 && primary.text.toLowerCase().includes(normalizedQuery)) {
    score += 4;
    matched.add(normalizedQuery);
  }

  return { score, matched: [...matched] };
}

function enabledOnlyDefault(options: RetrievalOptions): boolean {
  return options.enabledOnly !== false;
}

/** Ranks enabled KB entries against `query`, returning the best `limit`. */
export function retrieveKnowledge(
  db: DB,
  ownerId: number,
  query: string,
  options: RetrievalOptions = {},
): Scored<KbEntry>[] {
  const limit = Math.max(1, options.limit ?? 4);
  const normalizedQuery = query.trim().toLowerCase().normalize('NFKC');
  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) return [];

  const entries = listKbEntries(db, ownerId, { enabledOnly: enabledOnlyDefault(options) });
  const scored: Scored<KbEntry>[] = [];

  for (const entry of entries) {
    const result = scoreFields(queryTokens, normalizedQuery, [
      { text: entry.title, weight: 5 },
      { text: entry.keywords, weight: 4 },
      { text: entry.content, weight: 1 },
    ]);
    if (result.score > 0) scored.push({ item: entry, ...result });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.item.id - a.item.id)
    .slice(0, limit);
}

/** Ranks enabled products against `query`, returning the best `limit`. */
export function retrieveProducts(
  db: DB,
  ownerId: number,
  query: string,
  options: RetrievalOptions & { fallback?: boolean } = {},
): Scored<Product>[] {
  const limit = Math.max(1, options.limit ?? 3);
  const normalizedQuery = query.trim().toLowerCase().normalize('NFKC');
  const queryTokens = tokenize(normalizedQuery);

  const products = listProducts(db, ownerId, { enabledOnly: enabledOnlyDefault(options) });
  const scored: Scored<Product>[] = [];

  if (queryTokens.length > 0) {
    for (const product of products) {
      const result = scoreFields(queryTokens, normalizedQuery, [
        { text: product.name, weight: 5 },
        { text: product.sku ?? '', weight: 3 },
        { text: product.category, weight: 3 },
        { text: product.sellingPoints, weight: 2 },
        { text: product.description, weight: 1 },
      ]);
      if (result.score > 0) scored.push({ item: product, ...result });
    }
  }

  if (scored.length === 0 && options.fallback && wantsRecommendation(normalizedQuery)) {
    // Recommendation-style questions ("有什么推荐") have no lexical overlap with
    // product rows. Serving the top in-stock rows is still DB-backed, never
    // invented, and makes the demo useful.
    return products
      .slice()
      .sort((a, b) => b.stock - a.stock || a.id - b.id)
      .slice(0, limit)
      .map((item) => ({ item, score: 0, matched: [] }));
  }

  return scored
    .sort((a, b) => b.score - a.score || b.item.stock - a.item.stock || a.item.id - b.item.id)
    .slice(0, limit);
}

const RECOMMENDATION_HINTS =
  /推荐|有什么|有哪些|产品|商品|卖什么|买什么|挑|选择|recommend|what.*(have|sell)|products?|catalog/i;

export function wantsRecommendation(query: string): boolean {
  return RECOMMENDATION_HINTS.test(query);
}

export interface RetrievalResult {
  knowledge: Scored<KbEntry>[];
  products: Scored<Product>[];
}

/** Convenience wrapper used by the chat pipeline. */
export function retrieve(
  db: DB,
  ownerId: number,
  query: string,
  options: { knowledgeLimit?: number; productLimit?: number; includeProducts?: boolean } = {},
): RetrievalResult {
  return {
    knowledge: retrieveKnowledge(db, ownerId, query, { limit: options.knowledgeLimit ?? 4 }),
    products:
      options.includeProducts === false
        ? []
        : retrieveProducts(db, ownerId, query, {
            limit: options.productLimit ?? 3,
            fallback: true,
          }),
  };
}
