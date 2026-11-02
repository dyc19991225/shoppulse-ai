/**
 * Human-handoff detection (AC5.4).
 *
 * A handoff can be explicit ("转人工", "talk to a human") or implied by an angry
 * complaint. We deliberately do not treat a plain "客服电话是多少" as a handoff —
 * it is answered from the knowledge base.
 */

export interface HandoffDetection {
  needed: boolean;
  reason: 'explicit' | 'complaint' | null;
  /** Matched phrase, for logging. */
  matched?: string;
}

const EXPLICIT_PATTERNS: RegExp[] = [
  /转\s*人工/,
  /人工(客服|服务|介入|处理|接待)/,
  /(找|要|叫|请|需要|换).{0,4}(真人|人工|客服)/,
  /客服(在吗|呢|在不在|进来|介入)/,
  /(真人|活人)(客服)?/,
  /(投诉|举报|维权)/,
  /(talk|speak|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|someone|representative)/i,
  /\b(real|live)\s+(person|human|agent)\b/i,
  /\bhuman\s+(agent|support|service)\b/i,
  /\bcustomer\s+(service|support)\s+(agent|person)\b/i,
  /\b(agent|representative)\s*(please|now)?\b/i,
  /\bescalate\b/i,
];

/** Angry messages that should reach a person even without the word "human". */
const IMPLIED_PATTERNS: RegExp[] = [
  /(太差|非常差|极差|垃圾|骗人|骗子|欺诈|坑人|气死|愤怒|严重|立刻|马上).{0,12}(处理|解决|回复|退钱|赔偿)/,
  /\b(terrible|awful|unacceptable|disgusting|scam|fraud)\b/i,
];

export function detectHandoff(message: string): HandoffDetection {
  const text = message.trim();
  if (!text) return { needed: false, reason: null };

  for (const pattern of EXPLICIT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { needed: true, reason: 'explicit', matched: match[0] };
  }

  for (const pattern of IMPLIED_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { needed: true, reason: 'complaint', matched: match[0] };
  }

  return { needed: false, reason: null };
}

/**
 * The app records the request for staff (needs_human flag + admin queue); it
 * does not send an out-of-band notification. The wording must say exactly
 * that instead of claiming an agent was notified or a live transfer happened.
 */
export const HANDOFF_NOTICE = {
  zh: '已记录您的转人工请求，客服会在营业时间内查看并尽快回复。您也可以继续在此留言。',
  en: 'Your request for a human agent has been recorded for our staff, who will review it during business hours. You can keep leaving messages here.',
} as const;

export function handoffNotice(locale: 'zh' | 'en'): string {
  return HANDOFF_NOTICE[locale];
}
