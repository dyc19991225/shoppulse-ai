import type { ChatRequest, CompletionRequest, LlmProvider } from './types';

export interface MockProviderOptions {
  model?: string;
  /** Artificial delay between chunks, in ms. Defaults to 0 (tests stay fast). */
  delayMs?: number;
  /** Approximate characters per streamed chunk. */
  chunkSize?: number;
}

/**
 * Deterministic offline provider used when no API key is configured.
 * Answers are templated from the last user message and any 【资料】 block in the
 * system prompt, so the UI can be demonstrated without a model.
 */
export class MockProvider implements LlmProvider {
  readonly kind = 'mock' as const;
  readonly model: string;
  private readonly delayMs: number;
  private readonly chunkSize: number;

  constructor(options: MockProviderOptions = {}) {
    this.model = options.model ?? 'mock';
    this.delayMs = Math.max(0, options.delayMs ?? 0);
    this.chunkSize = Math.max(1, options.chunkSize ?? 6);
  }

  async *stream(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    const answer = buildMockAnswer(request.messages);
    for (let i = 0; i < answer.length; i += this.chunkSize) {
      if (this.delayMs > 0) await sleep(this.delayMs);
      yield answer.slice(i, i + this.chunkSize);
    }
  }

  async complete(request: CompletionRequest): Promise<string> {
    if (request.json) {
      return JSON.stringify({
        mock: true,
        platform: 'generic',
        content: buildMockAnswer(request.messages),
      });
    }
    return buildMockAnswer(request.messages);
  }
}

export function buildMockAnswer(messages: ChatRequest['messages']): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const question = lastUser?.content.trim() ?? '';
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');

  const resources = extractResources(system);
  const preview = question.length > 40 ? `${question.slice(0, 40)}…` : question;

  if (resources.length === 0) {
    return question
      ? `（演示模式）您问的是“${preview}”。目前知识库中暂无相关资料，建议点击“转人工”由客服为您确认。`
      : '（演示模式）您好，我是智能客服助手。请问有什么可以帮您？';
  }

  const first = resources[0];
  const extra = resources.length > 1 ? `另外还可参考：${resources[1]}` : '';
  return [
    `（演示模式）关于“${preview}”，根据店铺资料：${first}`,
    extra,
    '如需更多帮助，可以回复“人工”转接客服。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Pulls plain-text lines out of a prompt's 【资料】 section. Uses the last
 * marker, because instruction text may also mention "【资料】" inline.
 */
function extractResources(system: string): string[] {
  const marker = system.lastIndexOf('【资料】');
  if (marker === -1) return [];
  const section = system.slice(marker + '【资料】'.length);
  const end = section.indexOf('【资料结束】');
  const endFallback = section.indexOf('\n【');
  const cutoff = end !== -1 ? end : endFallback;
  const body = cutoff === -1 ? section : section.slice(0, cutoff);
  return body
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
