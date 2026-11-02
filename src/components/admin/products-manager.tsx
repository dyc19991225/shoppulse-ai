'use client';

import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Product } from '@/lib/db';
import type { ImportResult } from '@/lib/importer';

export interface ProductsLabels {
  newProduct: string;
  editProduct: string;
  searchPlaceholder: string;
  empty: string;
  emptyHint: string;
  name: string;
  sku: string;
  category: string;
  price: string;
  stock: string;
  description: string;
  sellingPoints: string;
  imageUrl: string;
  url: string;
  enabledHint: string;
  deleteConfirm: string;
  importLabel: string;
  importing: string;
  importHint: string;
  importResult: string;
  importErrors: string;
  row: string;
  downloadTemplate: string;
  invalidUrl: string;
  count: string;
  loadFailed: string;
  error: string;
  save: string;
  saving: string;
  cancel: string;
  delete: string;
  edit: string;
  enabled: string;
  disabled: string;
  status: string;
  product: string;
}

interface Draft {
  id?: number;
  name: string;
  sku: string;
  category: string;
  price: string;
  stock: string;
  description: string;
  sellingPoints: string;
  imageUrl: string;
  url: string;
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  sku: '',
  category: '',
  price: '0',
  stock: '0',
  description: '',
  sellingPoints: '',
  imageUrl: '',
  url: '',
  enabled: true,
};

function isHttpUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ProductsManager({ labels }: { labels: ProductsLabels }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (query = '') => {
      setLoading(true);
      setError(null);
      try {
        const params = query ? `?search=${encodeURIComponent(query)}` : '';
        const response = await fetch(`/api/admin/products${params}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('load failed');
        const body = (await response.json()) as { items: Product[] };
        setProducts(body.items);
      } catch {
        setError(labels.loadFailed);
      } finally {
        setLoading(false);
      }
    },
    [labels.loadFailed],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;

    if (!draft.name.trim()) {
      setFormError(labels.error);
      return;
    }
    if (!isHttpUrl(draft.imageUrl) || !isHttpUrl(draft.url)) {
      setFormError(labels.invalidUrl);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: draft.name,
        sku: draft.sku,
        category: draft.category,
        price: Number(draft.price) || 0,
        stock: Number(draft.stock) || 0,
        description: draft.description,
        sellingPoints: draft.sellingPoints,
        imageUrl: draft.imageUrl,
        url: draft.url,
        enabled: draft.enabled,
      };
      const url = draft.id ? `/api/admin/products/${draft.id}` : '/api/admin/products';
      const response = await fetch(url, {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('save failed');
      setDraft(null);
      await load(search.trim());
    } catch {
      setFormError(labels.error);
    } finally {
      setSaving(false);
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(labels.deleteConfirm.replace('{name}', product.name))) return;
    try {
      const response = await fetch(`/api/admin/products/${product.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('delete failed');
      await load(search.trim());
    } catch {
      setError(labels.error);
    }
  }

  async function uploadFile(file: File) {
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const data = new FormData();
      data.append('file', file);
      const response = await fetch('/api/admin/products/import', { method: 'POST', body: data });
      const body = (await response.json()) as Partial<ImportResult> & { error?: string };
      if (!response.ok || typeof body.created !== 'number') {
        throw new Error(body.error ?? 'import failed');
      }
      setImportResult(body as ImportResult);
      await load(search.trim());
    } catch {
      setError(labels.error);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadFile(file);
  }

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT });
    setFormError(null);
  }

  function openEdit(product: Product) {
    setDraft({
      id: product.id,
      name: product.name,
      sku: product.sku ?? '',
      category: product.category,
      price: String(product.price),
      stock: String(product.stock),
      description: product.description,
      sellingPoints: product.sellingPoints,
      imageUrl: product.imageUrl,
      url: product.url,
      enabled: product.enabled,
    });
    setFormError(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void load(search.trim());
            }}
            className="relative"
          >
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={labels.searchPlaceholder}
              className="w-72 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </form>
          <span className="text-xs text-slate-500">
            {labels.count.replace('{count}', String(products.length))}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/admin/products/template"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100 text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {labels.downloadTemplate}
          </a>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            {importing ? labels.importing : labels.importLabel}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={onFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {labels.newProduct}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">{labels.importHint}</p>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {importResult ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-start gap-2 text-slate-700">
              {importResult.failed > 0 ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
              )}
              {labels.importResult
                .replace('{created}', String(importResult.created))
                .replace('{updated}', String(importResult.updated))
                .replace('{failed}', String(importResult.failed))}
            </p>
            <button
              type="button"
              onClick={() => setImportResult(null)}
              aria-label={labels.cancel}
              className="rounded p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {importResult.errors.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-600">
                {labels.importErrors} ({importResult.errors.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-red-700">
                {importResult.errors.slice(0, 50).map((rowError) => (
                  <li key={rowError.row}>
                    {labels.row.replace('{row}', String(rowError.row))}: {rowError.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <Package className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-3 font-medium text-slate-700">{labels.empty}</p>
          <p className="mt-1 text-sm text-slate-500">{labels.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">{labels.product}</th>
                <th className="px-4 py-2.5 font-medium">{labels.sku}</th>
                <th className="px-4 py-2.5 font-medium">{labels.category}</th>
                <th className="px-4 py-2.5 text-right font-medium">{labels.price}</th>
                <th className="px-4 py-2.5 text-right font-medium">{labels.stock}</th>
                <th className="px-4 py-2.5 font-medium">{labels.status}</th>
                <th className="px-4 py-2.5 text-right font-medium">{labels.edit}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.imageUrl}
                          alt=""
                          className="h-9 w-9 rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded bg-slate-100">
                          <Package className="h-4 w-4 text-slate-400" aria-hidden />
                        </span>
                      )}
                      <span className="font-medium text-slate-900">{product.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {product.sku ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{product.category || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    ¥{product.price.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {product.stock}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        product.enabled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {product.enabled ? labels.enabled : labels.disabled}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      aria-label={labels.edit}
                      onClick={() => openEdit(product)}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={labels.delete}
                      onClick={() => remove(product)}
                      className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-12">
          <form
            onSubmit={save}
            className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {draft.id ? labels.editProduct : labels.newProduct}
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

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                {labels.name} *
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  required
                  maxLength={200}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {labels.sku}
                <input
                  value={draft.sku}
                  onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
                  maxLength={100}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {labels.category}
                <input
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                  maxLength={100}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {labels.price}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.price}
                  onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {labels.stock}
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.stock}
                  onChange={(event) => setDraft({ ...draft, stock: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                {labels.description}
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  rows={3}
                  maxLength={5000}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                {labels.sellingPoints}
                <textarea
                  value={draft.sellingPoints}
                  onChange={(event) => setDraft({ ...draft, sellingPoints: event.target.value })}
                  rows={2}
                  maxLength={1000}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                {labels.imageUrl}
                <input
                  value={draft.imageUrl}
                  onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
                  placeholder="https://"
                  maxLength={2000}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                {labels.url}
                <input
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  placeholder="https://"
                  maxLength={2000}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              {labels.enabled}
              <span className="text-xs text-slate-400">— {labels.enabledHint}</span>
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
