/**
 * Rule-based intent classification (no model call).
 *
 * Categories map 1:1 to the analytics panel in requirements AC7.2:
 * product / price / logistics / after_sale / complaint / handoff / other.
 */

export const INTENTS = [
  'product',
  'price',
  'logistics',
  'after_sale',
  'complaint',
  'handoff',
  'other',
] as const;

export type Intent = (typeof INTENTS)[number];

export interface IntentResult {
  intent: Intent;
  /** Confidence in [0,1]; useful for debugging and low-signal UI hints. */
  score: number;
  /** Which rule fired, for tests. */
  rule: string;
}

interface IntentRule {
  intent: Intent;
  rule: string;
  pattern: RegExp;
  weight: number;
}

/** Order matters only for tie-breaking; patterns are evaluated in order. */
const RULES: IntentRule[] = [
  {
    intent: 'handoff',
    rule: 'handoff-request',
    pattern: /(转人工|人工客服|找人工|要人工|真人客服|转客服|找客服|客服在吗|human|real person|live agent|agent please|speak to (a )?(human|agent))/i,
    weight: 3,
  },
  {
    intent: 'complaint',
    rule: 'complaint',
    pattern: /(投诉|差评|举报|骗子|欺诈|太差|失望|生气|垃圾|坑人|维权|complain|complaint|refund.{0,10}(now|immediately)|terrible|awful)/i,
    weight: 3,
  },
  {
    intent: 'after_sale',
    rule: 'after-sale',
    pattern: /(退货|退款|换货|退换|售后|保修|维修|坏了|破损|漏发|错发|少发|质量问题|return|refund|exchange|warranty|broken|damaged)/i,
    weight: 3,
  },
  {
    intent: 'logistics',
    rule: 'logistics',
    pattern: /(物流|快递|发货|配送|运费|包邮|到货|几天到|多久到|签收|顺丰|中通|圆通|shipping|delivery|courier|tracking|when.*arrive)/i,
    weight: 2,
  },
  {
    intent: 'price',
    rule: 'price',
    pattern: /(多少钱|价格|价钱|报价|优惠|折扣|打折|促销|活动|券|便宜|贵|满减|discount|price|how much|deal|coupon|cheaper)/i,
    weight: 2,
  },
  {
    intent: 'product',
    rule: 'product',
    pattern: /(商品|产品|这款|那款|哪款|有没有|有卖|推荐|规格|尺寸|材质|颜色|成分|库存|现货|适合|product|item|catalog|recommend|size|material|color|stock|available)/i,
    weight: 1,
  },
];

/** Classifies a single user message. Best-effort, deterministic. */
export function classifyIntent(message: string): IntentResult {
  const text = message.trim();
  if (!text) return { intent: 'other', score: 0, rule: 'empty' };

  let best: IntentResult = { intent: 'other', score: 0, rule: 'fallback' };
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    const score = Math.min(1, rule.weight / 3);
    // First (highest-priority) match wins; later rules only replace an "other".
    if (best.intent === 'other' || score > best.score) {
      best = { intent: rule.intent, score, rule: rule.rule };
      if (rule.weight >= 3) break;
    }
  }
  return best;
}

/** Human-readable labels for the analytics UI. */
export const INTENT_LABELS: Record<Intent, { zh: string; en: string }> = {
  product: { zh: '商品咨询', en: 'Product' },
  price: { zh: '价格优惠', en: 'Pricing' },
  logistics: { zh: '物流配送', en: 'Shipping' },
  after_sale: { zh: '退换售后', en: 'After-sales' },
  complaint: { zh: '投诉', en: 'Complaint' },
  handoff: { zh: '转人工', en: 'Human handoff' },
  other: { zh: '其他', en: 'Other' },
};

export function isIntent(value: unknown): value is Intent {
  return typeof value === 'string' && (INTENTS as readonly string[]).includes(value);
}
