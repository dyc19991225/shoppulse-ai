import { describe, expect, it, vi } from 'vitest';
import { OpenAiProvider } from '@/lib/llm/openai';
import { LlmError, LlmTimeoutError } from '@/lib/llm/types';

function sse(...chunks: string[]): string {
  return chunks.join('');
}

function streamResponse(body: string, init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        // Deliberately split the body to exercise chunk-boundary handling.
        const midpoint = Math.floor(body.length / 2);
        controller.enqueue(encoder.encode(body.slice(0, midpoint)));
        controller.enqueue(encoder.encode(body.slice(midpoint)));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeProvider(fetchImpl: typeof fetch, overrides: Partial<{ timeoutMs: number; maxRetries: number }> = {}) {
  return new OpenAiProvider({
    baseUrl: 'http://gateway.test/v1/',
    apiKey: 'secret-test-key',
    model: 'test-model',
    timeoutMs: overrides.timeoutMs ?? 5000,
    maxRetries: overrides.maxRetries ?? 1,
    fetchImpl,
  });
}

async function collect(iter: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

describe('OpenAiProvider.stream', () => {
  it('streams content deltas and ignores reasoning_content', async () => {
    const body = sse(
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    );
    const fetchImpl = vi.fn(async () => streamResponse(body));

    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const chunks = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));

    expect(chunks).toEqual(['你', '好']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gateway.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-test-key');
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({ model: 'test-model', stream: true });
  });

  it('sends temperature and max_tokens when provided', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse('data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n'),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await collect(
      provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
        maxTokens: 128,
      }),
    );
    const payload = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(payload.temperature).toBe(0.3);
    expect(payload.max_tokens).toBe(128);
  });

  it('throws with status on non-2xx without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch, { maxRetries: 0 });

    await expect(
      collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toMatchObject({ name: 'LlmError', status: 401 });

    try {
      await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    } catch (error) {
      expect(String(error)).not.toContain('secret-test-key');
    }
  });

  it('retries once on a transient 503', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(
        streamResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
      );

    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const chunks = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks).toEqual(['ok']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'bad' }, 400));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(
      collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('times out stalled streams', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    const provider = makeProvider(fetchImpl as unknown as typeof fetch, { timeoutMs: 30 });
    await expect(
      collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it('propagates an in-stream error payload as LlmError', async () => {
    const body = 'data: {"error":{"message":"quota exceeded"}}\n\n';
    const fetchImpl = vi.fn(async () => streamResponse(body));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(
      collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] })),
    ).rejects.toThrow('quota exceeded');
  });

  it('handles a response without [DONE]', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"a"},"finish_reason":"stop"}]}\n\n';
    const fetchImpl = vi.fn(async () => streamResponse(body));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    expect(await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))).toEqual(['a']);
  });
});

describe('OpenAiProvider.complete', () => {
  it('returns message content', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '完整回答' } }] }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).resolves.toBe('完整回答');

    const payload = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(payload.stream).toBe(false);
    expect(payload.response_format).toBeUndefined();
  });

  it('requests JSON mode when asked', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '{"a":1}' } }] }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await provider.complete({ messages: [{ role: 'user', content: 'hi' }], json: true });
    const payload = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(payload.response_format).toEqual({ type: 'json_object' });
  });

  it('fails on invalid JSON or missing content', async () => {
    const invalid = makeProvider(
      vi.fn(async () => new Response('oops', { status: 200 })) as unknown as typeof fetch,
    );
    await expect(
      invalid.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/invalid JSON/);

    const empty = makeProvider(
      vi.fn(async () => jsonResponse({ choices: [{ message: {} }] })) as unknown as typeof fetch,
    );
    await expect(
      empty.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/missing message content/);
  });

  it('surfaces provider error payloads', async () => {
    const provider = makeProvider(
      vi.fn(async () => jsonResponse({ error: { message: 'denied' } }, 200)) as unknown as typeof fetch,
    );
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('denied');
  });
});
