import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { Sparkles } from 'lucide-react';
import { loadConfig } from '@/lib/config';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
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

  const secret = process.env.SESSION_SECRET ?? '';
  if (secret) {
    const session = await verifySession(cookies().get(SESSION_COOKIE)?.value, secret);
    if (session.valid) redirect('/admin');
  }

  let nextPath = searchParams.next ?? '/admin';
  if (!nextPath.startsWith('/') || nextPath.startsWith('//')) nextPath = '/admin';

  // Surface configuration problems before the user types a password.
  let configured = true;
  try {
    const config = loadConfig(undefined, { checkLlmReady: false });
    configured = Boolean(config.sessionSecret && (config.admin.passwordHash || config.admin.password));
  } catch {
    configured = false;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-5 w-5 text-brand-500" aria-hidden />
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
