import Link from 'next/link';
import { cookies } from 'next/headers';
import {
  BarChart3,
  BookOpen,
  ExternalLink,
  MessageSquareText,
  MessagesSquare,
  Package,
  Settings,
  Sparkles,
} from 'lucide-react';
import { getRequestTranslator } from '@/lib/i18n/server';
import { listSites } from '@/lib/db';
import { getDb } from '@/lib/db-runtime';
import { getCurrentUser } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/auth/session';
import type { Intent } from '@/lib/intent';
import { StatsPanel } from '@/components/admin/stats-panel';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const t = getRequestTranslator();
  const user = await getCurrentUser(cookies().get(SESSION_COOKIE)?.value);
  const siteKey = user ? listSites(getDb(), user.id)[0]?.siteKey : undefined;

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
      description: t('admin.copywritingCardDesc'),
    },
    {
      href: '/admin/conversations',
      icon: MessagesSquare,
      title: t('nav.conversations'),
      description: t('conversations.subtitle'),
    },
    {
      href: '/admin/reports',
      icon: BarChart3,
      title: t('nav.reports'),
      description: t('admin.reportsCardDesc'),
    },
    {
      href: '/admin/quick-replies',
      icon: MessageSquareText,
      title: t('nav.quickReplies'),
      description: t('admin.quickRepliesCardDesc'),
    },
    {
      href: '/admin/sites',
      icon: Settings,
      title: t('nav.sites'),
      description: t('sites.subtitle'),
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {t('admin.dashboardTitle')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('admin.dashboardSubtitle')}</p>
      </header>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{t('admin.welcomeTitle')}</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{t('admin.welcomeBody')}</p>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('admin.quickLinks')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-xl border border-slate-200/80 bg-slate-50/50 p-5 transition hover:border-brand-500/50 hover:bg-white hover:shadow-md"
            >
              <Icon className="h-5 w-5 text-brand-600" aria-hidden />
              <h3 className="mt-3 font-medium text-slate-900">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
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
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{t('admin.embedTitle')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('admin.embedHint')}</p>
        {siteKey ? (
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
{`<script src="https://YOUR-DOMAIN/widget.js" data-site-key="${siteKey}" async></script>`}
          </pre>
        ) : (
          <p className="mt-4 text-sm text-slate-500">{t('admin.embedNoSite')}</p>
        )}
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
