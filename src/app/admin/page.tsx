import Link from 'next/link';
import { BookOpen, ExternalLink, MessagesSquare, Package, Settings, Sparkles } from 'lucide-react';
import { getRequestTranslator } from '@/lib/i18n/server';
import { DEFAULT_SITE_KEY } from '@/lib/db';
import type { Intent } from '@/lib/intent';
import { StatsPanel } from '@/components/admin/stats-panel';

export const dynamic = 'force-dynamic';

export default function AdminDashboardPage() {
  const t = getRequestTranslator();

  const intentLabels = {
    product: t('intent.product'),
    price: t('intent.price'),
    logistics: t('intent.logistics'),
    after_sale: t('intent.after_sale'),
    complaint: t('intent.complaint'),
    handoff: t('intent.handoff'),
    other: t('intent.other'),
  } satisfies Record<Intent, string>;

  const cards = [
    {
      href: '/admin/knowledge',
      icon: BookOpen,
      title: t('nav.knowledge'),
      description: t('admin.kbCardDesc'),
    },
    {
      href: '/admin/products',
      icon: Package,
      title: t('nav.products'),
      description: t('admin.productsCardDesc'),
    },
    {
      href: '/admin/copywriting',
      icon: Sparkles,
      title: t('nav.copywriting'),
      description: t('app.tagline'),
    },
    {
      href: '/admin/conversations',
      icon: MessagesSquare,
      title: t('nav.conversations'),
      description: t('conversations.subtitle'),
    },
    {
      href: '/admin/sites',
      icon: Settings,
      title: t('nav.sites'),
      description: t('sites.subtitle'),
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {t('admin.dashboardTitle')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('admin.dashboardSubtitle')}</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{t('admin.welcomeTitle')}</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{t('admin.welcomeBody')}</p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('admin.quickLinks')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow"
            >
              <Icon className="h-5 w-5 text-brand-600" aria-hidden />
              <h3 className="mt-3 font-medium text-slate-900">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
            </Link>
          ))}
        </div>
      </section>

      <StatsPanel
        labels={{
          title: t('stats.title'),
          subtitle: t('stats.subtitle'),
          conversations: t('stats.conversations'),
          needsHuman: t('stats.needsHuman'),
          handled: t('stats.handled'),
          handoffRate: t('stats.handoffRate'),
          intentShare: t('stats.intentShare'),
          topQuestions: t('stats.topQuestions'),
          noData: t('stats.noData'),
          kbEntries: t('stats.kbEntries'),
          products: t('stats.products'),
          copyHistory: t('stats.copyHistory'),
          loadFailed: t('stats.loadFailed'),
          table: t('stats.table'),
          term: t('stats.term'),
          count: t('stats.count'),
          viewConversations: t('stats.viewConversations'),
          ofTotal: t('stats.ofTotal'),
          intentLabels,
        }}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{t('admin.embedTitle')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('admin.embedHint')}</p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
{`<script src="https://YOUR-DOMAIN/widget.js" data-site-key="${DEFAULT_SITE_KEY}" async></script>`}
        </pre>
        <Link
          href="/demo"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          {t('admin.viewDemo')}
        </Link>
      </section>
    </div>
  );
}
