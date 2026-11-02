import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { getRequestLocale, getRequestTranslator } from '@/lib/i18n/server';
import { AdminSidebar } from '@/components/admin/sidebar';

export const dynamic = 'force-dynamic';

/**
 * Admin shell. Middleware already rejects unauthenticated requests, but we
 * re-verify here — against the users table — so a misconfigured matcher or a
 * disabled/reset account can never use a stale cookie to reach admin pages.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let username = '';
  try {
    const user = await getCurrentUser(cookies().get(SESSION_COOKIE)?.value);
    if (!user) redirect('/login?next=/admin');
    username = user.username;
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
        <main className="mx-auto max-w-7xl px-4 pb-8 pt-20 sm:px-6 sm:py-8 md:pt-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
