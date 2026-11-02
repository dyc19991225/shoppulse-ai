'use client';

import { Loader2, MessageSquareText, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { QuickReply } from '@/lib/db';

export interface QuickRepliesLabels {
  newReply: string;
  editReply: string;
  titleField: string;
  content: string;
  contentHint: string;
  empty: string;
  emptyHint: string;
  deleteConfirm: string;
  count: string;
  loadFailed: string;
  error: string;
  save: string;
  saving: string;
  cancel: string;
  delete: string;
  edit: string;
}

interface Draft {
  id?: number;
  title: string;
  content: string;
}

const EMPTY_DRAFT: Draft = { title: '', content: '' };

/** Same master/detail-free list + modal form as the knowledge page (F2). */
export function QuickRepliesManager({ labels }: { labels: QuickRepliesLabels }) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/quick-replies', { cache: 'no-store' });
      if (!response.ok) throw new Error('load failed');
      const body = (await response.json()) as { items: QuickReply[] };
      setReplies(body.items);
    } catch {
      setError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [labels.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      setFormError(labels.error);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const url = draft.id ? `/api/admin/quick-replies/${draft.id}` : '/api/admin/quick-replies';
      const response = await fetch(url, {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, content: draft.content }),
      });
      if (!response.ok) throw new Error('save failed');
      setDraft(null);
      await load();
    } catch {
      setFormError(labels.error);
    } finally {
      setSaving(false);
    }
  }

  async function remove(reply: QuickReply) {
    if (!window.confirm(labels.deleteConfirm.replace('{title}', reply.title))) return;
    try {
      const response = await fetch(`/api/admin/quick-replies/${reply.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('delete failed');
      await load();
    } catch {
      setError(labels.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          {labels.count.replace('{count}', String(replies.length))}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft({ ...EMPTY_DRAFT });
            setFormError(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {labels.newReply}
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </div>
      ) : replies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <MessageSquareText className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-3 font-medium text-slate-700">{labels.empty}</p>
          <p className="mt-1 text-sm text-slate-500">{labels.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {replies.map((reply) => (
                <tr key={reply.id} className="align-top hover:bg-slate-50/60">
                  <td className="w-full px-4 py-3">
                    <span className="font-medium text-slate-900">{reply.title}</span>
                    <p className="mt-1 whitespace-pre-wrap line-clamp-3 max-w-3xl text-slate-600">
                      {reply.content}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={labels.edit}
                        onClick={() => {
                          setDraft({ id: reply.id, title: reply.title, content: reply.content });
                          setFormError(null);
                        }}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={labels.delete}
                        onClick={() => remove(reply)}
                        className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16">
          <form onSubmit={save} className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {draft.id ? labels.editReply : labels.newReply}
              </h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label={labels.cancel}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              {labels.titleField}
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                required
                maxLength={100}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {labels.content}
              <textarea
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                required
                rows={6}
                maxLength={2000}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              />
              <span className="mt-1 block text-xs font-normal text-slate-400">{labels.contentHint}</span>
            </label>

            {formError ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                {labels.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {saving ? labels.saving : labels.save}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
