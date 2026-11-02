import { getRequestTranslator } from '@/lib/i18n/server';
import { PageHeader } from '@/components/admin/page-header';
import { QuickRepliesManager } from '@/components/admin/quick-replies-manager';

export const dynamic = 'force-dynamic';

export default function QuickRepliesPage() {
  const t = getRequestTranslator();

  return (
    <div className="space-y-6">
      <PageHeader title={t('quickReplies.title')} subtitle={t('quickReplies.subtitle')} />
      <QuickRepliesManager
        labels={{
          newReply: t('quickReplies.new'),
          editReply: t('quickReplies.edit'),
          titleField: t('quickReplies.titleField'),
          content: t('quickReplies.content'),
          contentHint: t('quickReplies.contentHint'),
          empty: t('quickReplies.empty'),
          emptyHint: t('quickReplies.emptyHint'),
          deleteConfirm: t('quickReplies.deleteConfirm'),
          count: t('quickReplies.count'),
          loadFailed: t('quickReplies.loadFailed'),
          error: t('quickReplies.error'),
          save: t('common.save'),
          saving: t('common.saving'),
          cancel: t('common.cancel'),
          delete: t('common.delete'),
          edit: t('common.edit'),
        }}
      />
    </div>
  );
}
