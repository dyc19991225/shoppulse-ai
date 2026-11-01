import { getRequestTranslator } from '@/lib/i18n/server';
import type { KbType } from '@/lib/db';
import { PageHeader } from '@/components/admin/page-header';
import { KnowledgeManager } from '@/components/admin/knowledge-manager';

export const dynamic = 'force-dynamic';

export default function KnowledgePage() {
  const t = getRequestTranslator();

  return (
    <div className="space-y-6">
      <PageHeader title={t('kb.title')} subtitle={t('kb.subtitle')} />
      <KnowledgeManager
        labels={{
          newEntry: t('kb.new'),
          editEntry: t('kb.edit'),
          searchPlaceholder: t('kb.searchPlaceholder'),
          empty: t('kb.empty'),
          emptyHint: t('kb.emptyHint'),
          type: t('kb.type'),
          titleField: t('kb.titleField'),
          content: t('kb.content'),
          keywords: t('kb.keywords'),
          keywordsHint: t('kb.keywordsHint'),
          enabledHint: t('kb.enabledHint'),
          deleteConfirm: t('kb.deleteConfirm'),
          types: {
            faq: t('kb.type.faq'),
            policy: t('kb.type.policy'),
            shop_info: t('kb.type.shop_info'),
            other: t('kb.type.other'),
          } satisfies Record<KbType, string>,
          save: t('common.save'),
          saving: t('common.saving'),
          cancel: t('common.cancel'),
          delete: t('common.delete'),
          edit: t('common.edit'),
          enabled: t('common.enabled'),
          disabled: t('common.disabled'),
          count: t('kb.count'),
          loadFailed: t('kb.loadFailed'),
          error: t('common.error'),
          noResults: t('common.noResults'),
          create: t('common.create'),
        }}
      />
    </div>
  );
}
