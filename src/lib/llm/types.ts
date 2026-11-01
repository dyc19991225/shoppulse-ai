export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** 0–2, provider default when omitted. */
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Ask the provider for JSON output when supported. */
  json?: boolean;
}

/**
 * Provider contract. `stream` yields content deltas only (reasoning content is
 * discarded); `complete` aggregates a whole answer.
 */
export interface LlmProvider {
  readonly kind: 'openai' | 'mock';
  readonly model: string;
  stream(request: ChatRequest): AsyncGenerator<string, void, unknown>;
  complete(request: CompletionRequest): Promise<string>;
}

export class LlmError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'LlmError';
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms`, { retryable: true });
    this.name = 'LlmTimeoutError';
  }
}
