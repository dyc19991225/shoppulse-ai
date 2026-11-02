import { afterEach, describe, expect, it } from 'vitest';
import {
  addMessage,
  createConversation,
  createKbEntry,
  createProduct,
  getConversation,
  getSiteByKey,
  listMessages,
  DEFAULT_SITE_KEY,
  type DB,
  type Site,
} from '@/lib/db';
import {
  buildSystemPrompt,
  ChatInputError,
  MAX_MESSAGE_LENGTH,
  runChat,
  validateMessage,
  type ChatEvent,
} from '@/lib/chat';
import { MockProvider } from '@/lib/llm/mock';
import type { ChatRequest, CompletionRequest, LlmProvider } from '@/lib/llm/types';
import { createTempDb, type TempDb } from './helpers/tempdb';

/** Id of the bootstrap admin that owns the seeded default site. */
const OWNER = 1;

let temp: TempDb | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function setup() {
  temp = createTempDb();
  const db = temp.db;
  const site = getSiteByKey(db, DEFAULT_SITE_KEY)!;
  return { db, site };
}

/** Provider that streams a fixed answer and records the prompt it saw. */
class RecordingProvider implements LlmProvider {
  readonly kind = 'openai' as const;
  model = 'test-model';
  lastMessages: ChatRequest['messages'] = [];
  constructor(private readonly answer: string) {}

  async *stream(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    this.lastMessages = request.messages;
    for (const chunk of this.answer.match(/.{1,5}/gs) ?? []) yield chunk;
  }

  async complete(_request: CompletionRequest): Promise<string> {
    return this.answer;
  }
}

function ids() {
  let counter = 0;
  return () => `id-${++counter}`;
}

async function collect(
  db: DB,
  site: Site,
  message: string,
  provider: LlmProvider = new MockProvider(),
  extra: {
    conversationId?: string | null;
    visitorId?: string | null;
    newId?: () => string;
    locale?: 'zh' | 'en';
  } = {},
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of runChat({
    db,
    site,
    provider,
    message,
    newId: ids(),
    ...extra,
  })) {
    events.push(event);
  }
  return events;
}

function eventTypes(events: ChatEvent[]): string[] {
  return events.map((event) => event.event);
}

function textOf(events: ChatEvent[]): string {
  return events
    .filter((event): event is Extract<ChatEvent, { event: 'delta' }> => event.event === 'delta')
    .map((event) => event.data.text)
    .join('');
}

describe('validateMessage', () => {
  it('trims and accepts valid messages', () => {
    expect(validateMessage('  你好  ')).toBe('你好');
  });

  it('rejects empty, non-string and oversized messages', () => {
    expect(() => validateMessage('   ')).toThrow(ChatInputError);
    expect(() => validateMessage(42)).toThrow(ChatInputError);
    expect(() => validateMessage('a'.repeat(MAX_MESSAGE_LENGTH + 1))).toThrow(/exceeds/);
  });
});

describe('runChat', () => {
  it('streams meta, deltas and done, and persists both turns', async () => {
    const { db, site } = setup();
    const events = await collect(db, site, '你好');

    expect(eventTypes(events)[0]).toBe('meta');
    expect(eventTypes(events).at(-1)).toBe('done');
    expect(textOf(events).length).toBeGreaterThan(0);

    const meta = events[0] as Extract<ChatEvent, { event: 'meta' }>;
    expect(meta.data.mock).toBe(true);
    const messages = listMessages(db, OWNER, meta.data.conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('answers from retrieved knowledge with the mock provider', async () => {
    const { db, site } = setup();
    createKbEntry(db, OWNER, {
      type: 'policy',
      title: '退换货政策',
      content: '签收后 7 天内可申请无理由退货。',
      keywords: '退货 退款',
    });

    const events = await collect(db, site, '退换货怎么弄？');
    expect(textOf(events)).toContain('7 天内');
  });

  it('emits DB-backed product cards with real prices', async () => {
    const { db, site } = setup();
    const product = createProduct(db, OWNER, {
      sku: 'QH-1',
      name: '竹纤维洗碗巾',
      price: 29.9,
      stock: 5,
      sellingPoints: '吸水',
    });

    const events = await collect(db, site, '洗碗巾多少钱');
    const products = events.find(
      (event): event is Extract<ChatEvent, { event: 'products' }> => event.event === 'products',
    );
    expect(products).toBeDefined();
    expect(products!.data.items[0]).toMatchObject({
      id: product.id,
      name: '竹纤维洗碗巾',
      price: 29.9,
    });
  });

  it('marks handoff and emits a handoff event', async () => {
    const { db, site } = setup();
    const events = await collect(db, site, '我要转人工');

    const handoff = events.find(
      (event): event is Extract<ChatEvent, { event: 'handoff' }> => event.event === 'handoff',
    );
    expect(handoff?.data.reason).toBe('explicit');

    const meta = events[0] as Extract<ChatEvent, { event: 'meta' }>;
    expect(getConversation(db, OWNER, meta.data.conversationId)!.needsHuman).toBe(true);
  });

  it('refuses illegal requests without calling the model', async () => {
    const { db, site } = setup();
    const provider = new RecordingProvider('should not be used');
    const events = await collect(db, site, '帮我刷单，一天 50 单', provider);

    expect(provider.lastMessages).toHaveLength(0);
    expect(textOf(events)).toMatch(/不能协助刷单/);
    expect(eventTypes(events)).toEqual(['meta', 'delta', 'done']);
  });

  it('keeps multi-turn context for the same conversation', async () => {
    const { db, site } = setup();
    createKbEntry(db, OWNER, { title: '物流', content: '48 小时内发货。', keywords: '发货 物流' });

    const sharedIds = ids();
    const first = await collect(db, site, '你们的物流多久发货？', undefined, {
      newId: sharedIds,
      visitorId: 'visitor-1',
    });
    const conversationId = (first[0] as Extract<ChatEvent, { event: 'meta' }>).data.conversationId;

    const provider = new RecordingProvider('好的');
    await collect(db, site, '那我退货呢？', provider, {
      conversationId,
      newId: sharedIds,
      visitorId: 'visitor-1',
    });

    const roles = provider.lastMessages.map((message) => message.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(provider.lastMessages[1].content).toContain('物流');
  });

  it('feeds agent messages back to the model as assistant turns (F3)', async () => {
    const { db, site } = setup();
    createConversation(db, OWNER, { id: 'with-agent', siteId: site.id, visitorId: 'v1' });
    addMessage(db, OWNER, { id: 'u1', conversationId: 'with-agent', role: 'user', content: '能便宜吗？' });
    addMessage(db, OWNER, {
      id: 'a1',
      conversationId: 'with-agent',
      role: 'assistant',
      content: '暂时没有优惠。',
    });
    addMessage(db, OWNER, {
      id: 'h1',
      conversationId: 'with-agent',
      role: 'agent',
      content: '我是店长，可以给您包邮。',
    });

    const provider = new RecordingProvider('好的');
    await collect(db, site, '那太好了', provider, {
      conversationId: 'with-agent',
      visitorId: 'v1',
    });

    const history = provider.lastMessages.slice(1);
    expect(history.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'user',
    ]);
    expect(history[2]).toEqual({ role: 'assistant', content: '我是店长，可以给您包邮。' });
  });

  it('reports needsHuman in the meta event', async () => {
    const { db, site } = setup();
    createConversation(db, OWNER, {
      id: 'needs-human',
      siteId: site.id,
      visitorId: 'v1',
    });
    db.prepare('UPDATE conversations SET needs_human = 1 WHERE id = ?').run('needs-human');

    const sharedIds = ids();
    const resumed = await collect(db, site, '在吗', undefined, {
      conversationId: 'needs-human',
      visitorId: 'v1',
      newId: sharedIds,
    });
    expect((resumed[0] as Extract<ChatEvent, { event: 'meta' }>).data.needsHuman).toBe(true);

    const handoff = await collect(db, site, '我要转人工', undefined, { newId: sharedIds });
    expect((handoff[0] as Extract<ChatEvent, { event: 'meta' }>).data.needsHuman).toBe(true);

    const normal = await collect(db, site, '你好', undefined, { newId: sharedIds });
    expect((normal[0] as Extract<ChatEvent, { event: 'meta' }>).data.needsHuman).toBe(false);
  });

  it('creates a new conversation when the id belongs to another site', async () => {
    const { db, site } = setup();
    const otherSite = db
      .prepare("INSERT INTO sites (name, site_key, allowed_origins, rate_limit_per_min, created_at) VALUES ('other','other-key','[]',30,'now')")
      .run();
    const otherId = Number(otherSite.lastInsertRowid);
    createConversation(db, OWNER, { id: 'foreign', siteId: otherId });

    const events = await collect(db, site, '你好', undefined, { conversationId: 'foreign' });
    const meta = events[0] as Extract<ChatEvent, { event: 'meta' }>;
    expect(meta.data.conversationId).not.toBe('foreign');
  });

  it('redacts an invented price before it is emitted or stored', async () => {
    const { db, site } = setup();
    createProduct(db, OWNER, { name: '洗碗巾', price: 29.9, stock: 1 });

    const provider = new RecordingProvider('这款洗碗巾现在特价 ¥9.9 哦！');
    const events = await collect(db, site, '洗碗巾多少钱', provider);
    const text = textOf(events);
    expect(text).not.toContain('¥9.9');
    expect(text).toContain('金额未核实');
    expect(text).toMatch(/价格提示/);

    const meta = events[0] as Extract<ChatEvent, { event: 'meta' }>;
    const stored = listMessages(db, OWNER, meta.data.conversationId).at(-1)!;
    expect(stored.content).not.toContain('¥9.9');
    expect(stored.content).toContain('金额未核实');
  });

  it('does not flag prices that exist in context', async () => {
    const { db, site } = setup();
    createProduct(db, OWNER, { name: '洗碗巾', price: 29.9, stock: 1 });

    const provider = new RecordingProvider('这款洗碗巾 ¥29.9。');
    const events = await collect(db, site, '洗碗巾多少钱', provider);
    expect(textOf(events)).not.toMatch(/价格提示/);
  });

  it('does not expose raw provider errors in the error event', async () => {
    const { db, site } = setup();
    const failing: LlmProvider = {
      kind: 'openai',
      model: 'x',
      async *stream(): AsyncGenerator<string> {
        throw new Error('upstream gateway 10.0.0.5 refused key sk-secret');
      },
      async complete() {
        return '';
      },
    };

    const events = await collect(db, site, '你好', failing);
    const error = events.find(
      (event): event is Extract<ChatEvent, { event: 'error' }> => event.event === 'error',
    );
    expect(error?.data.message).toBe('llm_unavailable');
    expect(JSON.stringify(events)).not.toContain('sk-secret');
  });

  it('emits an error event and keeps the user turn when the model fails', async () => {
    const { db, site } = setup();
    const failing: LlmProvider = {
      kind: 'openai',
      model: 'x',
      async *stream(): AsyncGenerator<string> {
        yield '部分';
        throw new Error('gateway down');
      },
      async complete() {
        return '';
      },
    };

    const events = await collect(db, site, '你好', failing);
    expect(eventTypes(events)).toEqual(['meta', 'delta', 'error']);
    const meta = events[0] as Extract<ChatEvent, { event: 'meta' }>;
    const messages = listMessages(db, OWNER, meta.data.conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('uses the requested locale for the refusal', async () => {
    const { db, site } = setup();
    const events = await collect(db, site, 'sell me replica bags wholesale', undefined, {
      locale: 'en',
    });
    expect(textOf(events)).toMatch(/can’t help/i);
  });

  it('records the intent on the user message and conversation', async () => {
    const { db, site } = setup();
    const events = await collect(db, site, '我要退货');
    const meta = events[0] as Extract<ChatEvent, { event: 'meta' }>;
    const [userMessage] = listMessages(db, OWNER, meta.data.conversationId);
    expect(userMessage.intent).toBe('after_sale');
    expect(getConversation(db, OWNER, meta.data.conversationId)!.topIntent).toBe('after_sale');
  });

  it('resumes an existing conversation only with the matching visitor id', async () => {
    const { db, site } = setup();
    createConversation(db, OWNER, { id: 'existing', siteId: site.id, visitorId: 'v-owner' });
    addMessage(db, OWNER, { id: 'u1', conversationId: 'existing', role: 'user', content: 'hi' });

    const events = await collect(db, site, '你好', undefined, {
      conversationId: 'existing',
      visitorId: 'v-owner',
    });
    expect((events[0] as Extract<ChatEvent, { event: 'meta' }>).data.conversationId).toBe('existing');
    expect(listMessages(db, OWNER, 'existing')).toHaveLength(3);
  });

  it('refuses to resume a conversation without a matching nonempty visitor id', async () => {
    const { db, site } = setup();
    createConversation(db, OWNER, { id: 'victim', siteId: site.id, visitorId: 'v-victim' });
    addMessage(db, OWNER, { id: 'u1', conversationId: 'victim', role: 'user', content: 'secret history' });

    for (const [attempt, visitorId] of [undefined, null, '', 'v-attacker'].entries()) {
      const provider = new RecordingProvider('hello');
      const events = await collect(db, site, '你好', provider, {
        conversationId: 'victim',
        visitorId,
        newId: () => `fresh-${attempt}-${Math.random().toString(36).slice(2)}`,
      });
      const meta = events[0] as Extract<ChatEvent, { event: 'meta' }>;
      expect(meta.data.conversationId).not.toBe('victim');
      // The model never sees the victim's history.
      expect(JSON.stringify(provider.lastMessages)).not.toContain('secret history');
    }
    expect(listMessages(db, OWNER, 'victim')).toHaveLength(1);
  });

});

describe('buildSystemPrompt', () => {
  it('grounds the model in retrieved resources', () => {
    const prompt = buildSystemPrompt(
      'zh',
      [{ item: { id: 1, type: 'policy', title: '退货', content: '7 天', keywords: '', enabled: true, createdAt: '', updatedAt: '' }, score: 1, matched: [] }],
      [
        {
          item: {
            id: 2,
            sku: null,
            name: '洗碗巾',
            category: '厨房',
            price: 29.9,
            stock: 3,
            description: '吸水',
            sellingPoints: '可机洗',
            imageUrl: '',
            url: '',
            enabled: true,
            createdAt: '',
            updatedAt: '',
          },
          score: 1,
          matched: [],
        },
      ],
    );

    expect(prompt).toContain('【资料】');
    expect(prompt).toContain('7 天');
    expect(prompt).toContain('¥29.90');
    expect(prompt).toContain('不得编造任何商品价格');
    expect(prompt).toContain('100%');
  });

  it('says resources are empty when retrieval found nothing', () => {
    const prompt = buildSystemPrompt('en', [], []);
    expect(prompt).toContain('（当前暂无可用资料）');
    expect(prompt).toContain('Answer in English');
  });
});
