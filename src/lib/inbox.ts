import type { Message } from './db';

/**
 * F3 inbox rules: agent replies and conversation tags/note.
 *
 * Validation lives here (not in the route) so the API and the admin UI share
 * one definition of the limits from specs/merchant-features.md:
 * - agent reply content: 1–2000 characters after trimming
 * - tags: ≤10 unique entries, each 1–20 characters after trimming
 * - note: ≤2000 characters
 */

export const AGENT_MESSAGE_MAX_LENGTH = 2000;
export const TAGS_MAX = 10;
export const TAG_MAX_LENGTH = 20;
export const NOTE_MAX_LENGTH = 2000;

/** Returns the trimmed reply, or null when empty / too long / not a string. */
export function validateAgentMessageContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > AGENT_MESSAGE_MAX_LENGTH) return null;
  return trimmed;
}

/** One trimmed tag, or null when empty / longer than 20 characters. */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim();
  return tag.length >= 1 && tag.length <= TAG_MAX_LENGTH ? tag : null;
}

/**
 * Normalizes a tag list: trims every entry, drops duplicates and enforces the
 * 10-tag ceiling. Returns null when the value is not an array or any tag is
 * invalid (so the caller can answer 400).
 */
export function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tags: string[] = [];
  for (const entry of value) {
    const tag = normalizeTag(entry);
    if (tag === null) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.length <= TAGS_MAX ? tags : null;
}

export function isValidNote(value: unknown): value is string {
  return typeof value === 'string' && value.length <= NOTE_MAX_LENGTH;
}

export interface KbDraft {
  title: string;
  content: string;
}

/** KB API limits (the create form posts title ≤200 and content ≤20000). */
export const KB_TITLE_MAX_LENGTH = 200;
export const KB_CONTENT_MAX_LENGTH = 20000;

/**
 * F4: builds the knowledge-base create form values for a visitor message.
 * The question is the visitor text; the answer is the following AI/agent
 * reply (or empty when the merchant is still waiting for one).
 */
export function buildKbDraftFromConversation(
  messages: readonly Message[],
  index: number,
): KbDraft | null {
  const message = messages[index];
  if (!message || message.role !== 'user' || !message.content.trim()) return null;

  const reply = messages
    .slice(index + 1)
    .find((candidate) => candidate.role === 'assistant' || candidate.role === 'agent');

  return {
    title: message.content.trim().slice(0, KB_TITLE_MAX_LENGTH),
    content: (reply?.content ?? '').trim().slice(0, KB_CONTENT_MAX_LENGTH),
  };
}
