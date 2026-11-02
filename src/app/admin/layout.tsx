import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadConfig } from '@/lib/config';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { getRequestLocale, getRequestTranslator } from '@/lib/i18n/server';
import { AdminSidebar } from '@/components/admin/sidebar';

export const dynamic = 'force-dynamic';

/**
 * Admin shell. Middleware already rejects unauthenticated requests, but we
 * re-verify here so a misconfigured matcher can never leak admin pages.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let username = '';
  try {
    const secret = loadConfig(undefined, { checkLlmReady: false }).sessionSecret;
    const session = secret
      ? await verifySession(cookies().get(SESSION_COOKIE)?.value, secret)
      : { valid: false as const, reason: 'malformed' as const };
    if (!session.valid) redirect('/login?next=/admin');
    username = session.payload.sub;
  } catch (error) {
    // redirect() throws; rethrow so Next handles it.
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    redirect('/login?next=/admin');
  }

  const locale = getRequestLocale();
  const t = getRequestTranslator();

  const labels = {
    dashboard: t('nav.dashboard'),
    knowledge: t('nav.knowledge'),
    products: t('nav.products'),
    copywriting: t('nav.copywriting'),
    conversations: t('nav.conversations'),
    sites: t('nav.sites'),
    logout: t('common.logout'),
    demo: t('admin.viewDemo'),
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar locale={locale} labels={labels} username={username} />
      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-6xl px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
