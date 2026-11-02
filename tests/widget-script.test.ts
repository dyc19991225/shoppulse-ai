import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Loads public/widget.js into a jsdom document with a stubbed fetch and drives
 * the UI end to end. This exercises the real shipped file (no bundling), so
 * regressions in the vanilla JS are caught.
 */

const WIDGET_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../public/widget.js'),
  'utf8',
);

interface IntervalRecord {
  id: number;
  fn: () => void;
  delay: number;
  cleared: boolean;
}

interface Harness {
  dom: JSDOM;
  window: any;
  fetchCalls: { url: string; init: RequestInit }[];
  respond: (body: ReadableStream<Uint8Array> | string, init?: ResponseInit) => void;
  route: (match: (url: string) => boolean, handler: (url: string) => Response) => void;
  send: (text: string) => Promise<void>;
  flush: () => Promise<void>;
  shadow: ShadowRoot;
  intervals: IntervalRecord[];
  open: () => Promise<void>;
}

const openDom = () => {
  const dom = new JSDOM('<!doctype html><html><body><main id="app">Store</main></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost:3000/demo',
    pretendToBeVisual: true,
  });
  return dom;
};

let active: JSDOM | undefined;

afterEach(() => {
  if (active) {
    active.window.ShopPulseWidget?.destroy();
    active.window.close();
    active = undefined;
  }
});

function setup(
  options: {
    locale?: string;
    noLocaleAttr?: boolean;
    storage?: Record<string, string>;
  } = {},
): Harness {
  const locale = options.locale ?? 'zh';
  const dom = openDom();
  active = dom;
  const window = dom.window;
  const { document } = window;

  for (const [key, value] of Object.entries(options.storage ?? {})) {
    window.localStorage.setItem(key, value);
  }

  // jsdom lacks fetch; wire the Node implementations into the window.
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const routes: { match: (url: string) => boolean; handler: (url: string) => Response }[] = [];
  let respond: Harness['respond'] = () => {};
  window.fetch = (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    const route = routes.find((entry) => entry.match(url));
    if (route) {
      return Promise.resolve(route.handler(url));
    }
    return new Promise((resolve) => {
      respond = (body, responseInit) => {
        resolve(new Response(body as BodyInit, { status: 200, ...responseInit }));
      };
    });
  };
  window.Response = Response;
  window.ReadableStream = ReadableStream;
  window.TextDecoder = TextDecoder;
  window.AbortController = AbortController;

  // Track 5-second polling so tests can tick it without waiting.
  const intervals: IntervalRecord[] = [];
  const originalSetInterval = window.setInterval.bind(window);
  const originalClearInterval = window.clearInterval.bind(window);
  let nextIntervalId = 1;
  window.setInterval = (fn: () => void, delay: number) => {
    const record: IntervalRecord = {
      id: nextIntervalId++,
      fn: () => {
        if (!record.cleared) fn();
      },
      delay,
      cleared: false,
    };
    intervals.push(record);
    originalSetInterval(record.fn, delay);
    return record.id;
  };
  window.clearInterval = (id: number) => {
    const record = intervals.find((entry) => entry.id === id);
    if (record) record.cleared = true;
    originalClearInterval(id);
  };

  const script = document.createElement('script');
  script.setAttribute('data-site-key', 'test-site-key');
  if (!options.noLocaleAttr) script.setAttribute('data-locale', locale);
  script.textContent = WIDGET_SOURCE;
  document.body.appendChild(script);

  const host = document.querySelector('[data-shoppulse-widget]') as HTMLElement;
  if (!host) throw new Error('widget host not created');
  const shadow = host.shadowRoot!;

  async function flush(): Promise<void> {
    for (let index = 0; index < 5; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  async function send(text: string): Promise<void> {
    const textarea = shadow.querySelector('.composer textarea') as HTMLTextAreaElement;
    const form = shadow.querySelector('.composer') as HTMLFormElement;
    textarea.value = text;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  }

  async function open(): Promise<void> {
    window.ShopPulseWidget.open();
    await flush();
  }

  return {
    dom,
    window,
    fetchCalls,
    respond: (body, responseInit) => respond(body, responseInit),
    route: (match, handler) => {
      routes.push({ match, handler });
    },
    send,
    flush,
    shadow,
    intervals,
    open,
  };
}

function sseStream(events: { event: string; data: unknown }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`),
        );
      }
      controller.close();
    },
  });
}

function botText(shadow: ShadowRoot): string {
  return [...shadow.querySelectorAll('.msg.bot')].map((node) => node.textContent ?? '').join('\n');
}

describe('widget.js', () => {
  it('renders a closed launcher with the default Chinese label', () => {
    const { shadow } = setup();
    const launcher = shadow.querySelector('.launcher') as HTMLButtonElement;
    expect(launcher).not.toBeNull();
    expect(launcher.textContent).toContain('在线客服');
    expect((shadow.querySelector('.panel') as HTMLElement).hidden).toBe(true);

    launcher.dispatchEvent(new (active!.window.MouseEvent)('click', { bubbles: true }));
    expect((shadow.querySelector('.panel') as HTMLElement).hidden).toBe(false);
  });

  it('keeps product cards from collapsing in a long conversation', () => {
    // In the flex-column message list, an overflowing history shrank the
    // overflow-x:auto product row to 0px height, hiding the cards.
    expect(WIDGET_SOURCE).toMatch(/\.products\{[^}]*flex-shrink:0/);
  });

  it('closes via the header X and reopens (hidden attr is backed by the stylesheet)', () => {
    // The regression: `.launcher{display:flex}`/`.panel{display:flex}` beat the
    // UA `[hidden]{display:none}` rule, so the `hidden` attribute had no visual
    // effect. Pin it down both at the CSS level and functionally.
    expect(WIDGET_SOURCE).toMatch(/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/);

    const { shadow, window } = setup();
    const panel = shadow.querySelector('.panel') as HTMLElement;
    const launcher = shadow.querySelector('.launcher') as HTMLElement;
    const closeBtn = shadow.querySelector('.icon-btn') as HTMLButtonElement;

    // Open.
    window.ShopPulseWidget.open();
    expect(panel.hidden).toBe(false);
    expect(launcher.hidden).toBe(true);

    // Close via the header X.
    closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(launcher.hidden).toBe(false);

    // Open again.
    window.ShopPulseWidget.open();
    expect(panel.hidden).toBe(false);
    expect(launcher.hidden).toBe(true);
  });

  it('streams deltas into the transcript and saves the conversation id', async () => {
    const harness = setup();
    const { shadow, window } = harness;

    const sendPromise = harness.send('多少钱');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.fetchCalls).toHaveLength(1);
    const call = harness.fetchCalls[0];
    expect(call.url).toBe('http://localhost:3000/api/widget/chat');
    const payload = JSON.parse(String(call.init.body));
    expect(payload).toMatchObject({ siteKey: 'test-site-key', message: '多少钱', locale: 'zh' });

    harness.respond(
      sseStream([
        { event: 'meta', data: { conversationId: 'conv-abc', mock: true, locale: 'zh' } },
        { event: 'delta', data: { text: '这款' } },
        { event: 'delta', data: { text: '很好用。' } },
        { event: 'done', data: { conversationId: 'conv-abc' } },
      ]),
    );
    await sendPromise;

    expect(botText(shadow)).toContain('这款很好用。');
    expect(window.localStorage.getItem('shoppulse_conversation_id:test-site-key')).toBe('conv-abc');
    expect(window.ShopPulseWidget.getConversationId()).toBe('conv-abc');
    expect((shadow.querySelector('.badge') as HTMLElement).hidden).toBe(false);
  });

  it('renders DB product cards as text (no HTML injection)', async () => {
    const harness = setup();
    const { shadow } = harness;

    const sendPromise = harness.send('推荐商品');
    harness.respond(
      sseStream([
        { event: 'meta', data: { conversationId: 'c1', mock: false, locale: 'zh' } },
        {
          event: 'products',
          data: {
            items: [
              {
                id: 1,
                name: '<img src=x onerror=alert(1)>洗碗巾',
                price: 29.9,
                stock: 12,
                category: '厨房',
                imageUrl: '',
                url: 'https://shop.example.com/p/1',
                sellingPoints: '吸水',
              },
            ],
          },
        },
        { event: 'delta', data: { text: '推荐这款。' } },
        { event: 'done', data: { conversationId: 'c1' } },
      ]),
    );
    await sendPromise;

    const card = shadow.querySelector('.card') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.querySelector('.card-name')!.textContent).toBe('<img src=x onerror=alert(1)>洗碗巾');
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.card-price')!.textContent).toBe('¥29.90');
    expect((card.querySelector('.card-link') as HTMLAnchorElement).href).toBe(
      'https://shop.example.com/p/1',
    );
    expect(shadow.querySelector('img[src="x"]')).toBeNull();
  });

  it('shows the handoff notice', async () => {
    const harness = setup();
    const { shadow } = harness;

    const sendPromise = harness.send('我要转人工');
    harness.respond(
      sseStream([
        { event: 'meta', data: { conversationId: 'c2', mock: true, locale: 'zh' } },
        { event: 'handoff', data: { needed: true, reason: 'explicit' } },
        { event: 'delta', data: { text: '已转接。' } },
        { event: 'done', data: { conversationId: 'c2' } },
      ]),
    );
    await sendPromise;

    expect(shadow.querySelector('.msg.notice')!.textContent).toContain('转人工请求');
  });

  it('uses English strings when data-locale="en"', () => {
    const { shadow } = setup({ locale: 'en' });
    expect((shadow.querySelector('.launcher') as HTMLElement).textContent).toContain('Chat with us');
    expect((shadow.querySelector('.composer textarea') as HTMLTextAreaElement).placeholder).toBe(
      'Type your question…',
    );
  });

  it('auto-detects the browser language when data-locale is absent', () => {
    const { shadow } = setup({ noLocaleAttr: true });
    // jsdom reports en-US by default, so the widget follows it.
    expect((shadow.querySelector('.launcher') as HTMLElement).textContent).toContain(
      'Chat with us',
    );
  });

  it('shows a localized error when the request fails', async () => {
    const harness = setup();
    const { shadow } = harness;

    const sendPromise = harness.send('hello');
    harness.respond('rate limited', { status: 429, headers: { 'content-type': 'application/json' } });
    await sendPromise;

    expect(shadow.querySelector('.msg.error')!.textContent).toContain('网络异常');
  });

  it('does not send empty messages', async () => {
    const harness = setup();
    const sendPromise = harness.send('   ');
    await sendPromise;
    expect(harness.fetchCalls).toHaveLength(0);
    expect(harness.shadow.querySelector('.msg.error')!.textContent).toContain('请输入问题');
  });

  it('sends the previous conversation id and visitor id on follow-up turns', async () => {
    const harness = setup();
    const { window } = harness;

    const firstSend = harness.send('第一句');
    harness.respond(
      sseStream([
        { event: 'meta', data: { conversationId: 'conv-1', mock: true, locale: 'zh' } },
        { event: 'done', data: { conversationId: 'conv-1' } },
      ]),
    );
    await firstSend;

    const secondSend = harness.send('第二句');
    harness.respond(sseStream([{ event: 'done', data: { conversationId: 'conv-1' } }]));
    await secondSend;

    const payload = JSON.parse(String(harness.fetchCalls[1].init.body));
    expect(payload.conversationId).toBe('conv-1');
    expect(typeof payload.visitorId).toBe('string');
    expect(payload.visitorId.length).toBeGreaterThan(3);
    expect(window.localStorage.getItem('shoppulse_visitor_id')).toBe(payload.visitorId);
  });

  it('ignores malformed SSE blocks', async () => {
    const harness = setup();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: delta\ndata: not-json\n\n'));
        controller.enqueue(
          encoder.encode('event: delta\ndata: {"text":"ok"}\n\nevent: done\ndata: {}\n\n'),
        );
        controller.close();
      },
    });
    const sendPromise = harness.send('hi');
    harness.respond(stream);
    await sendPromise;
    expect(botText(harness.shadow)).toBe('ok');
  });

  it('renders the site welcome message as the first assistant bubble', async () => {
    const harness = setup();
    harness.route(
      (url) => url.includes('/api/widget/config'),
      () =>
        new Response(JSON.stringify({ welcomeMessage: '您好，欢迎咨询！' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await harness.open();
    const configCall = harness.fetchCalls.find((call) =>
      call.url.includes('/api/widget/config'),
    );
    expect(configCall?.url).toContain('site_key=test-site-key');

    const bubbles = [...harness.shadow.querySelectorAll('.messages > .msg')];
    expect(bubbles[0].className).toBe('msg bot');
    expect(bubbles[0].textContent).toBe('您好，欢迎咨询！');
    // The welcome line is UI only; it never gets stored or sent.
    expect(harness.fetchCalls.filter((call) => call.url.includes('/api/widget/chat'))).toHaveLength(
      0,
    );
    expect(harness.window.localStorage.getItem('shoppulse_conversation_id:test-site-key')).toBeNull();
  });

  it('does not render a welcome bubble when the site has none', async () => {
    const harness = setup();
    harness.route(
      (url) => url.includes('/api/widget/config'),
      () =>
        new Response(JSON.stringify({ welcomeMessage: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await harness.open();
    expect(harness.shadow.querySelectorAll('.messages > .msg')).toHaveLength(0);
  });

  it('polls for agent replies every 5 s while open, then stops on close', async () => {
    let replies: { id: string; content: string; createdAt: string }[] = [];
    const harness = setup({
      storage: {
        'shoppulse_conversation_id:test-site-key': 'conv-1',
        'shoppulse_agent_watch:test-site-key': 'conv-1',
      },
    });
    harness.route(
      (url) => url.includes('/api/widget/config'),
      () =>
        new Response(JSON.stringify({ welcomeMessage: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    harness.route(
      (url) => url.includes('/api/widget/messages'),
      () =>
        new Response(JSON.stringify({ items: replies }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await harness.open();
    const messageCalls = () =>
      harness.fetchCalls.filter((call) => call.url.includes('/api/widget/messages'));
    expect(messageCalls()).toHaveLength(1);
    const firstUrl = new URL(messageCalls()[0].url);
    expect(firstUrl.searchParams.get('site_key')).toBe('test-site-key');
    expect(firstUrl.searchParams.get('conversation_id')).toBe('conv-1');
    expect(firstUrl.searchParams.get('visitor_id')).toBeTruthy();
    expect(firstUrl.searchParams.get('after')).toBeNull();

    const pollInterval = harness.intervals.find((interval) => interval.delay === 5000);
    expect(pollInterval).toBeDefined();
    expect(harness.window.ShopPulseWidget.isPolling()).toBe(true);

    // A reply shows up on the next tick, with an `after` cursor.
    replies = [
      {
        id: 'agent-1',
        content: '人工客服：已收到您的留言。',
        createdAt: '2024-01-01T00:00:05.000Z',
      },
    ];
    pollInterval!.fn();
    await harness.flush();

    expect(messageCalls()).toHaveLength(2);
    expect(new URL(messageCalls()[1].url).searchParams.get('after')).toBeNull();
    const agentBubble = harness.shadow.querySelector('.msg.agent') as HTMLElement;
    expect(agentBubble).not.toBeNull();
    expect(agentBubble.textContent).toContain('人工客服：已收到您的留言。');

    // The same reply is not duplicated, and subsequent polls use its timestamp.
    pollInterval!.fn();
    await harness.flush();
    expect(harness.shadow.querySelectorAll('.msg.agent')).toHaveLength(1);
    expect(new URL(messageCalls()[2].url).searchParams.get('after')).toBe(
      '2024-01-01T00:00:05.000Z',
    );

    harness.window.ShopPulseWidget.close();
    expect(harness.window.ShopPulseWidget.isPolling()).toBe(false);
    const callsAfterClose = messageCalls().length;
    pollInterval!.fn();
    await harness.flush();
    expect(messageCalls()).toHaveLength(callsAfterClose);
  });

  it('does not poll without a conversation watch', async () => {
    const harness = setup({
      storage: { 'shoppulse_conversation_id:test-site-key': 'conv-1' },
    });
    harness.route(
      (url) => url.includes('/api/widget/config'),
      () =>
        new Response(JSON.stringify({ welcomeMessage: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    harness.route(
      (url) => url.includes('/api/widget/messages'),
      () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );

    await harness.open();
    expect(harness.fetchCalls.some((call) => call.url.includes('/api/widget/messages'))).toBe(
      false,
    );
    expect(harness.window.ShopPulseWidget.isPolling()).toBe(false);
  });

  it('starts watching for agent replies after a handoff', async () => {
    const harness = setup();
    harness.route(
      (url) => url.includes('/api/widget/config'),
      () =>
        new Response(JSON.stringify({ welcomeMessage: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    let messagesCalls = 0;
    harness.route(
      (url) => url.includes('/api/widget/messages'),
      () => {
        messagesCalls += 1;
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    );

    await harness.open();
    expect(messagesCalls).toBe(0);

    const sendPromise = harness.send('我要转人工');
    harness.respond(
      sseStream([
        { event: 'meta', data: { conversationId: 'conv-2', mock: true, locale: 'zh', needsHuman: true } },
        { event: 'handoff', data: { needed: true, reason: 'explicit' } },
        { event: 'delta', data: { text: '已记录。' } },
        { event: 'done', data: { conversationId: 'conv-2' } },
      ]),
    );
    await sendPromise;
    await harness.flush();

    expect(harness.window.ShopPulseWidget.isPolling()).toBe(true);
    expect(messagesCalls).toBeGreaterThanOrEqual(1);
    const call = harness.fetchCalls.find((entry) => entry.url.includes('/api/widget/messages'));
    expect(new URL(call!.url).searchParams.get('conversation_id')).toBe('conv-2');
  });
});
