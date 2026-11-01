import { describe, expect, it } from 'vitest';
import { SseParser, parseChatCompletionChunk } from '@/lib/llm/sse';

describe('SseParser', () => {
  it('parses events split across chunks', () => {
    const parser = new SseParser();
    expect(parser.feed('data: {"a"')).toEqual([]);
    const events = parser.feed(':1}\n\ndata: [DONE]\n\n');
    expect(events).toEqual([
      { event: undefined, data: '{"a":1}' },
      { event: undefined, data: '[DONE]' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const parser = new SseParser();
    const events = parser.feed('event: delta\r\ndata: hello\r\n\r\n');
    expect(events).toEqual([{ event: 'delta', data: 'hello' }]);
  });

  it('joins multi-line data fields and ignores comments', () => {
    const parser = new SseParser();
    const events = parser.feed(': keep-alive\ndata: line1\ndata: line2\n\n');
    expect(events).toEqual([{ event: undefined, data: 'line1\nline2' }]);
  });

  it('flushes a trailing event without a blank line', () => {
    const parser = new SseParser();
    expect(parser.feed('data: tail')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: undefined, data: 'tail' }]);
  });
});

describe('parseChatCompletionChunk', () => {
  it('extracts content deltas', () => {
    const data = JSON.stringify({
      choices: [{ delta: { content: '你好' }, finish_reason: null }],
    });
    expect(parseChatCompletionChunk(data)).toEqual({ content: '你好', done: false });
  });

  it('ignores reasoning_content-only deltas', () => {
    const data = JSON.stringify({
      choices: [{ delta: { reasoning_content: 'thinking hard...' } }],
    });
    expect(parseChatCompletionChunk(data)).toEqual({ content: '', done: false });
  });

  it('emits content even when reasoning is present alongside it', () => {
    const data = JSON.stringify({
      choices: [{ delta: { reasoning_content: 'hm', content: '答' } }],
    });
    expect(parseChatCompletionChunk(data).content).toBe('答');
  });

  it('reports done for [DONE] and finish_reason stop', () => {
    expect(parseChatCompletionChunk('[DONE]')).toEqual({ content: '', done: true });
    expect(
      parseChatCompletionChunk(JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })),
    ).toEqual({ content: '', done: true });
  });

  it('tolerates empty payloads and non-JSON data', () => {
    expect(parseChatCompletionChunk('')).toEqual({ content: '', done: false });
    expect(parseChatCompletionChunk('not json')).toEqual({ content: '', done: false });
    expect(parseChatCompletionChunk(JSON.stringify({ choices: [] }))).toEqual({
      content: '',
      done: false,
    });
    expect(parseChatCompletionChunk(JSON.stringify({ choices: [{ delta: { content: 42 } }] })))
      .toEqual({ content: '', done: false });
  });

  it('throws on an error payload', () => {
    expect(() =>
      parseChatCompletionChunk(JSON.stringify({ error: { message: 'bad key' } })),
    ).toThrow('bad key');
  });
});
