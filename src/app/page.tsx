import Link from 'next/link';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BookOpenCheck, Bot, ChartNoAxesCombined,
  Check, ChevronDown, Clock3, Code2, FileSpreadsheet, Languages, MessageCircle,
  MessageSquareText, MousePointer2, ShieldCheck, Sparkles, UserRoundCheck,
} from 'lucide-react';
import { CopySnippet, LandingLanguage } from '@/components/landing-interactions';
import { DEFAULT_SITE_KEY } from '@/lib/db';
import { getRequestLocale, getRequestTranslator } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

const featureIcons = [Clock3, MessageSquareText, ShieldCheck, FileSpreadsheet, ChartNoAxesCombined, UserRoundCheck, Code2] as const;
const featureKeys = ['streaming', 'copy', 'grounded', 'import', 'analytics', 'handoff', 'security'] as const;
const pricingKeys = ['starter', 'growth', 'pro'] as const;

export default function HomePage() {
  const t = getRequestTranslator();
  const locale = getRequestLocale();
  const snippet = `<script src="https://YOUR-DOMAIN/widget.js" data-site-key="${DEFAULT_SITE_KEY}" async></script>`;
  const steps = ['step1', 'step2', 'step3', 'step4'] as const;
  const faqs = ['q1', 'q2', 'q3', 'q4'] as const;
  return (
    <main className="overflow-hidden bg-white text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <nav aria-label="Main navigation" className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="#top" className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-200"><Sparkles className="h-5 w-5" aria-hidden /></span>
            <span>ShopPulse <span className="text-indigo-600">AI</span></span>
          </Link>
          <div className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#features" className="hover:text-indigo-600">{t('landing.nav.features')}</a>
            <a href="#how" className="hover:text-indigo-600">{t('landing.nav.how')}</a>
            <a href="#demo" className="hover:text-indigo-600">{t('landing.nav.demo')}</a>
            <a href="#pricing" className="hover:text-indigo-600">{t('landing.nav.pricing')}</a>
          </div>
          <div className="flex items-center gap-2 sm:gap-3"><LandingLanguage locale={locale} /><Link href="/login" className="hidden rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 sm:inline-flex">{t('landing.nav.login')}<ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden /></Link></div>
        </nav>
      </header>

      <section id="top" className="relative isolate bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-100 via-white to-white">
        <div className="pointer-events-none absolute -right-36 top-24 -z-10 h-96 w-96 rounded-full bg-violet-200/50 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1fr_0.95fr] lg:gap-16 lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/80 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-indigo-700 shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('landing.hero.eyebrow')}</span>
            <h1 className="mt-6 whitespace-pre-line text-4xl font-bold leading-[1.13] tracking-tight text-slate-950 sm:text-5xl lg:text-[3.7rem]">{t('landing.hero.title')}</h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">{t('landing.hero.body')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700">{t('landing.cta.trial')}<ArrowRight className="h-4 w-4" aria-hidden /></Link><Link href="/demo" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"><MousePointer2 className="h-4 w-4" aria-hidden />{t('landing.cta.demo')}</Link></div>
            <a href="#features" className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-indigo-600"><ArrowDown className="h-4 w-4" aria-hidden />{t('landing.nav.features')}</a>
          </div>
          <div className="relative mx-auto w-full max-w-[560px]">
            <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-indigo-200/70 via-violet-100/40 to-transparent blur-2xl" />
            <div className="relative rounded-[1.7rem] border border-slate-200/90 bg-white p-3 shadow-2xl shadow-indigo-200/50 sm:p-5">
              <div className="flex items-center gap-2 border-b border-slate-100 px-2 pb-4"><span className="h-2.5 w-2.5 rounded-full bg-rose-300"/><span className="h-2.5 w-2.5 rounded-full bg-amber-300"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-300"/><span className="ml-auto rounded-lg bg-slate-50 px-3 py-1 text-[10px] text-slate-400">shop.example</span></div>
              <div className="grid gap-4 p-2 pt-5 sm:grid-cols-[1fr_0.82fr] sm:p-4">
                <div className="space-y-4"><div className="rounded-2xl bg-slate-50 p-4"><div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-indigo-600"><MessageCircle className="h-4 w-4" aria-hidden /></span><span className="text-xs font-semibold text-slate-700">{t('landing.mock.assistant')}</span><span className="ml-auto h-2 w-2 rounded-full bg-emerald-500"/></div><div className="ml-2 rounded-xl rounded-tl-sm bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-sm">{t('landing.mock.answer')}<div className="mt-3 flex items-center gap-1 text-[10px] font-medium text-indigo-600"><BookOpenCheck className="h-3 w-3" aria-hidden />{t('landing.mock.source')}</div></div></div><div className="ml-7 rounded-xl rounded-tr-sm bg-indigo-600 p-3 text-xs text-white shadow-sm">{t('landing.mock.question')}</div><div className="rounded-2xl border border-slate-100 p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500"><Bot className="h-3.5 w-3.5 text-indigo-500" aria-hidden />{t('landing.mock.visitor')}</div><div className="mt-2 h-2 w-4/5 rounded bg-slate-100"/><div className="mt-1.5 h-2 w-3/5 rounded bg-slate-100"/></div></div>
                <div className="self-end rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50 p-4"><div className="flex items-center gap-2 text-[10px] font-semibold text-violet-700"><Sparkles className="h-3.5 w-3.5" aria-hidden />{t('landing.mock.copyTitle')}</div><div className="mt-3 rounded-xl border border-white/90 bg-white/80 p-3 text-[11px] leading-relaxed text-slate-600">{t('landing.mock.copyText')}</div><div className="mt-3 flex gap-1.5"><span className="rounded-md bg-white px-2 py-1 text-[9px] text-slate-500">小红书</span><span className="rounded-md bg-white px-2 py-1 text-[9px] text-slate-500">抖音</span></div></div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-3 pt-3 text-[10px] text-slate-400"><span>{t('landing.mock.label')}</span><span className="flex items-center gap-1"><Check className="h-3 w-3 text-emerald-500" aria-hidden />AI + 店铺资料</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-24 bg-slate-50/80 py-20 sm:py-24"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="mx-auto max-w-2xl text-center"><span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">{t('landing.features.eyebrow')}</span><h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.features.title')}</h2><p className="mt-4 leading-7 text-slate-600">{t('landing.features.body')}</p></div><div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{featureKeys.map((key, index) => { const Icon = featureIcons[index]; return <article key={key} className={`rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${index === 0 || index === 6 ? 'lg:col-span-2' : ''}`}><span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" aria-hidden /></span><h3 className="mt-5 font-semibold text-slate-900">{t(`landing.feature.${key}` as never)}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{t(`landing.feature.${key}Body` as never)}</p></article>; })}</div></div></section>

      <section id="how" className="scroll-mt-24 py-20 sm:py-24"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">{t('landing.nav.how')}</span><h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.how.title')}</h2></div><Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800">{t('landing.cta.trial')}<ArrowRight className="h-4 w-4" aria-hidden /></Link></div><div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{steps.map((step, i) => <div key={step} className="relative rounded-2xl border border-slate-200 bg-white p-6"><span className="text-sm font-bold text-indigo-600">0{i + 1}</span><h3 className="mt-4 font-semibold">{t(`landing.how.${step}` as never)}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{t(`landing.how.${step}Body` as never)}</p>{i < 3 && <ArrowRight className="absolute right-5 top-7 hidden h-4 w-4 text-slate-300 lg:block" aria-hidden />}</div>)}</div></div></section>

      <section id="demo" className="scroll-mt-24 bg-slate-950 py-20 text-white sm:py-24"><div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center"><div><span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">{t('landing.nav.demo')}</span><h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.demo.title')}</h2><p className="mt-4 max-w-lg leading-7 text-slate-300">{t('landing.demo.body')}</p><Link href="/demo" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-indigo-50">{t('landing.cta.demo')}<ArrowUpRight className="h-4 w-4" aria-hidden /></Link></div><div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 sm:p-7"><div className="mb-4 flex items-center gap-2 text-sm font-semibold"><Code2 className="h-4 w-4 text-indigo-300" aria-hidden />{t('landing.demo.snippetLabel')}</div><div className="rounded-xl bg-slate-900 p-4"><CopySnippet snippet={snippet} copyLabel={t('landing.demo.copy')} copiedLabel={t('landing.demo.copied')} failedLabel={t('landing.demo.copyFailed')} /></div></div></div></section>

      <section id="pricing" className="scroll-mt-24 bg-indigo-50/50 py-20 sm:py-24"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="text-center"><span className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">{t('landing.pricing.eyebrow')}</span><h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.pricing.title')}</h2><p className="mt-3 text-sm font-medium text-slate-500">{t('landing.pricing.note')}</p></div><div className="mx-auto mt-11 grid max-w-5xl gap-5 md:grid-cols-3">{pricingKeys.map((plan, i) => <article key={plan} className={`rounded-2xl border bg-white p-6 shadow-sm ${i === 1 ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'}`}><h3 className="font-semibold">{t(`landing.pricing.${plan}` as never)}</h3><p className="mt-3 text-3xl font-bold tracking-tight">{t(`landing.pricing.${plan}Price` as never)}</p><p className="mt-2 min-h-10 text-sm text-slate-500">{t(`landing.pricing.${plan}Body` as never)}</p><ul className="mt-5 space-y-3 border-t border-slate-100 pt-5 text-sm text-slate-600">{['item1','item2','item3',...(i === 2 ? ['item4'] : [])].map(item => <li key={item} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden />{t(`landing.pricing.${item}` as never)}</li>)}</ul><Link href="/login" className={`mt-6 inline-flex w-full justify-center rounded-xl px-4 py-3 text-sm font-semibold ${i === 1 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}>{t('landing.pricing.cta')}</Link></article>)}</div></div></section>

      <section className="py-20 sm:py-24"><div className="mx-auto max-w-3xl px-5 sm:px-8"><h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.faq.title')}</h2><div className="mt-9 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-5 sm:px-7">{faqs.map(q => <details key={q} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-800 marker:hidden">{t(`landing.faq.${q}` as never)}<ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden /></summary><p className="mt-3 pr-8 text-sm leading-7 text-slate-600">{t(`landing.faq.a${q.slice(1)}` as never)}</p></details>)}</div></div></section>

      <section className="px-5 pb-20 sm:px-8 sm:pb-24"><div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-600 to-violet-700 px-6 py-12 text-center text-white shadow-xl shadow-indigo-200 sm:px-12 sm:py-16"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/15"><Languages className="h-6 w-6" aria-hidden /></span><h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{t('landing.final.title')}</h2><p className="mx-auto mt-4 max-w-2xl leading-7 text-indigo-100">{t('landing.final.body')}</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/login" className="rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50">{t('landing.cta.trial')}</Link><Link href="/demo" className="rounded-xl border border-white/40 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10">{t('landing.cta.demo')}</Link></div></div></section>

      <footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8"><Link href="#top" className="font-bold text-slate-800">ShopPulse <span className="text-indigo-600">AI</span></Link><div className="flex flex-wrap items-center gap-5"><span>{t('landing.footer.mit')}</span><span>{t('landing.footer.github')}</span><Link href="/login" className="hover:text-indigo-600">{t('landing.nav.login')}</Link></div></div></footer>
    </main>
  );
}
