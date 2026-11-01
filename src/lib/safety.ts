/**
 * Content safety for customer-facing generation.
 *
 * Two layers:
 * 1. Request screening — illegal / deceptive asks (counterfeit, fake reviews,
 *    fabricated medical claims, ad-law violations) are refused before the model
 *    is called.
 * 2. Output screening —《广告法》absolute-superlative terms ("最", "第一",
 *    "国家级", "100%", "根治" …) are flagged; copywriting rewrites are
 *    suggested so the merchant can fix text before publishing.
 */

export type SafetyCategory =
  | 'illegal_goods'
  | 'fake_reviews'
  | 'fake_claims'
  | 'medical_claims'
  | 'ad_law';

export interface SafetyFinding {
  category: SafetyCategory;
  /** The literal text that triggered the finding. */
  match: string;
  /** Rule id, useful for tests/logs. */
  rule: string;
}

export interface SafetyVerdict {
  allowed: boolean;
  findings: SafetyFinding[];
  /** Fixed, localized refusal suitable for displaying directly. */
  refusal?: { zh: string; en: string };
}

interface Rule {
  id: string;
  category: SafetyCategory;
  pattern: RegExp;
}

/**
 * Request-side rules. Deliberately narrow: an ordinary question such as
 * "这款是正品吗？" must not be blocked. Patterns therefore require an intent to
 * produce/promote the prohibited thing.
 */
const REQUEST_RULES: Rule[] = [
  {
    // Only production/sourcing intent — "买到假货怎么办" is a legitimate
    // after-sales complaint and must not be refused.
    id: 'counterfeit',
    category: 'illegal_goods',
    pattern:
      /(批发|供应|出售|售卖|卖给我|哪里有|在哪买|哪里买|哪买|想买|求购|进一批|进点|我想做|帮我做|怎么做).{0,10}(假货|高仿|复刻|A货|山寨|假包|假鞋|假表|假药|仿品)/i,
  },
  {
    id: 'counterfeit-en',
    category: 'illegal_goods',
    pattern: /(sell|buy|source|supply|where.*(get|buy)).{0,20}(counterfeit|replica|fake (goods|bags|shoes|watches))/i,
  },
  {
    id: 'counterfeit-copy',
    category: 'fake_claims',
    pattern: /(写|生成|帮我|做个|搞个).{0,8}(假货|高仿|复刻|A货|山寨).{0,8}(文案|广告|介绍|详情|推广)/i,
  },
  {
    id: 'contraband',
    category: 'illegal_goods',
    pattern: /(毒品|冰毒|大麻|枪支|弹药|炸药|管制刀具|迷药|春药|假证|假发票|盗刷|洗钱)/i,
  },
  {
    id: 'fake-reviews',
    category: 'fake_reviews',
    pattern: /(刷单|刷好评|刷销量|刷评价|虚假交易|僵尸粉|水军|fake (reviews?|orders)|review.?brushing)/i,
  },
  {
    id: 'fabricated-claims',
    category: 'fake_claims',
    pattern: /(虚假宣传|夸大宣传|虚构|编造.{0,14}(数据|效果|资质|证书|评价|检测)|伪造.{0,10}(检测|证书|认证)|false advertising|fabricate.{0,30}(results?|data|claims?|reviews?))/i,
  },
  {
    id: 'medical-cure',
    category: 'medical_claims',
    pattern: /(包治|根治|治愈|治疗|治好|抗癌|降血糖|降血压|治百病|cure[sd]? .{0,20}(cancer|disease|diabetes))/i,
  },
];

/**
 * Output-side illegal-offer rules. Phrase order is flexible: "有高仿包，支持
 * 批发" and "承接批发，货是高仿的" both count as an offer.
 */
const OUTPUT_RULES: Rule[] = [
  {
    id: 'counterfeit-offer',
    category: 'illegal_goods',
    pattern:
      /(高仿|复刻|A货|山寨|假货|假包|假鞋|假表|假药|仿品).{0,20}(联系我|下单|批发|有货|出售|供应|拿货|现货)/i,
  },
  {
    id: 'counterfeit-offer-reverse',
    category: 'illegal_goods',
    pattern:
      /(批发|供应|出售|售卖|有货|现货|拿货).{0,20}(高仿|复刻|A货|山寨|假包|假鞋|假表|假药|仿品)/i,
  },
  {
    id: 'counterfeit-en-offer',
    category: 'illegal_goods',
    pattern: /\b(replica|counterfeit|fake)\b.{0,30}\b(for sale|available|order|wholesale)\b/i,
  },
];

const REFUSALS: Record<SafetyCategory, { zh: string; en: string }> = {
  illegal_goods: {
    zh: '抱歉，这类涉及违法商品或行为的请求我不能协助。我们可以继续讨论店铺的正常商品与售后问题。',
    en: 'Sorry, I can’t help with requests involving illegal goods or activities. I’m happy to help with your regular products or after-sales questions.',
  },
  fake_reviews: {
    zh: '抱歉，我不能协助刷单、刷评或任何虚假交易。建议通过真实服务提升口碑，我可以帮您写真实卖点文案。',
    en: 'Sorry, I can’t help with fake orders, reviews, or any form of deceptive trading. I can help you write honest selling-point copy instead.',
  },
  fake_claims: {
    zh: '抱歉，我不能协助虚假宣传或编造数据。请提供真实的产品信息，我可以据此撰写合规文案。',
    en: 'Sorry, I can’t help create false advertising or fabricated data. Share real product information and I’ll write compliant copy from it.',
  },
  medical_claims: {
    zh: '抱歉，普通商品不能宣称治疗或根治疾病。我可以帮您描述真实的使用感受与成分信息。',
    en: 'Sorry, ordinary products can’t claim to treat or cure diseases. I can help you describe real usage experience and ingredients instead.',
  },
  ad_law: {
    zh: '抱歉，内容包含《广告法》限制的绝对化用语，已为您处理。',
    en: 'Sorry, the text contained absolute claims restricted by advertising law and has been adjusted.',
  },
};

/** Scans a user/merchant request. */
export function checkRequestSafety(input: string): SafetyVerdict {
  const findings = scan(input, REQUEST_RULES);
  if (findings.length === 0) return { allowed: true, findings: [] };
  return {
    allowed: false,
    findings,
    refusal: REFUSALS[findings[0].category],
  };
}

/**
 * Output-side absolute-term rules. Each carries a safer replacement so copy can
 * be cleaned automatically. Terms are matched in Chinese text only where they
 * behave as superlatives; English equivalents are listed separately.
 */
export interface BannedTerm {
  pattern: RegExp;
  replacement: string;
  label: string;
}

export const AD_LAW_TERMS: BannedTerm[] = [
  { pattern: /国家级/g, replacement: '高品质', label: '国家级' },
  { pattern: /世界级|国际级/g, replacement: '优质', label: '世界级' },
  { pattern: /最高级|最佳|最好|最强|最棒|最优|最低价|最便宜|最先进|最领先|最受欢迎/g, replacement: '出色', label: '最…' },
  { pattern: /第一品牌|全国第一|销量第一|排名第一|行业第一|NO\.?\s*1|No\.?\s*1/gi, replacement: '热门', label: '第一' },
  { pattern: /100\s*%|百分之百/g, replacement: '很', label: '100%' },
  { pattern: /顶级|极品|巅峰|王牌|至尊/g, replacement: '优质', label: '顶级' },
  { pattern: /根治|包治|治愈|药到病除/g, replacement: '缓解', label: '根治' },
  { pattern: /永久|一劳永逸/g, replacement: '持久', label: '永久' },
  { pattern: /唯一|独家/g, replacement: '特色', label: '唯一' },
];

export interface AdLawResult {
  /** Text with banned absolute terms replaced. */
  clean: string;
  warnings: string[];
  matches: string[];
}

/** Replaces absolute-superlative terms and reports what changed. */
export function sanitizeAdLawText(text: string): AdLawResult {
  let clean = text;
  const warnings: string[] = [];
  const matches = new Set<string>();

  for (const term of AD_LAW_TERMS) {
    clean = clean.replace(term.pattern, () => {
      matches.add(term.label);
      warnings.push(`「${term.label}」属于广告法限制的绝对化用语，已替换为「${term.replacement}」。`);
      return term.replacement;
    });
  }

  return { clean, warnings: [...new Set(warnings)], matches: [...matches] };
}

export interface OutputSafetyResult {
  clean: string;
  blocked: boolean;
  warnings: string[];
  adLawMatches: string[];
}

/**
 * Post-processes generated copy: replaces absolute terms. Illegal-content
 * output is not silently rewritten — the caller should discard it.
 */
export function checkOutputSafety(text: string): OutputSafetyResult {
  const adLaw = sanitizeAdLawText(text);
  const illegal = scan(text, [...REQUEST_RULES, ...OUTPUT_RULES]).filter(
    (finding) => finding.category !== 'ad_law',
  );
  return {
    clean: adLaw.clean,
    blocked: illegal.length > 0,
    warnings: adLaw.warnings,
    adLawMatches: adLaw.matches,
  };
}

function scan(text: string, rules: Rule[]): SafetyFinding[] {
  if (!text) return [];
  const findings: SafetyFinding[] = [];
  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''));
    const match = pattern.exec(text);
    if (match) findings.push({ category: rule.category, match: match[0], rule: rule.id });
  }
  return findings;
}
