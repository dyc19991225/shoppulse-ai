/**
 * Minimal SSE parser for OpenAI-compatible chat completion streams.
 *
 * Handles chunk boundaries split mid-event, multi-line `data:` fields, CRLF,
 * comment lines, and the `[DONE]` sentinel. Only `choices[].delta.content` is
 * surfaced; `reasoning_content` / `reasoning` deltas from reasoning models are
 * intentionally ignored.
 */

export interface SseEvent {
  event?: string;
  data: string;
}

/** Incremental text-event parser. Feed decoded chunks, get complete events. */
export class SseParser {
  private buffer = '';

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    // Normalize CRLF/CR to LF for splitting; events terminate on blank line.
    while (true) {
      const match = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer);
      if (!match) break;
      const raw = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const parsed = parseEventBlock(raw);
      if (parsed) events.push(parsed);
    }

    return events;
  }

  /** Flushes a trailing event that was not followed by a blank line. */
  flush(): SseEvent[] {
    const raw = this.buffer;
    this.buffer = '';
    const parsed = raw.trim() ? parseEventBlock(raw) : null;
    return parsed ? [parsed] : [];
  }
}

function parseEventBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0 && !event) return null;
  return { event, data: dataLines.join('\n') };
}

export interface StreamDeltaResult {
  /** Text content to emit to the caller. */
  content: string;
  done: boolean;
}

/**
 * Converts a single SSE data payload into content/done. Returns empty content
 * for keep-alives, usage-only frames, and reasoning-model deltas.
 */
export function parseChatCompletionChunk(data: string): StreamDeltaResult {
  const trimmed = data.trim();
  if (!trimmed) return { content: '', done: false };
  if (trimmed === '[DONE]') return { content: '', done: true };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { content: '', done: false };
  }

  if (!json || typeof json !== 'object') return { content: '', done: false };
  const payload = json as {
    choices?: Array<{
      delta?: { content?: unknown; reasoning_content?: unknown };
      text?: unknown;
      finish_reason?: unknown;
    }>;
    error?: { message?: unknown };
  };

  if (payload.error) {
    const message =
      typeof payload.error.message === 'string' ? payload.error.message : 'LLM stream error';
    throw new LlmStreamError(message);
  }

  const choice = payload.choices?.[0];
  if (!choice) return { content: '', done: false };

  // Some gateways send `text` (legacy completions format); support it too.
  const delta = choice.delta?.content ?? choice.text;
  const content = typeof delta === 'string' ? delta : '';
  return { content, done: choice.finish_reason === 'stop' };
}

export class LlmStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmStreamError';
  }
}
