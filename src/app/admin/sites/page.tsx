import { getRequestTranslator } from '@/lib/i18n/server';
import { PageHeader } from '@/components/admin/page-header';
import { SitesManager } from '@/components/admin/sites-manager';
import { DEFAULT_ALLOWED_ORIGINS } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function SitesPage() {
  const t = getRequestTranslator();

  return (
    <div className="space-y-6">
      <PageHeader title={t('sites.title')} subtitle={t('sites.subtitle')} />
      <SitesManager
        defaultOrigins={DEFAULT_ALLOWED_ORIGINS}
        labels={{
          newSite: t('sites.new'),
          editSite: t('sites.edit'),
          name: t('sites.name'),
          siteKey: t('sites.siteKey'),
          siteKeyHint: t('sites.siteKeyHint'),
          regenerate: t('sites.regenerate'),
          allowedOrigins: t('sites.allowedOrigins'),
          originsHint: t('sites.originsHint'),
          rateLimit: t('sites.rateLimit'),
          rateLimitHint: t('sites.rateLimitHint'),
          embed: t('sites.embed'),
          embedHint: t('sites.embedHint'),
          copy: t('sites.copy'),
          copied: t('sites.copied'),
          copyFailed: t('sites.copyFailed'),
          empty: t('sites.empty'),
          deleteConfirm: t('sites.deleteConfirm'),
          deleteBlocked: t('sites.deleteBlocked'),
          error: t('sites.error'),
          loadFailed: t('sites.loadFailed'),
          originsInvalid: t('sites.originsInvalid'),
          count: t('sites.count'),
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
