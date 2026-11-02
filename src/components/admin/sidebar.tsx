'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BookOpen,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  MessagesSquare,
  Package,
  Settings,
  Sparkles,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { Locale } from '@/lib/i18n';
import { LocaleSwitcher } from '@/components/locale-switcher';

export interface SidebarLabels {
  dashboard: string;
  knowledge: string;
  products: string;
  copywriting: string;
  conversations: string;
  sites: string;
  logout: string;
  demo: string;
}

const NAV = [
  { href: '/admin', key: 'dashboard', icon: LayoutDashboard },
  { href: '/admin/knowledge', key: 'knowledge', icon: BookOpen },
  { href: '/admin/products', key: 'products', icon: Package },
  { href: '/admin/copywriting', key: 'copywriting', icon: Sparkles },
  { href: '/admin/conversations', key: 'conversations', icon: MessagesSquare },
  { href: '/admin/sites', key: 'sites', icon: Settings },
] as const;

export function AdminSidebar({
  locale,
  labels,
  username,
}: {
  locale: Locale;
  labels: SidebarLabels;
  username: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const nav = <nav className="flex-1 space-y-1 p-3" aria-label="Admin">
        {NAV.map(({ href, key, icon: Icon }) => {
          const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
          return <Link key={href} href={href} onClick={() => setMobileOpen(false)} aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
            <Icon className="h-4 w-4" aria-hidden />{labels[key]}</Link>;
        })}
      </nav>;
  const footer = <div className="space-y-3 border-t border-slate-100 p-4">
        <div><LocaleSwitcher locale={locale} /></div>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span className="truncate" title={username}>{username}</span>
          <button type="button" onClick={logout} disabled={loggingOut} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><LogOut className="h-3.5 w-3.5" aria-hidden />{labels.logout}</button>
        </div>
      </div>;
  return (
    <>
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
        <Sparkles className="h-5 w-5 text-brand-500" aria-hidden />
        <span className="font-bold tracking-tight">ShopPulse AI</span>
      </div>

      {nav}{footer}
    </aside>
    <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
      <button type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{mobileOpen ? <X className="h-5 w-5"/> : <Menu className="h-5 w-5"/>}</button>
      <span className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-brand-600"/>ShopPulse AI</span><span className="w-9"/>
    </div>
    {mobileOpen && <div className="fixed inset-0 z-40 bg-slate-950/30 md:hidden" onClick={() => setMobileOpen(false)}>
      <aside className="flex h-full w-[min(18rem,85vw)] flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5"><Sparkles className="h-5 w-5 text-brand-600"/><span className="font-bold">ShopPulse AI</span></div>{nav}{footer}
      </aside>
    </div>}
    </>
  );
}
