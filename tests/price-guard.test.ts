import { describe, expect, it } from 'vitest';
import {
  applyPriceGuard,
  checkPriceFabrication,
  collectAllowedPrices,
  createStreamPriceGuard,
  extractPrices,
  priceGuardNotice,
  redactUnverifiedPrices,
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
  it('redacts invented amounts and appends a localized notice', () => {
    const result = applyPriceGuard('只要 ¥19.9', new Set([29.9]), 'zh');
    expect(result.flagged).toBe(true);
    expect(result.text).toMatch(/价格提示/);
    expect(result.text).not.toContain('19.9');
    expect(result.text).toContain('金额未核实');
  });

  it('uses English notice and placeholder when asked', () => {
    const result = applyPriceGuard('only $9.9', new Set([19.9]), 'en');
    expect(result.text).toMatch(/Price note/);
    expect(result.text).toContain('(amount unverified)');
    expect(result.text).not.toContain('$9.9');
  });

  it('returns the answer unchanged when clean', () => {
    const result = applyPriceGuard('只要 ¥29.9', collectAllowedPrices([], [29.9]));
    expect(result.text).toBe('只要 ¥29.9');
  });
});

describe('redactUnverifiedPrices', () => {
  it('keeps verified amounts and redacts only invented ones', () => {
    const allowed = collectAllowedPrices([], [29.9]);
    const result = redactUnverifiedPrices('原价 ¥199，现价 ¥29.9', allowed, 'zh');
    expect(result.flagged).toBe(true);
    expect(result.invented).toEqual([199]);
    expect(result.text).toBe('原价 （金额未核实），现价 ¥29.9');
  });

  it('handles 元/RMB/USD forms', () => {
    const result = redactUnverifiedPrices('只要 88 元，或 RMB 66', new Set([88]), 'en');
    expect(result.text).toContain('(amount unverified)');
    expect(result.text).not.toContain('66');
  });

  it('returns text unchanged when nothing was invented', () => {
    const result = redactUnverifiedPrices('7 天无理由退货，¥29.9', new Set([29.9]));
    expect(result.flagged).toBe(false);
    expect(result.text).toBe('7 天无理由退货，¥29.9');
  });
});

describe('createStreamPriceGuard', () => {
  function stream(allowed: Set<number>, chunks: string[], locale: 'zh' | 'en' = 'zh') {
    const guard = createStreamPriceGuard(allowed, locale);
    let text = '';
    const emissions: string[] = [];
    for (const chunk of chunks) {
      const out = guard.push(chunk);
      if (out.text) emissions.push(out.text);
      text += out.text;
    }
    const tail = guard.flush();
    if (tail.text) emissions.push(tail.text);
    text += tail.text;
    return { guard, text, emissions };
  }

  it('streams safe text immediately and holds back only a price tail', () => {
    const guard = createStreamPriceGuard(new Set([29.9]));
    const first = guard.push('你好，这款商品');
    expect(first.text).toBe('你好，这款商品');
    const partial = guard.push('只要 ¥2');
    expect(partial.text).toBe('只要 ');
  });

  it('never emits an invented amount, across arbitrary chunk boundaries', () => {
    const answer = '这款洗碗巾现在特价 ¥9.9 哦，原价 RMB 199，现价只要 29.9 元。';
    const allowed = collectAllowedPrices([], [29.9]);
    for (let size = 1; size <= 9; size += 1) {
      const chunks = answer.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [];
      const { text } = stream(allowed, chunks);
      expect(text, `chunk size ${size}`).not.toContain('9.9 哦');
      expect(text, `chunk size ${size}`).not.toContain('199');
      expect(text, `chunk size ${size}`).toContain('29.9');
      expect(text).toContain('金额未核实');
    }
  });

  it('does not redact verified prices split across chunks', () => {
    const { text } = stream(new Set([29.9]), ['这款 ¥2', '9.9', ' 很划算']);
    expect(text).toBe('这款 ¥29.9 很划算');
  });

  it('redacts an amount that only becomes complete at flush time', () => {
    const guard = createStreamPriceGuard(new Set([29.9]));
    expect(guard.push('只要 ¥6').text).toBe('只要 ');
    const tail = guard.flush();
    expect(tail.text).toContain('金额未核实');
    expect(guard.flagged).toBe(true);
  });

  it('exposes a localized notice', () => {
    expect(priceGuardNotice('zh')).toMatch(/价格提示/);
    expect(priceGuardNotice('en')).toMatch(/Price note/);
  });
});
