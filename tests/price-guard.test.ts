import { describe, expect, it } from 'vitest';
import {
  applyPriceGuard,
  checkPriceFabrication,
  collectAllowedPrices,
  extractPrices,
} from '@/lib/price-guard';

describe('extractPrices', () => {
  it('finds currency-anchored amounts', () => {
    const found = extractPrices('原价 ¥199，现价 29.9 元，套装只需 89 元，$12.5');
    expect(found.map((f) => f.value)).toEqual([199, 29.9, 89, 12.5]);
  });

  it('supports thousands separators and RMB/CNY prefixes', () => {
    expect(extractPrices('¥1,299.00').map((f) => f.value)).toEqual([1299]);
    expect(extractPrices('RMB 58').map((f) => f.value)).toEqual([58]);
    expect(extractPrices('CNY 88.8').map((f) => f.value)).toEqual([88.8]);
  });

  it('ignores quantities, durations and non-price numbers', () => {
    expect(extractPrices('7 天无理由退货，48 小时内发货，3 条装')).toEqual([]);
    // "元" is unambiguous, so free-shipping thresholds are captured too.
    expect(extractPrices('满 99 元包邮').map((f) => f.value)).toEqual([99]);
  });

  it('returns an empty list for empty text', () => {
    expect(extractPrices('')).toEqual([]);
  });
});

describe('collectAllowedPrices', () => {
  it('combines explicit numbers with amounts parsed from context text', () => {
    const allowed = collectAllowedPrices(['满 99 元包邮'], [29.9, 89]);
    expect(allowed.has(29.9)).toBe(true);
    expect(allowed.has(89)).toBe(true);
    expect(allowed.has(99)).toBe(true);
    expect(allowed.has(199)).toBe(false);
  });

  it('rounds to cents', () => {
    expect(collectAllowedPrices([], [29.999]).has(30)).toBe(true);
  });
});

describe('checkPriceFabrication', () => {
  it('passes when every quoted price exists in the context', () => {
    const allowed = collectAllowedPrices(['洗碗巾 29.9 元'], [29.9]);
    const result = checkPriceFabrication('这款洗碗巾只要 ¥29.9，很划算。', allowed);
    expect(result.flagged).toBe(false);
    expect(result.invented).toEqual([]);
  });

  it('flags invented prices', () => {
    const allowed = collectAllowedPrices(['洗碗巾 29.9 元'], [29.9]);
    const result = checkPriceFabrication('现在特价 ¥19.9，买二送一！', allowed);
    expect(result.flagged).toBe(true);
    expect(result.invented).toEqual([19.9]);
    expect(result.snippets[0]).toContain('19.9');
  });

  it('accepts a plain list of allowed strings or numbers', () => {
    expect(checkPriceFabrication('只要 88 元', ['88 元']).flagged).toBe(false);
    expect(checkPriceFabrication('只要 88 元', [88]).flagged).toBe(false);
    expect(checkPriceFabrication('只要 66 元', [88]).flagged).toBe(true);
  });

  it('does not flag non-price numbers', () => {
    const result = checkPriceFabrication('7 天无理由退货，48 小时内发货，共 3 条。', new Set());
    expect(result.flagged).toBe(false);
  });

  it('deduplicates repeated invented amounts', () => {
    const result = checkPriceFabrication('¥19.9 一件，¥19.9 真的很便宜', new Set());
    expect(result.invented).toEqual([19.9]);
    expect(result.snippets).toHaveLength(1);
  });

  it('treats 29.90 as equal to 29.9', () => {
    expect(checkPriceFabrication('¥29.90', new Set([29.9])).flagged).toBe(false);
  });
});

describe('applyPriceGuard', () => {
  it('appends a localized correction when flagged', () => {
    const result = applyPriceGuard('只要 ¥19.9', new Set([29.9]), 'zh');
    expect(result.flagged).toBe(true);
    expect(result.text).toMatch(/价格提示/);
    expect(result.text.startsWith('只要 ¥19.9')).toBe(true);
  });

  it('uses English notice when asked', () => {
    const result = applyPriceGuard('only $9.9', new Set([19.9]), 'en');
    expect(result.text).toMatch(/Price note/);
  });

  it('returns the answer unchanged when clean', () => {
    const result = applyPriceGuard('只要 ¥29.9', collectAllowedPrices([], [29.9]));
    expect(result.text).toBe('只要 ¥29.9');
  });
});
