'use client';

import {
  AlertCircle,
  BookPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessagesSquare,
  Send,
  UserRoundCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConversationSummary, Message, QuickReply } from '@/lib/db';
import type { Intent } from '@/lib/intent';
import { buildKbDraftFromConversation, normalizeTag, TAGS_MAX } from '@/lib/inbox';

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
  roleAgent: string;
  roleSystem: string;
  replyPlaceholder: string;
  sendReply: string;
  replyFailed: string;
  quickReplies: string;
  quickRepliesEmpty: string;
  markHandledOnReply: string;
  tags: string;
  tagPlaceholder: string;
  addTag: string;
  removeTag: string;
  tagsHint: string;
  filterTag: string;
  clearTagFilter: string;
  note: string;
  notePlaceholder: string;
  saveNote: string;
  noteSaved: string;
  addToKb: string;
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

function queryFor(filter: Filter, page: number, tag: string | null): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(page * PAGE_SIZE));
  if (filter === 'needs_human') params.set('needsHuman', 'true');
  if (filter === 'unhandled') params.set('handled', 'false');
  if (filter === 'handled') params.set('handled', 'true');
  if (tag) params.set('tag', tag);
  return params.toString();
}

/** F4: admin URL that opens the knowledge create form prefilled. */
function kbDraftHref(draft: { title: string; content: string }): string {
  const params = new URLSearchParams({ title: draft.title, content: draft.content });
  return `/admin/knowledge?${params.toString()}`;
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
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [reply, setReply] = useState('');
  const [markHandledOnReply, setMarkHandledOnReply] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/conversations?${queryFor(filter, page, tagFilter)}`,
        { cache: 'no-store' },
      );
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
  }, [filter, page, tagFilter, labels.loadFailed]);

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
      const body = (await response.json()) as Detail;
      setDetail(body);
      setNoteDraft(body.item.note);
      setNoteSaved(false);
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

  // Load the merchant's quick replies once; a failure just hides the picker.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/quick-replies', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { items?: QuickReply[] } | null) => {
        if (!cancelled && body?.items) setQuickReplies(body.items);
      })
      .catch(() => {
        /* optional convenience */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset the drafts when the selection changes; the note is filled in by
  // loadDetail once the new conversation arrives.
  useEffect(() => {
    setReply('');
    setReplyError(null);
    setMarkHandledOnReply(false);
    setTagDraft('');
    setNoteDraft('');
    setNoteSaved(false);
  }, [selectedId]);

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

  async function sendReply() {
    if (!detail || sendingReply) return;
    const content = reply.trim();
    if (!content) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const response = await fetch(
        `/api/admin/conversations/${encodeURIComponent(detail.item.id)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, markHandled: markHandledOnReply }),
        },
      );
      if (!response.ok) throw new Error('reply failed');
      const body = (await response.json()) as { item: Message };
      setDetail((current) =>
        current
          ? {
              item: {
                ...current.item,
                handled: current.item.handled || markHandledOnReply,
                messageCount: current.item.messageCount + 1,
                lastAt: body.item.createdAt,
              },
              messages: [...current.messages, body.item],
            }
          : current,
      );
      setReply('');
      setMarkHandledOnReply(false);
      if (markHandledOnReply) await loadList();
    } catch {
      setReplyError(labels.replyFailed);
    } finally {
      setSendingReply(false);
    }
  }

  async function patchConversation(payload: Record<string, unknown>): Promise<boolean> {
    if (!detail) return false;
    const response = await fetch(
      `/api/admin/conversations/${encodeURIComponent(detail.item.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) throw new Error('patch failed');
    const body = (await response.json()) as { item: ConversationSummary };
    setDetail((current) => {
      if (!current || current.item.id !== body.item.id) return current;
      return {
        item: {
          ...current.item,
          ...body.item,
          siteName: current.item.siteName,
          messageCount: current.item.messageCount,
        },
        messages: current.messages,
      };
    });
    setItems((current) =>
      current.map((item) =>
        item.id === body.item.id
          ? { ...item, tags: body.item.tags, note: body.item.note, handled: body.item.handled }
          : item,
      ),
    );
    return true;
  }

  async function addTag() {
    if (!detail || tagSaving) return;
    const tag = normalizeTag(tagDraft);
    if (!tag || detail.item.tags.includes(tag) || detail.item.tags.length >= TAGS_MAX) return;
    setTagSaving(true);
    setError(null);
    try {
      await patchConversation({ tags: [...detail.item.tags, tag] });
      setTagDraft('');
    } catch {
      setError(labels.loadFailed);
    } finally {
      setTagSaving(false);
    }
  }

  async function removeTag(tag: string) {
    if (!detail || tagSaving) return;
    setTagSaving(true);
    setError(null);
    try {
      await patchConversation({ tags: detail.item.tags.filter((entry) => entry !== tag) });
    } catch {
      setError(labels.loadFailed);
    } finally {
      setTagSaving(false);
    }
  }

  async function saveNote() {
    if (!detail || noteSaving || noteDraft === detail.item.note) return;
    setNoteSaving(true);
    setError(null);
    setNoteSaved(false);
    try {
      await patchConversation({ note: noteDraft });
      setNoteSaved(true);
    } catch {
      setError(labels.loadFailed);
    } finally {
      setNoteSaving(false);
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
          <span className="flex items-center gap-2 text-xs text-slate-500">
            {tagFilter ? (
              <button
                type="button"
                onClick={() => {
                  setTagFilter(null);
                  setPage(0);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700 hover:bg-brand-100"
              >
                {labels.filterTag}: {tagFilter}
                <X className="h-3 w-3" aria-hidden />
                <span className="sr-only">{labels.clearTagFilter}</span>
              </button>
            ) : null}
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
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span>
                        {labels.messageCount}: {conversation.messageCount}
                      </span>
                      <span className="truncate font-mono">{conversation.visitorId || '—'}</span>
                    </div>
                    {conversation.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {conversation.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
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
                detail.messages.map((message, index) => {
                  const isUser = message.role === 'user';
                  const isAgent = message.role === 'agent';
                  const kbDraft = isUser
                    ? buildKbDraftFromConversation(detail.messages, index)
                    : null;
                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col gap-1 ${isUser ? 'items-start' : 'items-end'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                          isUser
                            ? 'rounded-bl-sm bg-slate-100 text-slate-800'
                            : isAgent
                              ? 'rounded-br-sm bg-emerald-600 text-white'
                              : 'rounded-br-sm bg-brand-600 text-white'
                        }`}
                      >
                        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                          {isUser
                            ? labels.roleUser
                            : isAgent
                              ? labels.roleAgent
                              : message.role === 'system'
                                ? labels.roleSystem
                                : labels.roleAssistant}
                        </div>
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        <div className="mt-1 text-[10px] opacity-60">{formatTime(message.createdAt)}</div>
                      </div>
                      {kbDraft ? (
                        <Link
                          href={kbDraftHref(kbDraft)}
                          className="inline-flex items-center gap-1 rounded px-1 text-[11px] text-slate-500 hover:text-brand-700"
                        >
                          <BookPlus className="h-3 w-3" aria-hidden />
                          {labels.addToKb}
                        </Link>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-3 border-t border-slate-100 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">{labels.tags}</span>
                    <span className="text-[10px] text-slate-400">
                      {detail.item.tags.length}/{TAGS_MAX}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {detail.item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                      >
                        <button
                          type="button"
                          aria-label={`${labels.filterTag}: ${tag}`}
                          onClick={() => {
                            setTagFilter(tag);
                            setPage(0);
                          }}
                          className="hover:underline"
                        >
                          {tag}
                        </button>
                        <button
                          type="button"
                          aria-label={`${labels.removeTag}: ${tag}`}
                          disabled={tagSaving}
                          onClick={() => void removeTag(tag)}
                          className="rounded-full hover:text-red-600 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void addTag();
                        }
                      }}
                      placeholder={labels.tagPlaceholder}
                      maxLength={20}
                      aria-label={labels.tagPlaceholder}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    />
                    <button
                      type="button"
                      onClick={() => void addTag()}
                      disabled={
                        tagSaving ||
                        !normalizeTag(tagDraft) ||
                        detail.item.tags.length >= TAGS_MAX
                      }
                      className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {labels.addTag}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">{labels.tagsHint}</p>
                </div>

                <div>
                  <label
                    htmlFor="conversation-note"
                    className="text-xs font-medium text-slate-600"
                  >
                    {labels.note}
                  </label>
                  <textarea
                    id="conversation-note"
                    value={noteDraft}
                    onChange={(event) => {
                      setNoteDraft(event.target.value);
                      setNoteSaved(false);
                    }}
                    placeholder={labels.notePlaceholder}
                    rows={3}
                    maxLength={2000}
                    className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                  <div className="mt-1 flex items-center justify-end gap-2">
                    {noteSaved ? (
                      <span className="text-[11px] text-emerald-600">{labels.noteSaved}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void saveNote()}
                      disabled={noteSaving || noteDraft === detail.item.note}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {labels.saveNote}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">{labels.quickReplies}</span>
                  {quickReplies.length > 0 ? (
                    <select
                      aria-label={labels.quickReplies}
                      value=""
                      onChange={(event) => {
                        const picked = quickReplies.find(
                          (item) => String(item.id) === event.target.value,
                        );
                        if (picked) setReply(picked.content);
                      }}
                      className="max-w-[14rem] rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="" disabled>
                        {labels.quickReplies}
                      </option>
                      {quickReplies.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[11px] text-slate-400">{labels.quickRepliesEmpty}</span>
                  )}
                </div>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void sendReply();
                    }
                  }}
                  placeholder={labels.replyPlaceholder}
                  rows={3}
                  maxLength={2000}
                  aria-label={labels.replyPlaceholder}
                  className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={markHandledOnReply}
                      onChange={(event) => setMarkHandledOnReply(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    {labels.markHandledOnReply}
                  </label>
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={sendingReply || reply.trim().length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {sendingReply ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Send className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {labels.sendReply}
                  </button>
                </div>
                {replyError ? (
                  <p role="alert" className="mt-1 text-[11px] text-red-600">
                    {replyError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
