import { getRequestTranslator } from '@/lib/i18n/server';
import type { Intent } from '@/lib/intent';
import { PageHeader } from '@/components/admin/page-header';
import { ConversationsManager } from '@/components/admin/conversations-manager';

export const dynamic = 'force-dynamic';

export default function ConversationsPage() {
  const t = getRequestTranslator();

  return (
    <div className="space-y-6">
      <PageHeader title={t('conversations.title')} subtitle={t('conversations.subtitle')} />
      <ConversationsManager
        labels={{
          title: t('conversations.title'),
          empty: t('conversations.empty'),
          emptyHint: t('conversations.emptyHint'),
          filterAll: t('conversations.filterAll'),
          filterNeedsHuman: t('conversations.filterNeedsHuman'),
          filterUnhandled: t('conversations.filterUnhandled'),
          filterHandled: t('conversations.filterHandled'),
          site: t('conversations.site'),
          startedAt: t('conversations.startedAt'),
          lastAt: t('conversations.lastAt'),
          messageCount: t('conversations.messageCount'),
          intent: t('conversations.intent'),
          status: t('conversations.status'),
          handled: t('conversations.handled'),
          unhandled: t('conversations.unhandled'),
          needsHuman: t('conversations.needsHuman'),
          markHandled: t('conversations.markHandled'),
          markUnhandled: t('conversations.markUnhandled'),
          detail: t('conversations.detail'),
          messages: t('conversations.messages'),
          visitor: t('conversations.visitor'),
          loadFailed: t('conversations.loadFailed'),
          selectHint: t('conversations.selectHint'),
          roleUser: t('conversations.roleUser'),
          roleAssistant: t('conversations.roleAssistant'),
          roleAgent: t('conversations.roleAgent'),
          roleSystem: t('conversations.roleSystem'),
          replyPlaceholder: t('conversations.replyPlaceholder'),
          sendReply: t('conversations.sendReply'),
          replyFailed: t('conversations.replyFailed'),
          quickReplies: t('conversations.quickReplies'),
          quickRepliesEmpty: t('conversations.quickRepliesEmpty'),
          markHandledOnReply: t('conversations.markHandledOnReply'),
          tags: t('conversations.tags'),
          tagPlaceholder: t('conversations.tagPlaceholder'),
          addTag: t('conversations.addTag'),
          removeTag: t('conversations.removeTag'),
          tagsHint: t('conversations.tagsHint'),
          filterTag: t('conversations.filterTag'),
          clearTagFilter: t('conversations.clearTagFilter'),
          note: t('conversations.note'),
          notePlaceholder: t('conversations.notePlaceholder'),
          saveNote: t('conversations.saveNote'),
          noteSaved: t('conversations.noteSaved'),
          addToKb: t('conversations.addToKb'),
          count: t('conversations.count'),
          page: t('conversations.page'),
          prev: t('conversations.prev'),
          next: t('conversations.next'),
          intentLabels: {
            product: t('intent.product'),
            price: t('intent.price'),
            logistics: t('intent.logistics'),
            after_sale: t('intent.after_sale'),
            complaint: t('intent.complaint'),
            handoff: t('intent.handoff'),
            other: t('intent.other'),
          } satisfies Record<Intent, string>,
        }}
      />
    </div>
  );
}
