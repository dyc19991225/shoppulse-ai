import { describe, expect, it } from 'vitest';
import { classifyIntent, INTENTS, INTENT_LABELS, isIntent } from '@/lib/intent';

describe('classifyIntent', () => {
  const cases: [string, string][] = [
    ['这款洗碗巾有现货吗？什么材质', 'product'],
    ['多少钱？有优惠吗', 'price'],
    ['发什么快递，几天能到？', 'logistics'],
    ['我要退货，怎么申请退款', 'after_sale'],
    ['你们服务太差了，我要投诉', 'complaint'],
    ['转人工', 'handoff'],
    ['你好', 'other'],
    ['', 'other'],
  ];

  for (const [message, expected] of cases) {
    it(`classifies "${message}" as ${expected}`, () => {
      expect(classifyIntent(message).intent).toBe(expected);
    });
  }

  it('prioritizes handoff over other signals', () => {
    // Contains price + handoff phrasing; handoff wins.
    expect(classifyIntent('价格太贵了，我要找人工客服').intent).toBe('handoff');
  });

  it('prioritizes complaints over shipping keywords', () => {
    expect(classifyIntent('快递太慢了，我要投诉').intent).toBe('complaint');
  });

  it('classifies English messages', () => {
    expect(classifyIntent('how much is this?').intent).toBe('price');
    expect(classifyIntent('when will my order arrive?').intent).toBe('logistics');
    expect(classifyIntent('I need a refund').intent).toBe('after_sale');
    expect(classifyIntent('speak to a human agent').intent).toBe('handoff');
  });

  it('returns a score and rule id', () => {
    const result = classifyIntent('我要退货');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.rule).toBe('after-sale');
    expect(classifyIntent('').score).toBe(0);
  });
});

describe('intent metadata', () => {
  it('labels every intent bilingually', () => {
    for (const intent of INTENTS) {
      expect(INTENT_LABELS[intent].zh.length).toBeGreaterThan(0);
      expect(INTENT_LABELS[intent].en.length).toBeGreaterThan(0);
    }
  });

  it('validates intent strings', () => {
    expect(isIntent('price')).toBe(true);
    expect(isIntent('nope')).toBe(false);
    expect(isIntent(undefined)).toBe(false);
  });
});
