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
  locale: 'zh' | 'en' = 'zh',
): PriceGuardResult & { text: string } {
  const result = checkPriceFabrication(answer, allowed);
  if (!result.flagged) return { ...result, text: answer };
  const notice =
    locale === 'en'
      ? '\n\n(Price note: some amounts above could not be verified in the store data. Please rely on the product cards and confirm with support.)'
      : '\n\n（价格提示：以上回答中的部分金额未在店铺资料中核实，请以商品卡片显示的价格为准，或联系客服确认。）';
  return { ...result, text: answer + notice };
}
