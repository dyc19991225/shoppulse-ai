import { describe, expect, it } from 'vitest';
import { detectHandoff, handoffNotice } from '@/lib/handoff';

describe('detectHandoff', () => {
  it('detects explicit handoff requests in Chinese', () => {
    for (const message of ['转人工', '我要找人工客服', '请转接真人', '客服在吗？', '我要投诉']) {
      const result = detectHandoff(message);
      expect(result.needed, message).toBe(true);
      expect(result.reason).toBe('explicit');
    }
  });

  it('detects explicit handoff requests in English', () => {
    for (const message of [
      'I want to talk to a human',
      'can I speak to a live agent please',
      'real person needed',
      'please escalate this',
    ]) {
      expect(detectHandoff(message).needed, message).toBe(true);
    }
  });

  it('detects implied handoff from angry complaints', () => {
    const result = detectHandoff('太差了，必须马上给我处理');
    expect(result.needed).toBe(true);
    expect(result.reason).toBe('complaint');
    expect(detectHandoff('This is unacceptable, fix it now').needed).toBe(true);
  });

  it('does not trigger on normal questions', () => {
    for (const message of [
      '这款有现货吗',
      '客服电话是多少',
      '退货怎么办',
      'what are your business hours',
      '',
    ]) {
      expect(detectHandoff(message).needed, message).toBe(false);
    }
  });

  it('reports the matched phrase', () => {
    const result = detectHandoff('麻烦转人工一下');
    expect(result.matched).toBeTruthy();
  });
});

describe('handoffNotice', () => {
  it('returns localized notices', () => {
    expect(handoffNotice('zh')).toMatch(/人工/);
    expect(handoffNotice('en')).toMatch(/human agent/i);
  });

  it('says the request was recorded, never that an agent was notified', () => {
    const zh = handoffNotice('zh');
    const en = handoffNotice('en');
    expect(zh).toContain('已记录');
    expect(en).toMatch(/has been recorded/i);
    for (const text of [zh, en]) {
      expect(text).not.toMatch(/已为您转接|already connected|has been notified|正在接入/i);
    }
  });
});
