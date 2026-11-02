import { randomUUID } from 'node:crypto';
import { addCopyHistory, getProduct, type DB, type Product } from './db';
import { checkOutputSafety, checkRequestSafety, sanitizeAdLawText } from './safety';
import type { Locale } from './i18n';
import type { LlmProvider } from './llm/types';
import {
  COPY_PLATFORMS,
  COPY_TONES,
  PLATFORM_LABELS,
  TONE_LABELS,
  isCopyPlatform,
  isCopyTone,
  type CopyPlatform,
  type CopyTone,
} from './copywriting-shared';

export * from './copywriting-shared';

/**
 * Marketing copy generator (AC4.1–AC4.3).
 *
 * One prompt per platform, all platforms in parallel. Each result is cleaned
 * of《广告法》absolute terms and checked for illegal offers before it reaches
 * the merchant. No API key? Deterministic, product-grounded mock copy keeps the
 * studio fully usable offline.
 */

export interface CopywriteInput {
  productId: number;
  audience: string;
  /** Merchant-edited selling points. Empty -> product.sellingPoints. */
  sellingPoints: string[];
  tone: CopyTone;
  platforms: CopyPlatform[];
  lang: Locale;
}

export interface PlatformCopy {
  platform: CopyPlatform;
  title: string;
  body: string;
  /** Ready-to-copy title + body. Empty when blocked. */
  text: string;
  warnings: string[];
  blocked: boolean;
  /** Set when generation for this platform failed; other platforms still return. */
  error?: 'generation_failed';
}

export interface CopywriteResult {
  outputs: PlatformCopy[];
  warnings: string[];
  mock: boolean;
  historyId: string;
}

export type CopywriteErrorCode =
  | 'product_not_found'
  | 'content_blocked'
  | 'generation_failed';

export class CopywriteError extends Error {
  readonly code: CopywriteErrorCode;
  readonly refusal?: { zh: string; en: string };

  constructor(
    code: CopywriteErrorCode,
    options: { refusal?: { zh: string; en: string }; message?: string } = {},
  ) {
    super(options.message ?? code);
    this.name = 'CopywriteError';
    this.code = code;
    this.refusal = options.refusal;
  }
}

const BLOCKED_NOTICE = {
  zh: '生成内容包含违规表述，已被拦截，请调整卖点后重试。',
  en: 'The generated copy contained a prohibited claim and was blocked. Please adjust the selling points and try again.',
} as const;

const EMOJI_RE = /\p{Extended_Pictographic}/u;

const PLATFORM_EMOJI: Record<CopyPlatform, string> = {
  xiaohongshu: '✨',
  moments: '🌿',
  detail: '📦',
  douyin: '🎬',
};

export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text);
}

/** Guarantees at least one emoji so generated cards match AC4.2. */
export function ensureEmoji(text: string, platform: CopyPlatform): string {
  if (!text) return text;
  return hasEmoji(text) ? text : `${text} ${PLATFORM_EMOJI[platform]}`;
}

/** Splits a product's stored selling points ("；", ";", newlines) into a list. */
export function splitSellingPoints(value: string): string[] {
  return value
    .split(/[;；\n]+/)
    .map((point) => point.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Parses the model response. Prefers strict JSON, tolerates fenced JSON and
 * plain text (first short line -> title, remainder -> body).
 */
export function parsePlatformOutput(raw: string): { title: string; body: string } {
  const text = raw.trim();
  if (!text) return { title: '', body: '' };

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const title =
          firstString(parsed.title) ?? firstString(parsed.headline) ?? firstString(parsed.subject) ?? '';
        const body =
          firstString(parsed.body) ??
          firstString(parsed.content) ??
          firstString(parsed.text) ??
          firstString(parsed.copy) ??
          '';
        if (title || body) return { title: title.trim(), body: body.trim() };
      }
    } catch {
      // Try the next candidate.
    }
  }

  const lines = unfenced.split('\n').map((line) => line.trim());
  const firstLine = lines.find(Boolean) ?? '';
  if (firstLine.length > 0 && firstLine.length <= 40 && lines.length > 1) {
    const rest = lines.slice(lines.indexOf(firstLine) + 1).join('\n').trim();
    if (rest) return { title: firstLine, body: rest };
  }
  return { title: '', body: unfenced };
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export interface PlatformPromptInput {
  platform: CopyPlatform;
  product: Product;
  audience: string;
  sellingPoints: string[];
  tone: CopyTone;
  lang: Locale;
}

const PLATFORM_RULES: Record<CopyPlatform, { zh: string; en: string }> = {
  xiaohongshu: {
    zh: '小红书种草笔记：20 字以内标题（可带 emoji）+ 3–5 段正文 + 5 个话题标签；口语化、有真实体验感、适量 emoji。',
    en: 'Xiaohongshu note: a title under 20 characters, 3–5 short paragraphs and 5 hashtags; conversational, first-person and emoji-friendly.',
  },
  moments: {
    zh: '微信朋友圈：100–180 字短文案，2–3 句话，生活化语气，少量 emoji，不要堆砌话题标签。',
    en: 'WeChat Moments: 100–180 characters, two or three sentences, warm and personal, a few emoji, no hashtag stuffing.',
  },
  detail: {
    zh: '电商详情页：结构化段落，包含一句主标题、3–5 条核心卖点、商品信息与温馨提示；专业、克制、不夸大。',
    en: 'E-commerce detail page: a headline, 3–5 selling-point bullets, product facts and a short note; professional and factual.',
  },
  douyin: {
    zh: '抖音短视频脚本：15–30 秒分镜，按时间轴写「画面 + 口播」，结尾带行动号召与 2–3 个话题标签。',
    en: 'Douyin short-video script: a 15–30 second storyboard with timestamped “visual + voice-over”, an ending CTA and 2–3 hashtags.',
  },
};

export function buildPlatformPrompt(input: PlatformPromptInput): { system: string; user: string } {
  const { platform, product, audience, sellingPoints, tone, lang } = input;
  const price = `¥${product.price.toFixed(2)}`;

  const system = [
    'You are a senior e-commerce copywriter for small Chinese retailers.',
    'Write publish-ready marketing copy that obeys China’s Advertising Law.',
    'Rules:',
    '- Use only the supplied product facts. Never invent prices, stock, certifications, sales numbers or medical effects.',
    '- Do not use absolute superlatives (最/第一/国家级/100%/唯一/顶级) or cure claims.',
    '- Use emoji naturally.',
    `- ${PLATFORM_RULES[platform][lang]}`,
    lang === 'en' ? '- Write the copy in English.' : '- 用中文写作。',
    '- Return strict JSON only, no markdown fences: {"title":"...","body":"..."}',
  ].join('\n');

  const user = [
    `Platform: ${PLATFORM_LABELS[platform][lang]}`,
    `Product: ${product.name}`,
    product.category ? `Category: ${product.category}` : '',
    `Reference price (from database, do not change): ${price}`,
    product.description ? `Description: ${product.description}` : '',
    `Audience: ${audience || (lang === 'en' ? 'general shoppers' : '普通消费者')}`,
    `Tone: ${TONE_LABELS[tone][lang]}`,
    'Selling points:',
    ...(sellingPoints.length ? sellingPoints.map((point) => `- ${point}`) : ['- Use the description above.']),
    '',
    `Format: ${PLATFORM_RULES[platform][lang]}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

async function generateOne(
  provider: LlmProvider,
  prompt: { system: string; user: string },
): Promise<string> {
  return provider.complete({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: 0.8,
    maxTokens: 900,
  });
}

/** Runs one platform, cleaning ad-law terms and blocking illegal output. */
export function finalizePlatformCopy(
  platform: CopyPlatform,
  raw: string,
  lang: Locale,
): PlatformCopy {
  const parsed = parsePlatformOutput(raw);
  const titleResult = sanitizeAdLawText(parsed.title);
  const bodyResult = sanitizeAdLawText(parsed.body);
  const title = titleResult.clean.trim();
  const body = ensureEmoji(bodyResult.clean.trim(), platform);
  const combined = [title, body].filter(Boolean).join('\n\n');
  const warnings = [...new Set([...titleResult.warnings, ...bodyResult.warnings])];

  if (!combined) {
    return {
      platform,
      title: '',
      body: '',
      text: '',
      warnings,
      blocked: false,
      error: 'generation_failed',
    };
  }

  const safety = checkOutputSafety(combined);
  if (safety.blocked) {
    return {
      platform,
      title: '',
      body: '',
      text: '',
      warnings: [...new Set([...warnings, BLOCKED_NOTICE[lang]])],
      blocked: true,
    };
  }

  return {
    platform,
    title,
    body,
    text: combined,
    warnings: [...new Set([...warnings, ...safety.warnings])],
    blocked: false,
  };
}

/**
 * Generates all requested platforms concurrently and records the run in
 * copy_history. Per-platform failures are reported in `outputs`; the call only
 * throws when every platform failed.
 */
export async function generateCopywriting(
  db: DB,
  provider: LlmProvider,
  input: CopywriteInput,
): Promise<CopywriteResult> {
  const product = getProduct(db, input.productId);
  if (!product) throw new CopywriteError('product_not_found');

  const sellingPoints =
    input.sellingPoints.map((point) => point.trim()).filter(Boolean).length > 0
      ? input.sellingPoints.map((point) => point.trim()).filter(Boolean)
      : splitSellingPoints(product.sellingPoints);

  // Screen what the merchant explicitly asked to advertise. Product rows are
  // internal data and are covered by the output-side ad-law cleanup.
  const requestText = [input.audience, ...sellingPoints].join('\n');
  const requestSafety = checkRequestSafety(requestText);
  if (!requestSafety.allowed && requestSafety.refusal) {
    throw new CopywriteError('content_blocked', { refusal: requestSafety.refusal });
  }

  const mock = provider.kind === 'mock';
  const outputs = await Promise.all(
    input.platforms.map(async (platform): Promise<PlatformCopy> => {
      try {
        const raw = mock
          ? buildMockCopy({ platform, product, audience: input.audience, sellingPoints, tone: input.tone, lang: input.lang })
          : await generateOne(
              provider,
              buildPlatformPrompt({
                platform,
                product,
                audience: input.audience,
                sellingPoints,
                tone: input.tone,
                lang: input.lang,
              }),
            );
        return finalizePlatformCopy(platform, raw, input.lang);
      } catch {
        return {
          platform,
          title: '',
          body: '',
          text: '',
          warnings: [],
          blocked: false,
          error: 'generation_failed',
        };
      }
    }),
  );

  if (outputs.every((output) => output.error === 'generation_failed')) {
    throw new CopywriteError('generation_failed');
  }

  const historyId = randomUUID();
  addCopyHistory(db, {
    id: historyId,
    productId: product.id,
    params: {
      productName: product.name,
      audience: input.audience,
      sellingPoints,
      tone: input.tone,
      platforms: input.platforms,
      lang: input.lang,
      mock,
    },
    outputs: { items: outputs },
  });

  return {
    outputs,
    warnings: [...new Set(outputs.flatMap((output) => output.warnings))],
    mock,
    historyId,
  };
}

// ---------------------------------------------------------------------------
// Deterministic mock copy
// ---------------------------------------------------------------------------

const TONE_OPENERS: Record<CopyTone, { zh: string; en: string }> = {
  lively: { zh: '这件好物我真的想按头安利！', en: 'I genuinely want to shout about this one!' },
  professional: {
    zh: '从材质与使用体验来看，这款商品值得关注。',
    en: 'From materials to everyday use, this product is worth a closer look.',
  },
  warm: { zh: '想和你分享一件让日常更舒服的小物。', en: 'Sharing a little find that makes everyday life cozier.' },
  premium: {
    zh: '简约而有质感的选择，值得慢慢了解。',
    en: 'A understated, well-made choice worth taking your time with.',
  },
  humorous: {
    zh: '钱包预警：看完可能就想把它带回家。',
    en: 'Wallet warning: you may want to take this one home.',
  },
};

export interface MockCopyInput {
  platform: CopyPlatform;
  product: Product;
  audience: string;
  sellingPoints: string[];
  tone: CopyTone;
  lang: Locale;
}

/** Template-based copy grounded in the product row; used without an API key. */
export function buildMockCopy(input: MockCopyInput): string {
  const { platform, product, audience, sellingPoints, tone, lang } = input;
  const points = sellingPoints.length ? sellingPoints : ['品质可靠'];
  const price = `¥${product.price.toFixed(2)}`;
  const category = product.category || (lang === 'zh' ? '生活好物' : 'everyday goods');
  const tag = product.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12) || 'shoppulse';

  if (lang === 'en') {
    return buildMockCopyEn({ platform, product, audience, points, tone, price, category, tag });
  }

  const opener = TONE_OPENERS[tone].zh;
  const audienceLine = audience ? `特别适合${audience}。` : '';

  switch (platform) {
    case 'xiaohongshu':
      return [
        `${product.name}｜${audience || '日常好物'}分享`,
        `${PLATFORM_EMOJI.xiaohongshu} ${opener}`,
        audienceLine,
        ...points.slice(0, 5).map((point) => `✅ ${point}`),
        product.description ? `📝 ${product.description}` : '',
        `💰 参考价 ${price}，具体以下单页面为准。`,
        `#好物分享 #${category.replace(/\s+/g, '')} #${tag}`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'moments':
      return [
        `${PLATFORM_EMOJI.moments} 好物分享｜${product.name}`,
        `${opener}${audienceLine}`,
        ...points.slice(0, 3).map((point) => `· ${point}`),
        `参考价 ${price}，喜欢的朋友可以来店里看看～ 💬`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'detail':
      return [
        product.name,
        product.description || opener,
        '',
        '【核心卖点】',
        ...points.slice(0, 5).map((point, index) => `${index + 1}. ${point}`),
        '',
        '【商品信息】',
        `分类：${category}`,
        `参考价：${price}`,
        product.url ? `详情链接：${product.url}` : '',
        '',
        '📦 温馨提示：库存、活动与最终价格以下单页面为准。',
      ]
        .filter((line) => line !== undefined)
        .join('\n');
    case 'douyin':
      return [
        `${PLATFORM_EMOJI.douyin} 抖音短视频脚本｜${product.name}（15–30 秒）`,
        '',
        '0–3 秒｜开场',
        `画面：${product.name} 特写，镜头缓慢推进`,
        `口播：${audience ? `如果你也是${audience}，` : ''}先别划走～`,
        '',
        '3–8 秒｜使用场景',
        '画面：日常使用场景，展示产品细节',
        `口播：${points[0]}，用起来更省心。`,
        '',
        '8–18 秒｜卖点展示',
        '画面：逐条展示产品细节与上手效果',
        `口播：${points.slice(0, 3).join('；')}。`,
        '',
        '18–25 秒｜价格与行动号召',
        '画面：商品与价格字幕',
        `口播：参考价 ${price}，喜欢可以点进主页看看。`,
        '',
        '25–30 秒｜结尾',
        '画面：商品定格 + 店铺标识',
        '口播：有任何问题，评论区见！💬',
        '',
        `#${category.replace(/\s+/g, '')} #好物推荐 #${tag}`,
      ].join('\n');
  }
}

function buildMockCopyEn(input: {
  platform: CopyPlatform;
  product: Product;
  audience: string;
  points: string[];
  tone: CopyTone;
  price: string;
  category: string;
  tag: string;
}): string {
  const { platform, product, audience, points, tone, price, category, tag } = input;
  const opener = TONE_OPENERS[tone].en;
  const audienceLine = audience ? ` Perfect for ${audience}.` : '';

  switch (platform) {
    case 'xiaohongshu':
      return [
        `${product.name} | ${audience || 'Everyday pick'}`,
        `${PLATFORM_EMOJI.xiaohongshu} ${opener}${audienceLine}`,
        ...points.slice(0, 5).map((point) => `✅ ${point}`),
        product.description ? `📝 ${product.description}` : '',
        `💰 Reference price ${price}; the checkout page is final.`,
        `#finds #${category.replace(/\s+/g, '')} #${tag}`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'moments':
      return [
        `${PLATFORM_EMOJI.moments} A little find: ${product.name}`,
        `${opener}${audienceLine}`,
        ...points.slice(0, 3).map((point) => `· ${point}`),
        `Reference price ${price}. Drop by the store if you are interested 💬`,
      ]
        .filter(Boolean)
        .join('\n');
    case 'detail':
      return [
        product.name,
        product.description || opener,
        '',
        'Key selling points',
        ...points.slice(0, 5).map((point, index) => `${index + 1}. ${point}`),
        '',
        'Product facts',
        `Category: ${category}`,
        `Reference price: ${price}`,
        product.url ? `Details: ${product.url}` : '',
        '',
        '📦 Note: stock, promotions and the final price are confirmed on the checkout page.',
      ]
        .filter(Boolean)
        .join('\n');
    case 'douyin':
      return [
        `${PLATFORM_EMOJI.douyin} Douyin script | ${product.name} (15–30s)`,
        '',
        '0–3s | Hook',
        `Visual: close-up of ${product.name}, slow push-in`,
        `Voice-over: ${audience ? `If you are ${audience}, ` : ''}don’t scroll yet.`,
        '',
        '3–8s | Everyday use',
        `Visual: product in real use, detail shots`,
        `Voice-over: ${points[0]} — easier every day.`,
        '',
        '8–18s | Selling points',
        'Visual: show each detail in turn',
        `Voice-over: ${points.slice(0, 3).join('; ')}.`,
        '',
        '18–25s | Price and CTA',
        'Visual: product with price caption',
        `Voice-over: reference price ${price}. Check the profile for more.`,
        '',
        '25–30s | Outro',
        'Visual: product frozen frame + shop mark',
        'Voice-over: Questions? See you in the comments! 💬',
        '',
        `#${category.replace(/\s+/g, '')} #finds #${tag}`,
      ].join('\n');
  }
}
