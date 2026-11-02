import { randomUUID } from 'node:crypto';
import { addCopyHistory, getProduct, type DB, type Product } from './db';
import { checkOutputSafety, checkRequestSafety, sanitizeAdLawText } from './safety';
import type { Locale } from './i18n';
import { LlmError, type LlmProvider } from './llm/types';
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

interface ParsedPlatformOutput {
  title: string;
  body: string;
  /** json = strict parse, salvaged = repaired/truncated JSON, text = plain text. */
  kind: 'json' | 'salvaged' | 'text' | 'invalid' | 'empty';
  /** True when the model output stopped mid-JSON (likely token-limit truncation). */
  partial: boolean;
}

/**
 * Parses the model response. Prefers strict JSON, then fenced JSON, then
 * truncated JSON (salvaging any complete title/body prefix), and finally plain
 * text (first short line -> title, remainder -> body). Raw JSON is never
 * returned as body: an unrepairable JSON fragment is treated as a failure so
 * the caller can retry or report generation_failed.
 */
export function parsePlatformOutput(raw: string): { title: string; body: string } {
  const parsed = parsePlatformOutputDetailed(raw);
  return { title: parsed.title, body: parsed.body };
}

function parsePlatformOutputDetailed(raw: string): ParsedPlatformOutput {
  const text = raw.trim();
  if (!text) return { title: '', body: '', kind: 'empty', partial: false };

  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const candidates = [unfenced];
  if (fencedMatch?.[1]?.trim()) candidates.push(fencedMatch[1].trim());
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }
  if (firstBrace !== -1 && lastBrace <= firstBrace) {
    candidates.push(unfenced.slice(firstBrace));
  }

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed) {
      const title =
        firstString(parsed.title) ?? firstString(parsed.headline) ?? firstString(parsed.subject) ?? '';
      const body =
        firstText(parsed.body) ??
        firstText(parsed.content) ??
        firstText(parsed.text) ??
        firstText(parsed.copy) ??
        '';
      if (title || body) return { title: title.trim(), body: body.trim(), kind: 'json', partial: false };
    }
  }

  // The model was cut off mid-object (reasoning models can exhaust max_tokens
  // before emitting any content). Recover the string fields written so far.
  const jsonSource = firstBrace !== -1 ? unfenced.slice(firstBrace) : unfenced;
  const looksLikeJson = jsonSource.startsWith('{') || /"(?:title|body)"\s*:/.test(text);
  if (looksLikeJson) {
    const title = salvageJsonField(jsonSource, 'title');
    const body =
      salvageJsonField(jsonSource, 'body') ??
      salvageJsonField(jsonSource, 'content') ??
      salvageJsonField(jsonSource, 'text') ??
      salvageJsonField(jsonSource, 'copy');
    if (title || body) {
      const closed = jsonSource.trimEnd().endsWith('}');
      return {
        title: (title?.value ?? '').trim(),
        body: (body?.value ?? '').trim(),
        kind: 'salvaged',
        partial: !closed || Boolean(title && !title.closed) || Boolean(body && !body.closed),
      };
    }
    return { title: '', body: '', kind: 'invalid', partial: true };
  }

  const lines = unfenced.split('\n').map((line) => line.trim());
  const firstLine = lines.find(Boolean) ?? '';
  if (firstLine.length > 0 && firstLine.length <= 40 && lines.length > 1) {
    const rest = lines.slice(lines.indexOf(firstLine) + 1).join('\n').trim();
    if (rest) return { title: firstLine, body: rest, kind: 'text', partial: false };
  }
  return { title: '', body: unfenced, kind: 'text', partial: false };
}

function tryParseJsonObject(candidate: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads a possibly-unterminated JSON string value for `key`. Escapes are
 * decoded (so truncated bodies keep their real newlines); a dangling escape or
 * `\u` sequence is dropped.
 */
function salvageJsonField(
  source: string,
  key: string,
): { value: string; closed: boolean } | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"`, 'i').exec(source);
  if (!match) return null;
  return decodeJsonStringPrefix(source, match.index + match[0].length);
}

function decodeJsonStringPrefix(source: string, start: number): { value: string; closed: boolean } {
  let value = '';
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') return { value, closed: true };
    if (char !== '\\') {
      value += char;
      index += 1;
      continue;
    }

    const escape = source[index + 1];
    if (escape === undefined) break;
    if (escape === 'u') {
      const hex = source.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      index += 6;
      continue;
    }
    const simple: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    value += simple[escape] ?? escape;
    index += 2;
  }
  return { value, closed: false };
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Accepts a string or an array of strings (some gateways return sections). */
function firstText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null;
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === 'string');
    const joined = parts.join('\n').trim();
    return joined ? joined : null;
  }
  return null;
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
    zh: '小红书种草笔记：20 字以内标题（可带 emoji）+ 3–5 段正文 + 5 个话题标签；口语化、场景化、适量 emoji。只描述商品资料能支持的内容，不要虚构个人使用经历。',
    en: 'Xiaohongshu note: a title under 20 characters, 3–5 short paragraphs and 5 hashtags; conversational, scene-based and emoji-friendly. Do not invent personal experience.',
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

/**
 * Output-token budgets per platform. The gateway's reasoning model spends
 * completion tokens on hidden reasoning first, so a fixed low budget (the old
 * 900) can be exhausted before any copy is emitted — most often for the long
 * detail-page and Douyin-script formats.
 */
export const PLATFORM_MAX_TOKENS: Record<CopyPlatform, number> = {
  xiaohongshu: 2400,
  moments: 2400,
  detail: 3200,
  douyin: 3200,
};

/** Ceiling for the single retry (budget doubles, but never beyond this). */
const RETRY_MAX_TOKENS = 6000;

/** A salvaged partial body shorter than this is not publishable. */
const MIN_SALVAGED_BODY = 30;

export function buildPlatformPrompt(input: PlatformPromptInput): { system: string; user: string } {
  const { platform, product, audience, sellingPoints, tone, lang } = input;
  const price = `¥${product.price.toFixed(2)}`;

  const system = [
    'You are a senior e-commerce copywriter for small Chinese retailers.',
    'Write publish-ready marketing copy that obeys China’s Advertising Law.',
    'Rules:',
    '- Use only the supplied product facts. Never invent prices, stock, certifications, sales numbers, test results, awards or medical effects.',
    '- Never invent first-person or customer experiences (e.g. “我用了三个月”, “亲测有效”, “顾客反馈”), review quotes, surveys or statistics. Describe the product and its intended use only.',
    lang === 'zh'
      ? '- 只能使用提供的商品信息：不要编造亲身体验、使用时长、检测结果、销量、资质、用户评价或任何资料中没有的事实；资料不足时宁可不写。'
      : '- Do not fabricate personal use, test results, sales figures, certifications, reviews or any fact not present in the product data. Omit what is missing.',
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

function requestCopy(
  provider: LlmProvider,
  prompt: { system: string; user: string },
  options: { maxTokens: number; json: boolean },
): Promise<string> {
  return provider.complete({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: 0.8,
    maxTokens: options.maxTokens,
    json: options.json,
  });
}

type GenerationFailure = 'provider_error' | 'empty_output' | 'truncated_output' | 'unparsed_output';

interface AttemptResult {
  raw: string;
  parse: ParsedPlatformOutput;
  failure?: GenerationFailure;
  status?: number;
}

async function attemptGeneration(
  provider: LlmProvider,
  prompt: { system: string; user: string },
  maxTokens: number,
  json: boolean,
): Promise<AttemptResult> {
  let raw: string;
  try {
    raw = await requestCopy(provider, prompt, { maxTokens, json });
  } catch (error) {
    return {
      raw: '',
      parse: { title: '', body: '', kind: 'empty', partial: false },
      failure: 'provider_error',
      status: error instanceof LlmError ? error.status : undefined,
    };
  }

  const parse = parsePlatformOutputDetailed(raw);
  if (!parse.title && !parse.body) {
    return { raw, parse, failure: parse.kind === 'empty' ? 'empty_output' : 'unparsed_output' };
  }
  // A title without a body cannot be published; retry rather than ship it.
  if (!parse.body) return { raw, parse, failure: 'unparsed_output' };
  if (parse.partial) return { raw, parse, failure: 'truncated_output' };
  return { raw, parse };
}

function failedPlatformCopy(platform: CopyPlatform): PlatformCopy {
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

function logGenerationFailure(
  platform: CopyPlatform,
  failure: GenerationFailure,
  attempt: number,
  status?: number,
): void {
  // Deliberately no prompt/completion content and no API key.
  console.warn('[copywriting] generation attempt failed', {
    platform,
    attempt,
    failure,
    ...(status !== undefined ? { status } : {}),
  });
}

/**
 * Generates one platform with at most one retry:
 * - truncated / empty / unparsable output -> retry once with a doubled budget;
 * - HTTP 400 (e.g. gateway rejects JSON mode) -> retry once without JSON mode.
 * Transport failures (timeouts, 5xx after the provider's own retry) are not
 * retried again here. A sufficiently long partially salvaged answer from an
 * earlier attempt is still usable when the retry also fails.
 */
async function generatePlatformText(
  provider: LlmProvider,
  platform: CopyPlatform,
  prompt: { system: string; user: string },
): Promise<string | null> {
  const baseTokens = PLATFORM_MAX_TOKENS[platform];
  const first = await attemptGeneration(provider, prompt, baseTokens, true);

  if (!first.failure) return first.raw;
  logGenerationFailure(platform, first.failure, 1, first.status);

  // Transport errors other than a rejected JSON mode are already retried once
  // inside OpenAiProvider; retrying here again would triple the latency.
  if (first.failure === 'provider_error' && first.status !== 400) return null;

  const retryOptions =
    first.failure === 'provider_error' && first.status === 400
      ? { maxTokens: baseTokens, json: false }
      : { maxTokens: Math.min(baseTokens * 2, RETRY_MAX_TOKENS), json: true };
  const second = await attemptGeneration(
    provider,
    prompt,
    retryOptions.maxTokens,
    retryOptions.json,
  );

  if (!second.failure) return second.raw;
  logGenerationFailure(platform, second.failure, 2, second.status);

  // A truncated answer is better than nothing, but only when enough text was
  // recovered to publish. Prefer the retry, then the first attempt.
  const usable = [second, first].find(
    (result) => result.parse.body.trim().length >= MIN_SALVAGED_BODY,
  );
  return usable?.raw ?? null;
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
      const prompt = buildPlatformPrompt({
        platform,
        product,
        audience: input.audience,
        sellingPoints,
        tone: input.tone,
        lang: input.lang,
      });

      if (mock) {
        const raw = buildMockCopy({
          platform,
          product,
          audience: input.audience,
          sellingPoints,
          tone: input.tone,
          lang: input.lang,
        });
        return finalizePlatformCopy(platform, raw, input.lang);
      }

      try {
        const raw = await generatePlatformText(provider, platform, prompt);
        if (raw === null) return failedPlatformCopy(platform);
        return finalizePlatformCopy(platform, raw, input.lang);
      } catch (error) {
        // Defensive: generatePlatformText already handles provider errors.
        console.warn('[copywriting] platform generation crashed', {
          platform,
          error: error instanceof Error ? error.name : 'unknown',
          status: error instanceof LlmError ? error.status : undefined,
        });
        return failedPlatformCopy(platform);
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
