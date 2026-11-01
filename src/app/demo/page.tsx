import Link from 'next/link';
import Script from 'next/script';
import { ArrowLeft, Package, ShieldCheck, Sparkles } from 'lucide-react';
import { DEFAULT_SITE_KEY } from '@/lib/db';
import { getRequestTranslator } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

/**
 * Widget demo storefront. The widget script is served from /public and pointed
 * at the default site key created on first boot.
 */
export default function DemoPage() {
  const t = getRequestTranslator();

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-500" aria-hidden />
            <span className="font-bold tracking-tight">ShopPulse AI</span>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('common.backHome')}
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {t('admin.viewDemo')}
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
            {t('widget.title')}
          </h1>
          <p className="mt-3 text-slate-600">{t('app.tagline')}</p>
          <p className="mt-2 text-sm text-slate-500">{t('widget.demoHint')}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Package, title: t('products.title'), body: t('products.subtitle') },
            { icon: ShieldCheck, title: t('kb.title'), body: t('kb.subtitle') },
            { icon: Sparkles, title: t('nav.copywriting'), body: t('admin.kbCardDesc') },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <Icon className="h-5 w-5 text-brand-600" aria-hidden />
              <h2 className="mt-3 font-medium text-slate-900">{title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">{t('admin.embedTitle')}</h2>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
{`<script src="${'https://YOUR-DOMAIN'}/widget.js" data-site-key="${DEFAULT_SITE_KEY}" async></script>`}
          </pre>
        </div>
      </section>

      <Script src="/widget.js" data-site-key={DEFAULT_SITE_KEY} strategy="afterInteractive" />
    </main>
  );
}
