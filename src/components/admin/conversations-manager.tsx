'use client';

import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessagesSquare,
  UserRoundCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConversationSummary, Message } from '@/lib/db';
import type { Intent } from '@/lib/intent';

export interface ConversationsLabels {
  title: string;
  empty: string;
  emptyHint: string;
  filterAll: string;
  filterNeedsHuman: string;
  filterUnhandled: string;
  filterHandled: string;
  site: string;
  startedAt: string;
  lastAt: string;
  messageCount: string;
  intent: string;
  status: string;
  handled: string;
  unhandled: string;
  needsHuman: string;
  markHandled: string;
  markUnhandled: string;
  detail: string;
  messages: string;
  visitor: string;
  loadFailed: string;
  selectHint: string;
  roleUser: string;
  roleAssistant: string;
  roleSystem: string;
  count: string;
  page: string;
  prev: string;
  next: string;
  intentLabels: Record<Intent, string>;
}

type Filter = 'all' | 'needs_human' | 'unhandled' | 'handled';

const PAGE_SIZE = 20;

interface Detail {
  item: ConversationSummary;
  messages: Message[];
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function queryFor(filter: Filter, page: number): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(page * PAGE_SIZE));
  if (filter === 'needs_human') params.set('needsHuman', 'true');
  if (filter === 'unhandled') params.set('handled', 'false');
  if (filter === 'handled') params.set('handled', 'true');
  return params.toString();
}

export function ConversationsManager({ labels }: { labels: ConversationsLabels }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/conversations?${queryFor(filter, page)}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('load failed');
      const body = (await response.json()) as { items: ConversationSummary[]; total: number };
      setItems(body.items);
      setTotal(body.total);
      setSelectedId((current) => {
        if (current && body.items.some((item) => item.id === current)) return current;
        return body.items[0]?.id ?? null;
      });
    } catch {
      setError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [filter, page, labels.loadFailed]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/conversations/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('detail failed');
      setDetail((await response.json()) as Detail);
    } catch {
      setError(labels.loadFailed);
    } finally {
      setDetailLoading(false);
    }
  }, [labels.loadFailed]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const filters = useMemo(
    () =>
      [
        { key: 'all' as const, label: labels.filterAll },
        { key: 'needs_human' as const, label: labels.filterNeedsHuman },
        { key: 'unhandled' as const, label: labels.filterUnhandled },
        { key: 'handled' as const, label: labels.filterHandled },
      ],
    [labels],
  );

  function changeFilter(next: Filter) {
    if (next === filter) return;
    setFilter(next);
    setPage(0);
  }

  async function toggleHandled(conversation: ConversationSummary) {
    if (updating) return;
    setUpdating(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/conversations/${encodeURIComponent(conversation.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handled: !conversation.handled }),
      });
      if (!response.ok) throw new Error('update failed');
      setItems((current) =>
        current.map((item) =>
          item.id === conversation.id ? { ...item, handled: !item.handled } : item,
        ),
      );
      setDetail((current) =>
        current && current.item.id === conversation.id
          ? { ...current, item: { ...current.item, handled: !conversation.handled } }
          : current,
      );
      // Re-run the query when a status filter is active so the row leaves the list.
      if (filter === 'handled' || filter === 'unhandled') await loadList();
    } catch {
      setError(labels.loadFailed);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
            {filters.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => changeFilter(key)}
                aria-pressed={filter === key}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  filter === key
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            {labels.count.replace('{count}', String(total))}
          </span>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-8 justify-center text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            …
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <MessagesSquare className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-3 font-medium text-slate-700">{labels.empty}</p>
            <p className="mt-1 text-sm text-slate-500">{labels.emptyHint}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((conversation) => {
              const active = conversation.id === selectedId;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(conversation.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full rounded-xl border bg-white p-4 text-left shadow-sm transition ${
                      active
                        ? 'border-brand-500 ring-2 ring-brand-100'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {labels.intentLabels[conversation.topIntent as Intent] ??
                            conversation.topIntent}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {conversation.siteName} · {formatTime(conversation.lastAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        {conversation.needsHuman ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            <AlertCircle className="h-3 w-3" aria-hidden />
                            {labels.needsHuman}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            conversation.handled
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {conversation.handled ? labels.handled : labels.unhandled}
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                      <span>
                        {labels.messageCount}: {conversation.messageCount}
                      </span>
                      <span className="truncate font-mono">{conversation.visitorId || '—'}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-xs text-slate-500">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 disabled:opacity-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              {labels.prev}
            </button>
            <span>{labels.page.replace('{page}', String(page + 1)).replace('{pages}', String(pages))}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
              disabled={page >= pages - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 disabled:opacity-50"
            >
              {labels.next}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {detailLoading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            …
          </div>
        ) : !detail ? (
          <p className="px-6 py-16 text-center text-sm text-slate-500">{labels.selectHint}</p>
        ) : (
          <div className="flex h-full max-h-[calc(100vh-9rem)] flex-col">
            <header className="border-b border-slate-100 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{labels.detail}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {detail.item.siteName} · {formatTime(detail.item.startedAt)} ·{' '}
                    {labels.visitor}: {detail.item.visitorId || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleHandled(detail.item)}
                  disabled={updating}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${
                    detail.item.handled
                      ? 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  {detail.item.handled ? (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <UserRoundCheck className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {detail.item.handled ? labels.markUnhandled : labels.markHandled}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {labels.intentLabels[detail.item.topIntent as Intent] ?? detail.item.topIntent}
                </span>
                {detail.item.needsHuman ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    {labels.needsHuman}
                  </span>
                ) : null}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    detail.item.handled
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {detail.item.handled ? labels.handled : labels.unhandled}
                </span>
              </div>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {detail.messages.length === 0 ? (
                <p className="text-center text-sm text-slate-500">{labels.empty}</p>
              ) : (
                detail.messages.map((message) => {
                  const isUser = message.role === 'user';
                  return (
                    <div key={message.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                          isUser
                            ? 'rounded-bl-sm bg-slate-100 text-slate-800'
                            : 'rounded-br-sm bg-brand-600 text-white'
                        }`}
                      >
                        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                          {isUser
                            ? labels.roleUser
                            : message.role === 'system'
                              ? labels.roleSystem
                              : labels.roleAssistant}
                        </div>
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        <div className="mt-1 text-[10px] opacity-60">{formatTime(message.createdAt)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
