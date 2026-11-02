import {
  addMessage,
  getConversation,
  setConversationHandled,
  touchConversation,
  type DB,
  type Message,
} from './db';

/**
 * F3 agent reply, applied atomically: the ownership check, message insert,
 * conversation touch and optional markHandled all commit or roll back together.
 * Returns null when the conversation does not exist for this owner (caller
 * answers 404). The caller supplies the message id and already-validated content.
 *
 * Lives in a server-only module so src/lib/inbox.ts (shared with client
 * components) stays free of better-sqlite3 imports.
 */
export function addAgentReply(
  db: DB,
  ownerId: number,
  input: {
    id: string;
    conversationId: string;
    content: string;
    markHandled?: boolean;
  },
): Message | null {
  return db.transaction(() => {
    if (!getConversation(db, ownerId, input.conversationId)) return null;
    const message = addMessage(db, ownerId, {
      id: input.id,
      conversationId: input.conversationId,
      role: 'agent',
      content: input.content,
    });
    touchConversation(db, ownerId, input.conversationId);
    if (input.markHandled === true) {
      setConversationHandled(db, ownerId, input.conversationId, true);
    }
    return message;
  })();
}
