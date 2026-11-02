'use client';

import {
  Check,
  ClipboardCheck,
  ClipboardCopy,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Site } from '@/lib/db';

export interface SitesLabels {
  newSite: string;
  editSite: string;
  name: string;
  siteKey: string;
  siteKeyHint: string;
  regenerate: string;
  allowedOrigins: string;
  originsHint: string;
  rateLimit: string;
  rateLimitHint: string;
  embed: string;
  embedHint: string;
  copy: string;
  copied: string;
  copyFailed: string;
  empty: string;
  deleteConfirm: string;
  deleteBlocked: string;
  error: string;
  loadFailed: string;
  originsInvalid: string;
  count: string;
  save: string;
  saving: string;
  cancel: string;
  delete: string;
  edit: string;
}

interface SiteView extends Site {
  embedSnippet: string;
}

interface Draft {
  id?: number;
  name: string;
  siteKey: string;
  origins: string;
  rateLimit: string;
}

const EMPTY_DRAFT: Draft = { name: '', siteKey: '', origins: '', rateLimit: '30' };

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Shared validation mirroring the server's rules, for instant feedback. */
function validateDraft(draft: Draft): string | null {
  if (!draft.name.trim()) return 'name';
  const origins = draft.origins
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const origin of origins) {
    if (origin === '*') return 'origins';
    try {
      const url = new URL(origin);
      if (!/^https?:$/.test(url.protocol)) return 'origins';
      if (url.username || url.password || url.search || url.hash) return 'origins';
      if (url.pathname !== '/') return 'origins';
    } catch {
      return 'origins';
    }
  }
  const rate = Number(draft.rateLimit);
  if (!Number.isInteger(rate) || rate < 1 || rate > 600) return 'rate';
  return null;
}

export function SitesManager({
  labels,
  defaultOrigins,
}: {
  labels: SitesLabels;
  defaultOrigins: string[];
}) {
  const [sites, setSites] = useState<SiteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/sites', { cache: 'no-store' });
      if (!response.ok) throw new Error('load failed');
      const body = (await response.json()) as { items: SiteView[] };
      setSites(body.items);
    } catch {
      setError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [labels.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT });
    setFormError(null);
  }

  function openEdit(site: SiteView) {
    setDraft({
      id: site.id,
      name: site.name,
      siteKey: site.siteKey,
      origins: site.allowedOrigins.join('\n'),
      rateLimit: String(site.rateLimitPerMin),
    });
    setFormError(null);
  }

  function regenerateKey() {
    if (!draft) return;
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    const key = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    setDraft({ ...draft, siteKey: key });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const invalid = validateDraft(draft);
    if (invalid) {
      setFormError(invalid === 'origins' ? labels.originsInvalid : labels.error);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: draft.name,
        allowedOrigins: draft.origins,
        rateLimitPerMin: Number(draft.rateLimit),
        ...(draft.siteKey ? { siteKey: draft.siteKey } : {}),
      };
      const response = await fetch(
        draft.id ? `/api/admin/sites/${draft.id}` : '/api/admin/sites',
        {
          method: draft.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error('save failed');
      setDraft(null);
      await load();
    } catch {
      setFormError(labels.error);
    } finally {
      setSaving(false);
    }
  }

  async function remove(site: SiteView) {
    if (!window.confirm(labels.deleteConfirm.replace('{name}', site.name))) return;
    try {
      const response = await fetch(`/api/admin/sites/${site.id}`, { method: 'DELETE' });
      if (response.status === 409) {
        setError(labels.deleteBlocked);
        return;
      }
      if (!response.ok) throw new Error('delete failed');
      await load();
    } catch {
      setError(labels.error);
    }
  }

  async function copy(id: number, text: string) {
    const ok = await copyText(text);
    if (!ok) {
      setError(labels.copyFailed);
      return;
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          {labels.count.replace('{count}', String(sites.length))}
        </span>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {labels.newSite}
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
      ) : sites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <Globe className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-3 font-medium text-slate-700">{labels.empty}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sites.map((site) => (
            <article key={site.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">{site.name}</h2>
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    {labels.siteKey}: {site.siteKey}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={labels.edit}
                    onClick={() => openEdit(site)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={labels.delete}
                    onClick={() => void remove(site)}
                    className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {labels.allowedOrigins}
                  </dt>
                  <dd className="mt-0.5 text-slate-700">
                    {site.allowedOrigins.length === 0 ? (
                      '—'
                    ) : (
                      <ul className="space-y-0.5">
                        {site.allowedOrigins.map((origin) => (
                          <li key={origin} className="font-mono text-xs">
                            {origin}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {labels.rateLimit}
                  </dt>
                  <dd className="mt-0.5 tabular-nums text-slate-700">{site.rateLimitPerMin}/min</dd>
                </div>
              </dl>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {labels.embed}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copy(site.id, site.embedSnippet)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {copiedId === site.id ? (
                      <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                    ) : (
                      <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {copiedId === site.id ? labels.copied : labels.copy}
                  </button>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
                  {site.embedSnippet}
                </pre>
                <p className="mt-1.5 text-xs text-slate-500">{labels.embedHint}</p>
              </div>
            </article>
          ))}
        </div>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-12">
          <form
            onSubmit={save}
            className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {draft.id ? labels.editSite : labels.newSite}
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
              {labels.name} *
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
                maxLength={100}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {labels.siteKey}
              <div className="mt-1 flex gap-2">
                <input
                  value={draft.siteKey}
                  onChange={(event) => setDraft({ ...draft, siteKey: event.target.value })}
                  placeholder="auto-generated"
                  maxLength={64}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={regenerateKey}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {labels.regenerate}
                </button>
              </div>
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {labels.siteKeyHint}
              </span>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {labels.allowedOrigins}
              <textarea
                value={draft.origins}
                onChange={(event) => setDraft({ ...draft, origins: event.target.value })}
                rows={3}
                placeholder={defaultOrigins.join('\n') || 'https://shop.example.com'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {labels.originsHint}
              </span>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              {labels.rateLimit}
              <input
                type="number"
                min="1"
                max="600"
                step="1"
                value={draft.rateLimit}
                onChange={(event) => setDraft({ ...draft, rateLimit: event.target.value })}
                className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {labels.rateLimitHint}
              </span>
            </label>

            {formError ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
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
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                {saving ? labels.saving : labels.save}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
