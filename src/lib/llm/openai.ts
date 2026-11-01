import {
  LlmError,
  LlmTimeoutError,
  type ChatRequest,
  type CompletionRequest,
  type LlmProvider,
} from './types';
import { LlmStreamError, SseParser, parseChatCompletionChunk } from './sse';

export interface OpenAiProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Retries for transient failures. Default 1. */
  maxRetries?: number;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * OpenAI-compatible chat completion client.
 * - Streaming SSE, content deltas only (reasoning deltas discarded).
 * - Per-request timeout that also covers body streaming.
 * - One retry for transient HTTP errors / network failures.
 * - Never puts the API key into errors or logs.
 */
export class OpenAiProvider implements LlmProvider {
  readonly kind = 'openai' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(options: OpenAiProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = Math.max(0, options.maxRetries ?? 1);
  }

  private buildBody(
    messages: ChatRequest['messages'],
    options: { stream: boolean; temperature?: number; maxTokens?: number; json?: boolean },
  ): Record<string, unknown> {
    const body: Record<string, unknown> = { model: this.model, messages, stream: options.stream };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.json) body.response_format = { type: 'json_object' };
    return body;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** Combines caller abort with a timeout abort; cleans up the timer. */
  private withTimeout(signal?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
    didTimeout: () => boolean;
  } {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    timer.unref?.();

    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      cleanup: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      },
    };
  }

  /**
   * POSTs to /chat/completions, retrying transient failures. Aborts propagate
   * untouched so the caller can distinguish timeouts from caller cancellation.
   */
  private async fetchWithRetry(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        });

        if (response.ok) return response;

        const detail = (await safeBodyText(response)).slice(0, 500);
        const error = new LlmError(
          `LLM request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
          { status: response.status, retryable: RETRYABLE_STATUS.has(response.status) },
        );
        if (error.retryable && attempt < this.maxRetries) {
          attempt += 1;
          await backoff(attempt);
          continue;
        }
        throw error;
      } catch (error) {
        if (error instanceof LlmError) throw error;
        if (isAbort(error)) throw error;
        const networkError = new LlmError(
          `LLM network error: ${error instanceof Error ? error.message : String(error)}`,
          { retryable: true, cause: error },
        );
        if (attempt < this.maxRetries) {
          attempt += 1;
          await backoff(attempt);
          continue;
        }
        throw networkError;
      }
    }
  }

  private translateAbort(error: unknown, didTimeout: boolean): LlmError | null {
    if (!isAbort(error)) return null;
    return didTimeout
      ? new LlmTimeoutError(this.timeoutMs)
      : new LlmError('LLM request aborted', { cause: error });
  }

  async *stream(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    const body = this.buildBody(request.messages, {
      stream: true,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });

    const timeout = this.withTimeout(request.signal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetchWithRetry(body, timeout.signal);
      if (!response.body) throw new LlmError('LLM response has no body');

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      const queue: string[] = [];

      const consume = (events: ReturnType<SseParser['feed']>): boolean => {
        for (const event of events) {
          const result = parseChatCompletionChunk(event.data);
          if (result.content) queue.push(result.content);
          if (result.done) return true;
        }
        return false;
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const finished = consume(parser.feed(decoder.decode(value, { stream: true })));
        while (queue.length) yield queue.shift()!;
        if (finished) return;
      }

      consume(parser.feed(decoder.decode()));
      const finished = consume(parser.flush());
      while (queue.length) yield queue.shift()!;
      if (finished) return;
    } catch (error) {
      if (error instanceof LlmStreamError) throw new LlmError(error.message);
      if (error instanceof LlmError) throw error;
      const translated = this.translateAbort(error, timeout.didTimeout());
      if (translated) throw translated;
      throw new LlmError(
        `LLM stream error: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      timeout.cleanup();
      try {
        await reader?.cancel();
      } catch {
        // ignore
      }
    }
  }

  async complete(request: CompletionRequest): Promise<string> {
    const body = this.buildBody(request.messages, {
      stream: false,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      json: request.json,
    });

    const timeout = this.withTimeout(request.signal);
    let text: string;
    try {
      const response = await this.fetchWithRetry(body, timeout.signal);
      text = await response.text();
    } catch (error) {
      if (error instanceof LlmError) throw error;
      const translated = this.translateAbort(error, timeout.didTimeout());
      if (translated) throw translated;
      throw new LlmError('Failed to read LLM response', { cause: error });
    } finally {
      timeout.cleanup();
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError('LLM returned invalid JSON');
    }

    const content = extractCompletionContent(json);
    if (content === null) throw new LlmError('LLM response missing message content');
    return content;
  }
}

function extractCompletionContent(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const payload = json as {
    choices?: Array<{ message?: { content?: unknown } }>;
    error?: { message?: unknown };
  };
  if (payload.error) {
    const message =
      typeof payload.error.message === 'string' ? payload.error.message : 'LLM error';
    throw new LlmError(message);
  }
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

async function safeBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}

function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** (attempt - 1), 1000)));
}
