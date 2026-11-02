import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { Sparkles } from 'lucide-react';
import { loadConfig } from '@/lib/config';
import { getCurrentUser, isAuthConfigured } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { getDb } from '@/lib/db-runtime';
import { getTranslator, LOCALE_COOKIE, negotiateLocale, resolveLocale } from '@/lib/i18n';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const cookieValue = cookies().get(LOCALE_COOKIE)?.value;
  const locale = cookieValue
    ? resolveLocale(cookieValue)
    : negotiateLocale(headers().get('accept-language'));
  const t = getTranslator(locale);

  // A disabled or reset account must not bounce back into /admin.
  const token = cookies().get(SESSION_COOKIE)?.value;
  let alreadySignedIn = false;
  if (token) {
    try {
      alreadySignedIn = Boolean(await getCurrentUser(token));
    } catch {
      // A broken DB/config must not break the login form itself.
    }
  }
  if (alreadySignedIn) redirect('/admin');

  let nextPath = searchParams.next ?? '/admin';
  if (!nextPath.startsWith('/') || nextPath.startsWith('//')) nextPath = '/admin';

  // Surface configuration problems before the user types a password.
  let configured = true;
  try {
    configured = isAuthConfigured(getDb(), loadConfig(undefined, { checkLlmReady: false }));
  } catch {
    configured = false;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-100/60 blur-3xl" />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white"><Sparkles className="h-5 w-5" aria-hidden /></span>
            ShopPulse AI
          </Link>
          <LocaleSwitcher locale={locale} />
        </div>

        <h1 className="text-xl font-semibold text-slate-900">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('login.subtitle')}</p>

        {!configured ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('login.notConfigured')}
          </p>
        ) : null}

        <div className="mt-6">
          <LoginForm
            nextPath={nextPath}
            labels={{
              username: t('login.username'),
              password: t('login.password'),
              submit: t('login.submit'),
              submitting: t('login.submitting'),
              invalid: t('login.invalid'),
              rateLimited: t('login.rateLimited'),
              notConfigured: t('login.notConfigured'),
              serverError: t('login.serverError'),
            }}
          />
        </div>
      </div>
    </main>
  );
}
