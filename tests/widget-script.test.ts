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

interface Harness {
  dom: JSDOM;
  window: any;
  fetchCalls: { url: string; init: RequestInit }[];
  respond: (body: ReadableStream<Uint8Array> | string, init?: ResponseInit) => void;
  send: (text: string) => Promise<void>;
  shadow: ShadowRoot;
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

function setup(options: { locale?: string; noLocaleAttr?: boolean } = {}): Harness {
  const locale = options.locale ?? 'zh';
  const dom = openDom();
  active = dom;
  const window = dom.window;
  const { document } = window;

  // jsdom lacks fetch; wire the Node implementations into the window.
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  let respond: Harness['respond'] = () => {};
  window.fetch = (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    return new Promise((resolve) => {
      respond = (body, responseInit) => {
        const responseBody =
          typeof body === 'string'
            ? body
            : body;
        resolve(new Response(responseBody as BodyInit, { status: 200, ...responseInit }));
      };
    });
  };
  window.Response = Response;
  window.ReadableStream = ReadableStream;
  window.TextDecoder = TextDecoder;
  window.AbortController = AbortController;

  const script = document.createElement('script');
  script.setAttribute('data-site-key', 'test-site-key');
  if (!options.noLocaleAttr) script.setAttribute('data-locale', locale);
  script.textContent = WIDGET_SOURCE;
  document.body.appendChild(script);

  const host = document.querySelector('[data-shoppulse-widget]') as HTMLElement;
  if (!host) throw new Error('widget host not created');
  const shadow = host.shadowRoot!;

  async function send(text: string): Promise<void> {
    const textarea = shadow.querySelector('.composer textarea') as HTMLTextAreaElement;
    const form = shadow.querySelector('.composer') as HTMLFormElement;
    textarea.value = text;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    // Let the fetch promise chain settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    dom,
    window,
    fetchCalls,
    respond: (body, responseInit) => respond(body, responseInit),
    send,
    shadow,
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

    expect(shadow.querySelector('.msg.notice')!.textContent).toContain('转接人工客服');
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
});
