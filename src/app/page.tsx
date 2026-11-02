import Link from 'next/link';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BookOpenCheck, Bot, ChartNoAxesCombined,
  Check, ChevronDown, Clock3, Code2, Languages, MessageCircle,
  ShieldCheck, Sparkles, BookOpen,
  Headset, PackageCheck, Zap, PenLine,
} from 'lucide-react';
import { CopySnippet, LandingLanguage } from '@/components/landing-interactions';
import { DEFAULT_SITE_KEY } from '@/lib/db';
import { getRequestLocale, getRequestTranslator } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

const featureIcons = [MessageCircle, BookOpen, PackageCheck, Headset, Zap, ChartNoAxesCombined, PenLine] as const;
const featureKeys = ['widget', 'knowledge', 'guard', 'handoff', 'quickReplies', 'reports', 'marketing'] as const;

export default function HomePage() {
  const t = getRequestTranslator();
  const locale = getRequestLocale();
  const snippet = `<script src="https://YOUR-DOMAIN/widget.js" data-site-key="${DEFAULT_SITE_KEY}" async></script>`;
  const steps = ['step1', 'step2', 'step3'] as const;
  const faqs = ['q1', 'q2', 'q3', 'q4'] as const;
  return (
    <main className="overflow-hidden bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
        <nav aria-label="Main navigation" className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="#top" className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-200"><Sparkles className="h-5 w-5" aria-hidden /></span>
            <span>ShopPulse <span className="text-indigo-600">AI</span></span>
          </Link>
          <div className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#features" className="hover:text-indigo-600">{t('landing.nav.features')}</a>
            <a href="#how" className="hover:text-indigo-600">{t('landing.nav.how')}</a>
            <a href="#demo" className="hover:text-indigo-600">{t('landing.nav.demo')}</a>
          </div>
          <div className="flex items-center gap-2 sm:gap-3"><LandingLanguage locale={locale} /><Link href="/login" className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700">{t('landing.nav.login')}<ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden /></Link></div>
        </nav>
      </header>

      <section id="top" className="relative isolate bg-slate-50">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1fr_0.95fr] lg:gap-16 lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/80 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-indigo-700 shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('landing.hero.eyebrow')}</span>
            <h1 className="mt-6 whitespace-pre-line text-4xl font-bold leading-[1.13] tracking-tight text-slate-950 sm:text-5xl lg:text-[3.7rem]">{t('landing.hero.title')}</h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">{t('landing.hero.body')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href="/demo" className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">{t('landing.cta.demo')}<ArrowRight className="h-4 w-4" aria-hidden /></Link><Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700">{t('landing.nav.login')}</Link></div>
            <a href="#features" className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-indigo-600"><ArrowDown className="h-4 w-4" aria-hidden />{t('landing.nav.features')}</a>
          </div>
          <div className="relative mx-auto w-full max-w-[560px]">
            <div className="relative rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
              <div className="flex items-center gap-2 border-b border-slate-100 px-2 pb-4"><span className="h-2.5 w-2.5 rounded-full bg-rose-300"/><span className="h-2.5 w-2.5 rounded-full bg-amber-300"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-300"/><span className="ml-auto rounded-lg bg-slate-50 px-3 py-1 text-[10px] text-slate-400">shop.example</span></div>
              <div className="grid gap-4 p-2 pt-5 sm:grid-cols-[1fr_0.82fr] sm:p-4">
                <div className="space-y-4"><div className="rounded-2xl bg-slate-50 p-4"><div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-indigo-600"><MessageCircle className="h-4 w-4" aria-hidden /></span><span className="text-xs font-semibold text-slate-700">{t('landing.mock.assistant')}</span><span className="ml-auto h-2 w-2 rounded-full bg-emerald-500"/></div><div className="ml-2 rounded-xl rounded-tl-sm bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-sm">{t('landing.mock.answer')}<div className="mt-3 flex items-center gap-1 text-[10px] font-medium text-indigo-600"><BookOpenCheck className="h-3 w-3" aria-hidden />{t('landing.mock.source')}</div></div></div><div className="ml-7 rounded-xl rounded-tr-sm bg-indigo-600 p-3 text-xs text-white shadow-sm">{t('landing.mock.question')}</div><div className="rounded-2xl border border-slate-100 p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500"><Bot className="h-3.5 w-3.5 text-indigo-500" aria-hidden />{t('landing.mock.visitor')}</div><div className="mt-2 h-2 w-4/5 rounded bg-slate-100"/><div className="mt-1.5 h-2 w-3/5 rounded bg-slate-100"/></div></div>
                <div className="self-end rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2 text-[10px] font-semibold text-indigo-700"><Sparkles className="h-3.5 w-3.5" aria-hidden />{t('landing.mock.copyTitle')}</div><div className="mt-3 rounded-xl border border-slate-100 bg-white p-3 text-[11px] leading-relaxed text-slate-600">{t('landing.mock.copyText')}</div><div className="mt-3 flex gap-1.5"><span className="rounded-md bg-white px-2 py-1 text-[9px] text-slate-500">小红书</span><span className="rounded-md bg-white px-2 py-1 text-[9px] text-slate-500">抖音</span></div></div>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-slate-800">{t('landing.mock.reportTitle')}</p><p className="mt-1 text-[10px] text-slate-500">{t('landing.mock.reportSubtitle')}</p></div><span className="text-[10px] text-slate-400">{t('landing.mock.reportEmpty')}</span></div><div className="mt-4 flex h-12 items-end gap-1.5" aria-hidden="true"><span className="h-1/3 flex-1 rounded-t bg-indigo-100"/><span className="h-2/3 flex-1 rounded-t bg-indigo-200"/><span className="h-1/2 flex-1 rounded-t bg-indigo-100"/><span className="h-full flex-1 rounded-t bg-indigo-200"/><span className="h-3/5 flex-1 rounded-t bg-indigo-100"/><span className="h-4/5 flex-1 rounded-t bg-indigo-200"/></div></div>
              <div className="flex items-center justify-between border-t border-slate-100 px-3 pt-3 text-[10px] text-slate-400"><span>{t('landing.mock.label')}</span><span className="flex items-center gap-1"><Check className="h-3 w-3 text-emerald-500" aria-hidden />AI + 店铺资料</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-24 bg-white py-20 sm:py-24"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="mx-auto max-w-2xl text-center"><span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">{t('landing.features.eyebrow')}</span><h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.features.title')}</h2><p className="mt-4 leading-7 text-slate-600">{t('landing.features.body')}</p></div><div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{featureKeys.map((key, index) => { const Icon = featureIcons[index]; return <article key={key} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" aria-hidden /></span><h3 className="mt-5 font-semibold text-slate-900">{t(`landing.module.${key}` as never)}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{t(`landing.feature.${(['streaming','grounded','import','handoff','security','analytics','copy'] as const)[index]}Body` as never)}</p></article>; })}</div></div></section>

      <section id="how" className="scroll-mt-24 bg-slate-50 py-20 sm:py-24"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">{t('landing.nav.how')}</span><h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.how.title')}</h2></div><Link href="/demo" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800">{t('landing.cta.demo')}<ArrowRight className="h-4 w-4" aria-hidden /></Link></div><div className="mt-11 grid gap-4 sm:grid-cols-3">{steps.map((step, i) => <div key={step} className="relative rounded-2xl border border-slate-200 bg-white p-6"><span className="text-sm font-bold text-indigo-600">0{i + 1}</span><h3 className="mt-4 font-semibold">{t(`landing.how.${step}` as never)}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{t(`landing.how.${step}Body` as never)}</p>{i < 2 && <ArrowRight className="absolute right-5 top-7 hidden h-4 w-4 text-slate-300 lg:block" aria-hidden />}</div>)}</div></div></section>

      <section id="demo" className="scroll-mt-24 bg-slate-50 py-20 sm:py-24"><div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center"><div><span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">{t('landing.nav.demo')}</span><h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.demo.title')}</h2><p className="mt-4 max-w-lg leading-7 text-slate-600">{t('landing.demo.body')}</p><Link href="/demo" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700">{t('landing.cta.demo')}<ArrowUpRight className="h-4 w-4" aria-hidden /></Link></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-4 flex items-center gap-2 text-sm font-semibold"><Code2 className="h-4 w-4 text-indigo-600" aria-hidden />{t('landing.demo.snippetLabel')}</div><div className="rounded-xl bg-slate-50 p-4"><CopySnippet snippet={snippet} copyLabel={t('landing.demo.copy')} copiedLabel={t('landing.demo.copied')} failedLabel={t('landing.demo.copyFailed')} /></div></div></div></section>

      <section className="py-20 sm:py-24"><div className="mx-auto max-w-3xl px-5 sm:px-8"><h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.faq.title')}</h2><div className="mt-9 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-5 sm:px-7">{faqs.map(q => <details key={q} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-800 marker:hidden">{t(`landing.faq.${q}` as never)}<ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden /></summary><p className="mt-3 pr-8 text-sm leading-7 text-slate-600">{t(`landing.faq.a${q.slice(1)}` as never)}</p></details>)}</div></div></section>

      <section className="bg-white px-5 py-20 sm:px-8 sm:py-24"><div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-slate-50 px-6 py-12 text-center sm:px-12 sm:py-16"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-100 text-indigo-600"><Languages className="h-6 w-6" aria-hidden /></span><h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.final.title')}</h2><p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-600">{t('landing.final.body')}</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/login" className="rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700">{t('landing.cta.trial')}</Link><Link href="/demo" className="rounded-xl border border-slate-300 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:bg-white">{t('landing.cta.demo')}</Link></div></div></section>

      <footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8"><Link href="#top" className="font-bold text-slate-800">ShopPulse <span className="text-indigo-600">AI</span></Link><div className="flex flex-wrap items-center gap-5"><span>{t('landing.footer.mit')}</span><span>{t('landing.footer.github')}</span><Link href="/login" className="hover:text-indigo-600">{t('landing.nav.login')}</Link></div></div></footer>
    </main>
  );
}
