'use client';

import { usePathname } from 'next/navigation';
import type { SidebarLabels } from './sidebar';
import type { UserRole } from '@/lib/db';

const ROUTES: Array<[string, keyof SidebarLabels]> = [
  ['/admin/reports', 'reports'], ['/admin/conversations', 'conversations'],
  ['/admin/quick-replies', 'quickReplies'], ['/admin/knowledge', 'knowledge'],
  ['/admin/products', 'products'], ['/admin/copywriting', 'copywriting'],
  ['/admin/sites', 'sites'], ['/admin', 'dashboard'],
];

export function AdminTopbar({ username, roleLabel, labels }: {
  username: string; roleLabel: string; labels: SidebarLabels;
}) {
  const pathname = usePathname();
  const key = ROUTES.find(([path]) => path === '/admin' ? pathname === path : pathname.startsWith(path))?.[1] ?? 'dashboard';
  return <header className="sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 backdrop-blur md:flex lg:px-8">
    <h1 className="text-sm font-semibold text-slate-800">{labels[key]}</h1>
    <div className="flex items-center gap-3 text-sm">
      <span className="max-w-48 truncate font-medium text-slate-700">{username}</span>
      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">{roleLabel}</span>
    </div>
  </header>;
}
