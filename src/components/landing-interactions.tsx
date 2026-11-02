'use client';

import { useState } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import type { Locale } from '@/lib/i18n';

export function LandingLanguage({ locale }: { locale: Locale }) {
  return <LocaleSwitcher locale={locale} />;
}

export function CopySnippet({ snippet, copyLabel, copiedLabel, failedLabel }: {
  snippet: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('failed');
    }
  }
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">{state === 'failed' ? failedLabel : state === 'copied' ? copiedLabel : copyLabel}</p>
        <button onClick={copy} type="button" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">{state === 'copied' ? copiedLabel : copyLabel}</button>
      </div>
      <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-indigo-100"><code>{snippet}</code></pre>
    </div>
  );
}
