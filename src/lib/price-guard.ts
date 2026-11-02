/**
 * Anti-fabrication guard for prices (AC5.3).
 *
 * The model may only quote prices that exist in the retrieved context. After
 * streaming finishes we extract every currency amount from the answer and
 * compare it against amounts found in the context (KB text, DB product prices)
 * and flag any that were invented.
 *
 * Extraction is intentionally currency-anchored: bare numbers ("7 天", "48 小时")
 * are not prices and must not trigger the guard. `块` is excluded because it is
 * also the classifier for "a piece of cloth".
 */

export interface PriceGuardResult {
  /** Amounts (normalized numbers) that appear in the answer but not context. */
  invented: number[];
  /** Raw text snippets that triggered, e.g. "¥199". */
  snippets: string[];
  flagged: boolean;
}

export type PriceGuardLocale = 'zh' | 'en';

const REDACTION = {
  zh: '（金额未核实）',
  en: '(amount unverified)',
} as const;

const NOTICE = {
  zh: '\n\n（价格提示：回答中的部分金额未在店铺资料中核实，已隐去；请以商品卡片显示的价格为准，或联系客服确认。）',
  en: '\n\n(Price note: some amounts could not be verified in the store data and were hidden. Please rely on the product cards and confirm with support.)',
} as const;

/** Localized notice appended after unverified amounts were redacted. */
export function priceGuardNotice(locale: PriceGuardLocale = 'zh'): string {
  return NOTICE[locale];
}

const CURRENCY_AMOUNT = new RegExp(
  [
    // ¥29.9 / ￥29.9 / $29.9 / €29.9
    String.raw`[¥￥$€]\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`,
    // 29.9 元 / 29 元 / 29 块钱 / 29.9 RMB / 29.9 CNY / 29.9 USD
    String.raw`(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:元|块钱|人民币|RMB|CNY|USD|yuan)`,
    // RMB 29.9 / CNY 29.9 / USD 29.9
    String.raw`(?:RMB|CNY|USD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`,
  ].join('|'),
  'gi',
);

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/** Returns every currency amount mentioned in `text` as normalized numbers. */
export function extractPrices(text: string): { value: number; snippet: string }[] {
  const results: { value: number; snippet: string }[] = [];
  if (!text) return results;

  CURRENCY_AMOUNT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CURRENCY_AMOUNT.exec(text)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    const value = toNumber(raw);
    if (!Number.isFinite(value)) continue;
    results.push({ value, snippet: match[0].trim() });
  }
  return results;
}

/**
 * Builds the set of allowed prices from context strings and explicit numeric
 * values (e.g. product.price rows).
 */
export function collectAllowedPrices(
  contextTexts: readonly string[],
  extraValues: readonly number[] = [],
): Set<number> {
  const allowed = new Set<number>();
  for (const value of extraValues) {
    if (Number.isFinite(value)) allowed.add(Math.round(value * 100) / 100);
  }
  for (const text of contextTexts) {
    for (const { value } of extractPrices(text)) {
      allowed.add(Math.round(value * 100) / 100);
    }
  }
  return allowed;
}

function isAllowed(value: number, allowed: Set<number>): boolean {
  if (allowed.has(Math.round(value * 100) / 100)) return true;
  // Allow minor rounding drift when the model writes 29.90 for 29.9.
  for (const candidate of allowed) {
    if (Math.abs(candidate - value) < 0.005) return true;
  }
  return false;
}

/**
 * Replaces every unverified currency amount in `text` with a neutral
 * placeholder. The placeholder carries no digits or currency anchor, so it can
 * never be mistaken for a price (and cannot re-trigger the guard).
 */
export function redactUnverifiedPrices(
  text: string,
  allowed: Set<number> | readonly string[] | readonly number[],
  locale: PriceGuardLocale = 'zh',
): PriceGuardResult & { text: string } {
  const allowedSet =
    allowed instanceof Set
      ? allowed
      : allowed.every((entry): entry is number => typeof entry === 'number')
        ? collectAllowedPrices([], allowed as readonly number[])
        : collectAllowedPrices((allowed as readonly string[]).map(String));

  const invented: number[] = [];
  const snippets: string[] = [];
  const seen = new Set<number>();
  let output = '';
  let cursor = 0;

  CURRENCY_AMOUNT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CURRENCY_AMOUNT.exec(text)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (raw === undefined) continue;
    const value = toNumber(raw);
    if (!Number.isFinite(value)) continue;
    if (isAllowed(value, allowedSet)) continue;

    const rounded = Math.round(value * 100) / 100;
    output += text.slice(cursor, match.index) + REDACTION[locale];
    cursor = match.index + match[0].length;
    if (!seen.has(rounded)) {
      seen.add(rounded);
      invented.push(rounded);
      snippets.push(match[0].trim());
    }
  }

  output += text.slice(cursor);
  return { invented, snippets, flagged: invented.length > 0, text: output };
}

/** Compares prices in `answer` with the allowed set. */
export function checkPriceFabrication(
  answer: string,
  allowed: Set<number> | readonly string[] | readonly number[],
): PriceGuardResult {
  let allowedSet: Set<number>;
  if (allowed instanceof Set) {
    allowedSet = allowed;
  } else if (allowed.every((entry): entry is number => typeof entry === 'number')) {
    allowedSet = collectAllowedPrices([], allowed as readonly number[]);
  } else {
    allowedSet = collectAllowedPrices((allowed as readonly string[]).map(String));
  }

  const invented: number[] = [];
  const snippets: string[] = [];
  const seen = new Set<number>();

  for (const { value, snippet } of extractPrices(answer)) {
    const rounded = Math.round(value * 100) / 100;
    if (seen.has(rounded)) continue;
    if (isAllowed(value, allowedSet)) continue;
    seen.add(rounded);
    invented.push(rounded);
    snippets.push(snippet);
  }

  return { invented, snippets, flagged: invented.length > 0 };
}

/**
 * Appends a correction notice when fabricated prices were detected. The notice
 * does not itself contain a number, so it never re-triggers the guard.
 */
export function applyPriceGuard(
  answer: string,
  allowed: Set<number> | readonly string[] | readonly number[],
  locale: PriceGuardLocale = 'zh',
): PriceGuardResult & { text: string } {
  const redacted = redactUnverifiedPrices(answer, allowed, locale);
  if (!redacted.flagged) return redacted;
  return { ...redacted, text: redacted.text + priceGuardNotice(locale) };
}

// ---------------------------------------------------------------------------
// Streaming guard
// ---------------------------------------------------------------------------

/** True when `suffix` could still grow into a currency amount. */
function isOpenAmountSuffix(suffix: string): boolean {
  return (
    // ¥ / ￥ / $ / € with an optional (possibly growing) number after it.
    /^[¥￥$€]\s*[\d,.]*$/u.test(suffix) ||
    // Currency keyword with a growing number after it.
    /^(?:RMB|CNY|USD)\s*[\d,.]*$/i.test(suffix) ||
    // A trailing number (possibly followed by a unit/keyword that is itself
    // being typed, e.g. "58 R" -> "58 RMB").
    /^[\d,.]+\s*(?:R|RM|RMB|C|CN|CNY|U|US|USD|yuan|元|块钱|人民币|块|人)?\s*$/i.test(
      suffix,
    ) ||
    // A currency keyword split across chunks at the very end.
    /^(?:R|RM|C|CN|U|US)$/i.test(suffix)
  );
}

/**
 * Extends a held-back cut backwards so a currency marker is never split from
 * the amount it introduces ("¥" + "9.9", "RMB " + "58").
 */
function extendHoldStart(text: string, index: number): number {
  let start = index;
  for (;;) {
    let probe = start;
    while (probe > 0 && /\s/.test(text[probe - 1])) probe -= 1;
    if (probe > 0 && /[¥￥$€]/.test(text[probe - 1])) {
      start = probe - 1;
      continue;
    }
    const prefix = text.slice(0, probe);
    const keyword = /(?:RMB|CNY|USD)$/i.exec(prefix);
    if (keyword) {
      start = probe - keyword[0].length;
      continue;
    }
    return start;
  }
}

/**
 * Index up to which `text` is safe to emit: everything after the earliest
 * position that could start a growing currency amount is held back.
 */
export function safeEmitIndex(text: string): number {
  const windowStart = Math.max(0, text.length - 64);
  for (let index = windowStart; index < text.length; index += 1) {
    if (isOpenAmountSuffix(text.slice(index))) {
      return extendHoldStart(text, index);
    }
  }
  // A number run longer than the scan window (pathological) must still be
  // held from its start rather than split.
  if (windowStart > 0 && /[0-9A-Za-z,.]$/.test(text.slice(0, windowStart))) {
    let start = windowStart;
    while (start > 0 && /[0-9A-Za-z,.]/.test(text[start - 1])) start -= 1;
    return start;
  }
  return text.length;
}

export interface StreamPriceGuardResult {
  /** Text safe to display (unverified amounts redacted). */
  text: string;
  /** True when at least one amount was redacted so far. */
  flagged: boolean;
}

export interface StreamPriceGuard {
  /** Feeds a model chunk and returns the now-verifiable output. */
  push(chunk: string): StreamPriceGuardResult;
  /** Ends the stream: verifies/redacts whatever was held back. */
  flush(): StreamPriceGuardResult;
  /** Whether any amount has been redacted across the stream. */
  readonly flagged: boolean;
}

/**
 * Incremental price guard for SSE output (AC5.3). Only a short tail that could
 * still become a currency amount is buffered; the rest streams immediately.
 */
export function createStreamPriceGuard(
  allowed: Set<number> | readonly string[] | readonly number[],
  locale: PriceGuardLocale = 'zh',
): StreamPriceGuard {
  let pending = '';
  let flagged = false;

  const flushBuffer = (): StreamPriceGuardResult => {
    if (!pending) return { text: '', flagged };
    const redacted = redactUnverifiedPrices(pending, allowed, locale);
    pending = '';
    if (redacted.flagged) flagged = true;
    return { text: redacted.text, flagged };
  };

  return {
    push(chunk: string): StreamPriceGuardResult {
      pending += chunk;
      const cutoff = safeEmitIndex(pending);
      if (cutoff <= 0) return { text: '', flagged };
      const head = pending.slice(0, cutoff);
      pending = pending.slice(cutoff);
      const redacted = redactUnverifiedPrices(head, allowed, locale);
      if (redacted.flagged) flagged = true;
      return { text: redacted.text, flagged };
    },
    flush(): StreamPriceGuardResult {
      return flushBuffer();
    },
    get flagged(): boolean {
      return flagged;
    },
  };
}
