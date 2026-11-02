import { getRequestLocale, getRequestTranslator } from '@/lib/i18n/server';
import type { CopyPlatform, CopyTone } from '@/lib/copywriting-shared';
import { PageHeader } from '@/components/admin/page-header';
import { CopywritingStudio } from '@/components/admin/copywriting-studio';

export const dynamic = 'force-dynamic';

export default function CopywritingPage() {
  const t = getRequestTranslator();
  const locale = getRequestLocale();

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.copywriting')} subtitle={t('app.tagline')} />
      <CopywritingStudio
        locale={locale}
        labels={{
          product: t('copywrite.product'),
          selectProduct: t('copywrite.selectProduct'),
          noProducts: t('copywrite.noProducts'),
          audience: t('copywrite.audience'),
          audiencePlaceholder: t('copywrite.audiencePlaceholder'),
          sellingPoints: t('copywrite.sellingPoints'),
          sellingPointsPlaceholder: t('copywrite.sellingPointsPlaceholder'),
          sellingPointsHint: t('copywrite.sellingPointsHint'),
          tone: t('copywrite.tone'),
          platforms: t('copywrite.platforms'),
          generate: t('copywrite.generate'),
          generating: t('copywrite.generating'),
          results: t('copywrite.results'),
          empty: t('copywrite.empty'),
          copy: t('copywrite.copy'),
          copied: t('copywrite.copied'),
          copyFailed: t('copywrite.copyFailed'),
          warnings: t('copywrite.warnings'),
          blocked: t('copywrite.blocked'),
          generationFailed: t('copywrite.generationFailed'),
          history: t('copywrite.history'),
          historyEmpty: t('copywrite.historyEmpty'),
          historyItem: t('copywrite.historyItem'),
          loadFailed: t('copywrite.loadFailed'),
          error: t('copywrite.error'),
          noPlatform: t('copywrite.noPlatform'),
          noProduct: t('copywrite.noProduct'),
          mockBadge: t('copywrite.mockBadge'),
          platformLabels: {
            xiaohongshu: t('copywrite.platform.xiaohongshu'),
            moments: t('copywrite.platform.moments'),
            detail: t('copywrite.platform.detail'),
            douyin: t('copywrite.platform.douyin'),
          } satisfies Record<CopyPlatform, string>,
          toneLabels: {
            lively: t('copywrite.tone.lively'),
            professional: t('copywrite.tone.professional'),
            warm: t('copywrite.tone.warm'),
            premium: t('copywrite.tone.premium'),
            humorous: t('copywrite.tone.humorous'),
          } satisfies Record<CopyTone, string>,
        }}
      />
    </div>
  );
}
