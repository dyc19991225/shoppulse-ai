import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BarChart3, Download } from 'lucide-react';
import { getRequestTranslator } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { getDb } from '@/lib/db-runtime';
import type { Intent } from '@/lib/intent';
import {
  DEFAULT_REPORT_DAYS,
  getReportSummary,
  isReportDays,
  type DailyReportRow,
} from '@/lib/reports';
import { PageHeader } from '@/components/admin/page-header';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { days?: string | string[] };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

type TrendField = 'conversations' | 'messages' | 'handoffs' | 'copies';

/** Single-series column chart; one measure per card keeps the y-scale honest. */
function TrendChart({
  rows,
  field,
  label,
}: {
  rows: DailyReportRow[];
  field: TrendField;
  label: string;
}) {
  const width = 600;
  const height = 140;
  const top = 12;
  const bottom = 22;
  const plotHeight = height - top - bottom;
  const slot = width / Math.max(rows.length, 1);
  const barWidth = Math.max(2, Math.min(18, slot * 0.62));
  const max = Math.max(...rows.map((row) => row[field]), 1);
  const total = rows.reduce((sum, row) => sum + row[field], 0);
  const peak = Math.max(...rows.map((row) => row[field]));
  const every = Math.ceil(rows.length / 7);

  return (
    <figure className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-xs tabular-nums text-slate-500">
          {total} · max {peak}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${total}`} className="mt-2 w-full">
        <line x1={0} x2={width} y1={height - bottom} y2={height - bottom} stroke="#c3c2b7" strokeWidth={1} />
        {rows.map((row, index) => {
          const value = row[field];
          const barHeight = value > 0 ? Math.max((value / max) * plotHeight, 2) : 0;
          const x = index * slot + (slot - barWidth) / 2;
          return (
            <g key={row.date}>
              {barHeight > 0 ? (
                <rect
                  x={x}
                  y={height - bottom - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill="#2a78d6"
                >
                  <title>{`${row.date}: ${value}`}</title>
                </rect>
              ) : null}
              {index % every === 0 || index === rows.length - 1 ? (
                <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fill="#898781" fontSize={9}>
                  {row.date.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const t = getRequestTranslator();
  const rawDays = Array.isArray(searchParams.days) ? searchParams.days[0] : searchParams.days;
  const parsedDays = rawDays === undefined ? DEFAULT_REPORT_DAYS : Number(rawDays);
  const days = isReportDays(parsedDays) ? parsedDays : DEFAULT_REPORT_DAYS;

  const user = await getCurrentUser(cookies().get(SESSION_COOKIE)?.value);
  if (!user) redirect('/login?next=/admin/reports');

  const summary = getReportSummary(getDb(), user.id, days);
  const hasData =
    summary.kpis.conversations > 0 ||
    summary.kpis.messages > 0 ||
    summary.kpis.copiesGenerated > 0;

  const intentLabels: Record<Intent, string> = {
    product: t('intent.product'),
    price: t('intent.price'),
    logistics: t('intent.logistics'),
    after_sale: t('intent.after_sale'),
    complaint: t('intent.complaint'),
    handoff: t('intent.handoff'),
    other: t('intent.other'),
  };

  const ranges = [
    { days: 7 as const, label: t('reports.range7') },
    { days: 30 as const, label: t('reports.range30') },
    { days: 90 as const, label: t('reports.range90') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={
          <Link
            href={`/api/admin/reports/summary.csv?days=${days}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('reports.downloadCsv')}
          </Link>
        }
      />

      <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
        {ranges.map((range) => (
          <Link
            key={range.days}
            href={`/admin/reports?days=${range.days}`}
            aria-current={days === range.days ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              days === range.days ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {range.label}
          </Link>
        ))}
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-3 font-medium text-slate-700">{t('reports.empty')}</p>
          <p className="mt-1 text-sm text-slate-500">{t('reports.emptyHint')}</p>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-5">
              <p className="text-xs font-medium text-brand-700">{t('reports.todayConversations')}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                {summary.today.conversations}
              </p>
              <p className="mt-1 text-xs text-slate-500">{t('reports.todayHint')}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-5">
              <p className="text-xs font-medium text-amber-700">{t('reports.pendingHandoffs')}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                {summary.today.pendingHandoffs}
              </p>
              <p className="mt-1 text-xs text-slate-500">{t('reports.pendingHint')}</p>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={t('reports.kpi.conversations')}
              value={String(summary.kpis.conversations)}
            />
            <KpiCard label={t('reports.kpi.messages')} value={String(summary.kpis.messages)} />
            <KpiCard
              label={t('reports.kpi.visitorMessages')}
              value={String(summary.kpis.visitorMessages)}
            />
            <KpiCard label={t('reports.kpi.aiReplies')} value={String(summary.kpis.aiReplies)} />
            <KpiCard
              label={t('reports.kpi.agentReplies')}
              value={String(summary.kpis.agentReplies)}
            />
            <KpiCard label={t('reports.kpi.handoffs')} value={String(summary.kpis.handoffs)} />
            <KpiCard
              label={t('reports.kpi.handoffRate')}
              value={percent(summary.kpis.handoffRate)}
            />
            <KpiCard label={t('reports.kpi.handled')} value={String(summary.kpis.handled)} />
            <KpiCard
              label={t('reports.kpi.pendingHandoffs')}
              value={String(summary.kpis.pendingHandoffs)}
            />
            <KpiCard
              label={t('reports.kpi.copiesGenerated')}
              value={String(summary.kpis.copiesGenerated)}
            />
            <KpiCard label={t('reports.kpi.kbEntries')} value={String(summary.kpis.kbEntries)} />
            <KpiCard label={t('reports.kpi.products')} value={String(summary.kpis.products)} />
            <KpiCard
              label={t('reports.kpi.avgAgentFirstResponseSec')}
              value={
                summary.kpis.avgAgentFirstResponseSec === null
                  ? t('reports.kpi.noFirstResponse')
                  : formatSeconds(summary.kpis.avgAgentFirstResponseSec)
              }
            />
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">{t('reports.trendTitle')}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <TrendChart rows={summary.daily} field="conversations" label={t('reports.trendConversations')} />
              <TrendChart rows={summary.daily} field="messages" label={t('reports.trendMessages')} />
              <TrendChart rows={summary.daily} field="handoffs" label={t('reports.trendHandoffs')} />
              <TrendChart rows={summary.daily} field="copies" label={t('reports.trendCopies')} />
            </div>
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer select-none hover:text-slate-700">
                {t('reports.tableView')}
              </summary>
              <table className="mt-2 w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="py-1 font-medium">{t('reports.date')}</th>
                    <th className="py-1 text-right font-medium">{t('reports.trendConversations')}</th>
                    <th className="py-1 text-right font-medium">{t('reports.trendMessages')}</th>
                    <th className="py-1 text-right font-medium">{t('reports.trendHandoffs')}</th>
                    <th className="py-1 text-right font-medium">{t('reports.trendCopies')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.daily.map((row) => (
                    <tr key={row.date} className="border-b border-slate-50 tabular-nums">
                      <td className="py-1">{row.date}</td>
                      <td className="py-1 text-right">{row.conversations}</td>
                      <td className="py-1 text-right">{row.messages}</td>
                      <td className="py-1 text-right">{row.handoffs}</td>
                      <td className="py-1 text-right">{row.copies}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('reports.intentsTitle')}</h2>
              <ul className="space-y-2.5">
                {summary.intents.map(({ intent, count }) => (
                  <li key={intent} className="grid grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-3">
                    <span className="truncate text-sm text-slate-600">{intentLabels[intent]}</span>
                    <span className="block h-2.5 rounded-full bg-slate-100">
                      <span
                        className="block h-2.5 rounded-full bg-brand-500"
                        style={{
                          width: `${Math.max((count / Math.max(...summary.intents.map((item) => item.count), 1)) * 100, count > 0 ? 2 : 0)}%`,
                        }}
                      />
                    </span>
                    <span className="text-right text-xs tabular-nums text-slate-600">{count}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('reports.questionsTitle')}</h2>
              {summary.topQuestions.length === 0 ? (
                <p className="text-sm text-slate-500">{t('reports.noData')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {summary.topQuestions.map(({ text, count }) => (
                    <li key={text} className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 break-words text-slate-700">{text}</span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-100 p-5 text-sm font-semibold text-slate-700">
              {t('reports.sitesTitle')}
            </h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="px-5 py-2 font-medium">{t('reports.site')}</th>
                  <th className="px-5 py-2 text-right font-medium">{t('reports.siteConversations')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {summary.sites.map((site) => (
                  <tr key={site.id}>
                    <td className="px-5 py-2.5 text-slate-800">{site.name}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">
                      {site.conversations}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
