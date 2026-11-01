import { randomUUID } from 'node:crypto';
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
  touchConversation,
  type DB,
  type KbEntry,
  type Message,
  type Product,
  type Site,
} from './db';
import { detectHandoff } from './handoff';
import { classifyIntent, type Intent } from './intent';
import type { LlmProvider } from './llm/types';
import { applyPriceGuard, collectAllowedPrices } from './price-guard';
import { retrieve, type Scored } from './retrieval';
import { checkRequestSafety } from './safety';
import type { Locale } from './i18n';

/**
 * Chat orchestration shared by /api/widget/chat and tests.
 *
 * Emits an ordered event stream:
 *   meta -> products? -> handoff? -> delta* -> delta(correction)? -> done
 * or, on failure, a single `error` event.
 */

export type ChatEvent =
  | {
      event: 'meta';
      data: { conversationId: string; mock: boolean; locale: Locale };
    }
  | { event: 'products'; data: { items: WidgetProduct[] } }
  | { event: 'handoff'; data: { needed: true; reason: 'explicit' | 'complaint' } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { conversationId: string } }
  | { event: 'error'; data: { message: string } };

export interface WidgetProduct {
  id: number;
  name: string;
  sku: string | null;
  category: string;
  price: number;
  stock: number;
  imageUrl: string;
  url: string;
  sellingPoints: string;
}

export interface ChatInput {
  db: DB;
  provider: LlmProvider;
  site: Site;
  message: string;
  conversationId?: string | null;
  visitorId?: string | null;
  locale?: Locale;
  signal?: AbortSignal;
  /** Injectable for deterministic tests. */
  newId?: () => string;
}

export const MAX_MESSAGE_LENGTH = 1000;
export const HISTORY_MESSAGES = 12; // ~6 rounds

export class ChatInputError extends Error {
  readonly code: 'empty_message' | 'message_too_long';
  constructor(code: ChatInputError['code'], message: string) {
    super(message);
    this.name = 'ChatInputError';
    this.code = code;
  }
}

export function validateMessage(message: unknown): string {
  if (typeof message !== 'string' || !message.trim()) {
    throw new ChatInputError('empty_message', 'Message is required');
  }
  const trimmed = message.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ChatInputError('message_too_long', `Message exceeds ${MAX_MESSAGE_LENGTH} characters`);
  }
  return trimmed;
}

/** Builds the grounded system prompt. The model may only use 【资料】. */
export function buildSystemPrompt(
  locale: Locale,
  knowledge: Scored<KbEntry>[],
  products: Scored<Product>[],
): string {
  const kbLines = knowledge.map(({ item }) => `- [${item.type}] ${item.title}：${item.content}`);
  const productLines = products.map(({ item }) => {
    const parts = [
      `- ${item.name}`,
      `价格 ¥${item.price.toFixed(2)}`,
      item.category ? `分类 ${item.category}` : '',
      item.stock > 0 ? `库存 ${item.stock}` : '暂时缺货',
      item.sellingPoints ? `卖点：${item.sellingPoints}` : '',
      item.description ? `描述：${item.description}` : '',
    ];
    return parts.filter(Boolean).join('；');
  });

  const hasResources = kbLines.length > 0 || productLines.length > 0;

  return [
    '你是店铺的 AI 客服助手。请严格遵守以下规则：',
    '1. 只能依据下方资料回答。资料中没有的价格、政策、时效、优惠，必须回答“暂无该信息”，并建议用户转人工，绝不猜测或编造。',
    '2. 不得编造任何商品价格。价格只能引用【资料】中出现的数字。',
    '3. 不得做虚假宣传，不得使用“最”“第一”“国家级”“100%”“根治”等绝对化或医疗承诺用语。',
    '4. 不回答违法、售假、刷单等请求，礼貌拒绝并引导回正常咨询。',
    '5. 回答简洁友好，中文提问用中文回答，英文提问用英文回答。',
    '6. 如果用户要求转人工，告知已为其转接人工客服。',
    '',
    '【资料】',
    hasResources ? [...kbLines, ...productLines].join('\n') : '（当前暂无可用资料）',
    '【资料结束】',
    '',
    locale === 'en'
      ? 'Answer in English unless the customer writes in Chinese.'
      : '请优先使用中文回答。',
  ].join('\n');
}

function toWidgetProduct(product: Product): WidgetProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    price: product.price,
    stock: product.stock,
    imageUrl: product.imageUrl,
    url: product.url,
    sellingPoints: product.sellingPoints,
  };
}

function conversationHistory(messages: Message[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));
}

/** Resolves (or creates) the conversation, guarding against site mismatches. */
function resolveConversation(
  db: DB,
  site: Site,
  conversationId: string | null | undefined,
  visitorId: string | null | undefined,
  newId: () => string,
): { conversationId: string; history: Message[] } {
  if (conversationId) {
    const existing = getConversation(db, conversationId);
    const sameOwner =
      !existing ||
      !existing.visitorId ||
      !visitorId ||
      existing.visitorId === visitorId;
    if (existing && existing.siteId === site.id && sameOwner) {
      return { conversationId: existing.id, history: listMessages(db, existing.id) };
    }
  }

  const id = newId();
  createConversation(db, {
    id,
    siteId: site.id,
    visitorId: visitorId ?? '',
  });
  return { conversationId: id, history: [] };
}

/**
 * Runs one chat turn. Yields events as they become available. Never throws for
 * expected conditions; LLM failures become an `error` event.
 */
export async function* runChat(input: ChatInput): AsyncGenerator<ChatEvent, void, unknown> {
  const { db, provider, site, locale = 'zh' } = input;
  const newId = input.newId ?? randomUUID;
  const message = validateMessage(input.message);
  const mock = provider.kind === 'mock';

  const { conversationId, history } = resolveConversation(
    db,
    site,
    input.conversationId,
    input.visitorId,
    newId,
  );

  const intentResult = classifyIntent(message);
  const handoff = detectHandoff(message);

  yield { event: 'meta', data: { conversationId, mock, locale } };

  // Persist the user turn immediately so analytics see it even if the model
  // fails mid-stream.
  addMessage(db, {
    id: newId(),
    conversationId,
    role: 'user',
    content: message,
    intent: intentResult.intent,
  });
  touchConversation(db, conversationId, {
    topIntent: pickTopIntent(history, intentResult.intent),
    ...(handoff.needed ? { needsHuman: true } : {}),
  });

  if (handoff.needed && handoff.reason) {
    yield { event: 'handoff', data: { needed: true, reason: handoff.reason } };
  }

  // Safety gate: refuse before calling the model.
  const safety = checkRequestSafety(message);
  if (!safety.allowed && safety.refusal) {
    const refusal = safety.refusal[locale];
    yield { event: 'delta', data: { text: refusal } };
    addMessage(db, {
      id: newId(),
      conversationId,
      role: 'assistant',
      content: refusal,
      intent: intentResult.intent,
    });
    yield { event: 'done', data: { conversationId } };
    return;
  }

  const retrieved = retrieve(db, message);

  if (retrieved.products.length > 0) {
    yield {
      event: 'products',
      data: { items: retrieved.products.map(({ item }) => toWidgetProduct(item)) },
    };
  }

  const systemPrompt = buildSystemPrompt(locale, retrieved.knowledge, retrieved.products);
  const llmMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...conversationHistory(history),
    { role: 'user' as const, content: message },
  ];

  const contextTexts = [
    ...retrieved.knowledge.flatMap(({ item }) => [item.title, item.content]),
    ...retrieved.products.flatMap(({ item }) => [
      item.name,
      item.description,
      item.sellingPoints,
      `价格 ¥${item.price.toFixed(2)}`,
    ]),
  ];
  const allowedPrices = collectAllowedPrices(
    contextTexts,
    retrieved.products.map(({ item }) => item.price),
  );

  let answer = '';
  try {
    for await (const chunk of provider.stream({
      messages: llmMessages,
      temperature: 0.3,
      maxTokens: 800,
      signal: input.signal,
    })) {
      if (!chunk) continue;
      answer += chunk;
      yield { event: 'delta', data: { text: chunk } };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    yield { event: 'error', data: { message: detail } };
    return;
  }

  // Post-check: append a correction notice when the model quoted prices that
  // are absent from the retrieved context.
  const guarded = applyPriceGuard(answer, allowedPrices, locale);
  if (guarded.flagged) {
    const notice = guarded.text.slice(answer.length);
    yield { event: 'delta', data: { text: notice } };
    answer = guarded.text;
  }

  addMessage(db, {
    id: newId(),
    conversationId,
    role: 'assistant',
    content: answer,
    intent: intentResult.intent,
  });

  yield { event: 'done', data: { conversationId } };
}

/**
 * Keeps the first substantive intent a conversation had, so a later "hello"
 * doesn't erase "after_sale" in analytics; handoff intents always win.
 */
function pickTopIntent(history: Message[], current: Intent): Intent {
  const previous = [...history]
    .reverse()
    .find((message) => message.role === 'user' && message.intent);
  if (current === 'handoff' || previous?.intent === 'handoff') return 'handoff';
  if (current === 'other' && previous?.intent) return previous.intent as Intent;
  return current;
}
