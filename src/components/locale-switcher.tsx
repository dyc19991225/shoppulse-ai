'use client';

import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { useState, useTransition } from 'react';
import type { Locale } from '@/lib/i18n';

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [current, setCurrent] = useState<Locale>(locale);
  const [pending, startTransition] = useTransition();

  async function switchTo(next: Locale) {
    if (next === current) return;
    setCurrent(next);
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 text-xs">
      <Languages className="ml-1 h-3.5 w-3.5 text-slate-500" aria-hidden />
      {(['zh', 'en'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => switchTo(option)}
          disabled={pending}
          aria-pressed={current === option}
          className={`rounded px-2 py-1 font-medium transition ${
            current === option
              ? 'bg-brand-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {option === 'zh' ? '中文' : 'EN'}
        </button>
      ))}
    </div>
  );
}
