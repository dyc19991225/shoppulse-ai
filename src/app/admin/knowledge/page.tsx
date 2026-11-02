import { getRequestTranslator } from '@/lib/i18n/server';
import type { KbType } from '@/lib/db';
import { PageHeader } from '@/components/admin/page-header';
import { KnowledgeManager } from '@/components/admin/knowledge-manager';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: { title?: string; content?: string };
}

export default function KnowledgePage({ searchParams }: PageProps) {
  const t = getRequestTranslator();

  // F4: "add to knowledge base" from a conversation links here with the
  // visitor question and the following reply already filled in.
  const title = typeof searchParams?.title === 'string' ? searchParams.title.slice(0, 200) : '';
  const content =
    typeof searchParams?.content === 'string' ? searchParams.content.slice(0, 20000) : '';
  const prefill =
    title || content
      ? {
          title,
          content,
        }
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t('kb.title')} subtitle={t('kb.subtitle')} />
      <KnowledgeManager
        prefilledDraft={prefill}
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
