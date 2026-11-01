import { getRequestTranslator } from '@/lib/i18n/server';
import { PageHeader } from '@/components/admin/page-header';

export const dynamic = 'force-dynamic';

export default function CopywritingPage() {
  const t = getRequestTranslator();
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.copywriting')} subtitle={t('app.tagline')} />
      <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        {t('common.comingSoon')}
      </p>
    </div>
  );
}
