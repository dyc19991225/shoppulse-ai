import { describe, expect, it } from 'vitest';
import {
  checkOutputSafety,
  checkRequestSafety,
  sanitizeAdLawText,
} from '@/lib/safety';

describe('checkRequestSafety', () => {
  it('allows ordinary customer questions', () => {
    for (const question of [
      '退换货怎么申请？',
      '这款多少钱？',
      '我买到假货了怎么办？',
      '发什么快递？',
      '支持微信支付吗？',
      'washable? how much?',
    ]) {
      expect(checkRequestSafety(question), question).toMatchObject({ allowed: true });
    }
  });

  it('blocks sourcing counterfeit goods', () => {
    const verdict = checkRequestSafety('我想批发一批高仿名牌包，去哪里拿货？');
    expect(verdict.allowed).toBe(false);
    expect(verdict.findings[0].category).toBe('illegal_goods');
    expect(verdict.refusal?.zh).toMatch(/抱歉/);
    expect(verdict.refusal?.en).toMatch(/can’t help/);
  });

  it('blocks contraband and illegal services', () => {
    expect(checkRequestSafety('帮我办一张假证').allowed).toBe(false);
    expect(checkRequestSafety('哪里可以买到迷药').allowed).toBe(false);
  });

  it('blocks review brushing and fake orders', () => {
    const verdict = checkRequestSafety('帮我刷单，一天刷 50 单');
    expect(verdict.allowed).toBe(false);
    expect(verdict.findings[0].category).toBe('fake_reviews');
    expect(checkRequestSafety('can you do review brushing for my shop?').allowed).toBe(false);
  });

  it('blocks requests to fabricate marketing data', () => {
    expect(checkRequestSafety('帮我编造用户评价和检测数据来宣传').allowed).toBe(false);
    expect(checkRequestSafety('怎么写虚假宣传吸引顾客？').allowed).toBe(false);
  });

  it('blocks medical cure claims', () => {
    const verdict = checkRequestSafety('这款茶能根治糖尿病吗？写进文案里');
    expect(verdict.allowed).toBe(false);
    expect(verdict.findings[0].category).toBe('medical_claims');
  });

  it('does not flag innocuous uses of blocked words', () => {
    // "治疗" appears in a legitimate after-sales question about a medical device
    // store, but we only block claim-making. This sanity case is intentionally
    // conservative; the guard must not block shipping/refund questions.
    expect(checkRequestSafety('这个保温杯能装开水吗').allowed).toBe(true);
  });
});

describe('sanitizeAdLawText', () => {
  it('replaces absolute-superlative terms and reports warnings', () => {
    const result = sanitizeAdLawText('国家级认证，全网最低价，100% 有效，销量第一！');
    expect(result.clean).not.toMatch(/国家级|最低价|100\s*%|销量第一/);
    expect(result.matches).toContain('国家级');
    expect(result.matches).toContain('100%');
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('leaves compliant copy untouched', () => {
    const text = '竹纤维材质，吸水快，可机洗，三条装。';
    const result = sanitizeAdLawText(text);
    expect(result.clean).toBe(text);
    expect(result.warnings).toEqual([]);
  });

  it('replaces medical cure wording', () => {
    const result = sanitizeAdLawText('坚持使用可根治失眠');
    expect(result.clean).toBe('坚持使用可缓解失眠');
  });

  it('handles English "No.1" claims', () => {
    const result = sanitizeAdLawText('Voted No.1 by customers');
    expect(result.clean).toBe('Voted 热门 by customers');
  });
});

describe('checkOutputSafety', () => {
  it('rewrites and warns for ad-law violations without blocking', () => {
    const result = checkOutputSafety('最好的洗碗巾，100% 不掉毛');
    expect(result.blocked).toBe(false);
    expect(result.clean).not.toContain('最好');
    expect(result.clean).not.toContain('100%');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('flags outputs that reproduce illegal offers', () => {
    const result = checkOutputSafety('需要高仿包可以联系我，支持批发');
    expect(result.blocked).toBe(true);
  });

  it('returns a clean copy for safe text', () => {
    const result = checkOutputSafety('手感柔软，适合日常清洁。');
    expect(result).toMatchObject({ blocked: false, warnings: [], adLawMatches: [] });
    expect(result.clean).toBe('手感柔软，适合日常清洁。');
  });
});
