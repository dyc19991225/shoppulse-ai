import { getRequestTranslator } from '@/lib/i18n/server';
import { PageHeader } from '@/components/admin/page-header';

export const dynamic = 'force-dynamic';

export default function SitesPage() {
  const t = getRequestTranslator();
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.sites')} subtitle={t('admin.embedHint')} />
      <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        {t('common.comingSoon')}
      </p>
    </div>
  );
}
