'use client';

import { AlertCircle, MessageSquareText, TrendingUp, UserRoundCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Intent } from '@/lib/intent';
import type { StatsPayload } from '@/lib/stats';

export interface StatsLabels {
  title: string;
  subtitle: string;
  conversations: string;
  needsHuman: string;
  handled: string;
  handoffRate: string;
  intentShare: string;
  topQuestions: string;
  noData: string;
  kbEntries: string;
  products: string;
  copyHistory: string;
  loadFailed: string;
  table: string;
  term: string;
  count: string;
  viewConversations: string;
  ofTotal: string;
  intentLabels: Record<Intent, string>;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Ranked horizontal bars: one hue, direct labels, table view for accessibility. */
function IntentBars({
  stats,
  labels,
}: {
  stats: StatsPayload;
  labels: StatsLabels;
}) {
  const max = Math.max(...stats.intents.map((intent) => intent.count), 1);
  const hasData = stats.last7Days.conversations > 0;

  if (!hasData) {
    return <p className="text-sm text-slate-500">{labels.noData}</p>;
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2.5">
        {stats.intents.map(({ intent, count, share }) => (
          <li key={intent} className="grid grid-cols-[7rem_minmax(0,1fr)_4.5rem] items-center gap-3">
            <span className="truncate text-sm text-slate-600" title={labels.intentLabels[intent]}>
              {labels.intentLabels[intent]}
            </span>
            <span
              className="block h-2.5 rounded-full bg-slate-100"
              role="img"
              aria-label={`${labels.intentLabels[intent]}: ${count} (${percent(share)})`}
            >
              <span
                className="block h-2.5 rounded-full bg-brand-500"
                style={{ width: `${Math.max((count / max) * 100, count > 0 ? 2 : 0)}%` }}
              />
            </span>
            <span className="text-right text-xs tabular-nums text-slate-600">
              {percent(share)} · {count}
            </span>
          </li>
        ))}
      </ul>

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-700">
          {labels.table}
        </summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-1 font-medium">{labels.intentShare}</th>
              <th className="py-1 text-right font-medium">{labels.count}</th>
            </tr>
          </thead>
          <tbody>
            {stats.intents.map(({ intent, count, share }) => (
              <tr key={intent} className="border-b border-slate-50">
                <td className="py-1">{labels.intentLabels[intent]}</td>
                <td className="py-1 text-right tabular-nums">
                  {count} ({percent(share)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function StatsPanel({ labels }: { labels: StatsLabels }) {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/stats', { cache: 'no-store' });
      if (!response.ok) throw new Error('stats failed');
      setStats((await response.json()) as StatsPayload);
    } catch {
      setError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [labels.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="animate-pulse rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-4 w-40 rounded bg-slate-100" />
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-20 rounded-lg bg-slate-50" />
          ))}
        </div>
      </section>
    );
  }

  if (error || !stats) {
    return (
      <section className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
        <p role="alert" className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" aria-hidden />
          {error ?? labels.loadFailed}
        </p>
      </section>
    );
  }

  const tiles = [
    {
      icon: MessageSquareText,
      label: labels.conversations,
      value: String(stats.last7Days.conversations),
      hint: labels.subtitle.replace('{days}', String(stats.rangeDays)),
    },
    {
      icon: AlertCircle,
      label: labels.needsHuman,
      value: String(stats.last7Days.needsHuman),
      hint: percent(stats.handoffRate),
    },
    {
      icon: UserRoundCheck,
      label: labels.handled,
      value: String(stats.last7Days.handled),
      hint: `${percent(
        stats.last7Days.conversations > 0
          ? stats.last7Days.handled / stats.last7Days.conversations
          : 0,
      )}`,
    },
    {
      icon: TrendingUp,
      label: labels.handoffRate,
      value: percent(stats.handoffRate),
      hint: labels.ofTotal.replace('{count}', String(stats.last7Days.conversations)),
    },
  ];

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{labels.title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {labels.subtitle.replace('{days}', String(stats.rangeDays))}
          </p>
        </div>
        <a
          href="/admin/conversations"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          {labels.viewConversations}
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value, hint }) => (
          <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">{labels.intentShare}</h3>
          <IntentBars stats={stats} labels={labels} />
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">{labels.topQuestions}</h3>
          {stats.topQuestions.length === 0 ? (
            <p className="text-sm text-slate-500">{labels.noData}</p>
          ) : (
            <ul className="space-y-1.5">
              {stats.topQuestions.map(({ term, count }) => (
                <li key={term} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                    {term}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-4 text-xs text-slate-500">
        <span>
          {labels.kbEntries}: <strong className="font-semibold text-slate-700">{stats.totals.kbEntries}</strong>
        </span>
        <span>
          {labels.products}: <strong className="font-semibold text-slate-700">{stats.totals.products}</strong>
        </span>
        <span>
          {labels.copyHistory}: <strong className="font-semibold text-slate-700">{stats.totals.copyHistory}</strong>
        </span>
      </div>
    </section>
  );
}
