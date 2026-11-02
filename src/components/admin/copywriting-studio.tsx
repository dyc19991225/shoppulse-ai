'use client';

import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  ClipboardCopy,
  History,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COPY_PLATFORMS,
  COPY_TONES,
  type CopyPlatform,
  type CopyTone,
} from '@/lib/copywriting-shared';
import type { CopyHistoryEntry, Product } from '@/lib/db';
import type { Locale } from '@/lib/i18n';

export interface CopywritingLabels {
  product: string;
  selectProduct: string;
  noProducts: string;
  audience: string;
  audiencePlaceholder: string;
  sellingPoints: string;
  sellingPointsPlaceholder: string;
  sellingPointsHint: string;
  tone: string;
  platforms: string;
  generate: string;
  generating: string;
  results: string;
  empty: string;
  copy: string;
  copied: string;
  copyFailed: string;
  warnings: string;
  blocked: string;
  generationFailed: string;
  history: string;
  historyEmpty: string;
  historyItem: string;
  loadFailed: string;
  error: string;
  noPlatform: string;
  noProduct: string;
  mockBadge: string;
  platformLabels: Record<CopyPlatform, string>;
  toneLabels: Record<CopyTone, string>;
}

interface PlatformCopy {
  platform: CopyPlatform;
  title: string;
  body: string;
  text: string;
  warnings: string[];
  blocked: boolean;
  error?: string;
}

interface HistoryView {
  id: string;
  productName: string;
  createdAt: string;
  outputs: PlatformCopy[];
}

/** Clipboard with a textarea fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
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

function historyToView(entry: CopyHistoryEntry, labels: CopywritingLabels): HistoryView {
  const outputs = Array.isArray((entry.outputs as { items?: unknown }).items)
    ? ((entry.outputs as { items: PlatformCopy[] }).items ?? [])
    : [];
  return {
    id: entry.id,
    productName:
      typeof entry.params.productName === 'string' ? entry.params.productName : labels.product,
    createdAt: entry.createdAt,
    outputs,
  };
}

export function CopywritingStudio({
  labels,
  locale,
}: {
  labels: CopywritingLabels;
  locale: Locale;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productId, setProductId] = useState('');
  const [audience, setAudience] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [tone, setTone] = useState<CopyTone>('lively');
  const [platforms, setPlatforms] = useState<CopyPlatform[]>([...COPY_PLATFORMS]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const [outputs, setOutputs] = useState<PlatformCopy[]>([]);
  const [copied, setCopied] = useState<CopyPlatform | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryView[]>([]);
  const [activeHistory, setActiveHistory] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const response = await fetch('/api/admin/products', { cache: 'no-store' });
      if (!response.ok) throw new Error('load failed');
      const body = (await response.json()) as { items: Product[] };
      setProducts(body.items);
      if (body.items.length > 0) {
        setProductId((current) => current || String(body.items[0].id));
      }
    } catch {
      setError(labels.loadFailed);
    } finally {
      setLoadingProducts(false);
    }
  }, [labels.loadFailed]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/copywrite?limit=20', { cache: 'no-store' });
      if (!response.ok) throw new Error('load failed');
      const body = (await response.json()) as { items: CopyHistoryEntry[] };
      setHistory(body.items.map((entry) => historyToView(entry, labels)));
    } catch {
      // History is secondary; keep the main form usable.
    }
  }, [labels]);

  useEffect(() => {
    void loadProducts();
    void loadHistory();
  }, [loadProducts, loadHistory]);

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === productId) ?? null,
    [products, productId],
  );

  function togglePlatform(platform: CopyPlatform) {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    );
  }

  async function generate() {
    if (generating) return;
    if (!productId) {
      setError(labels.noProduct);
      return;
    }
    if (platforms.length === 0) {
      setError(labels.noPlatform);
      return;
    }

    setGenerating(true);
    setError(null);
    setCopyError(null);
    setActiveHistory(null);
    try {
      const response = await fetch('/api/admin/copywrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: Number(productId),
          audience,
          sellingPoints,
          tone,
          platforms,
          lang: locale,
        }),
      });
      if (!response.ok) throw new Error('generate failed');
      const body = (await response.json()) as {
        outputs: PlatformCopy[];
        mock: boolean;
      };
      setOutputs(body.outputs);
      setMock(body.mock);
      await loadHistory();
    } catch {
      setError(labels.error);
    } finally {
      setGenerating(false);
    }
  }

  async function copy(platform: CopyPlatform, text: string) {
    setCopyError(null);
    const ok = await copyText(text);
    if (!ok) {
      setCopyError(labels.copyFailed);
      return;
    }
    setCopied(platform);
    window.setTimeout(() => setCopied((current) => (current === platform ? null : current)), 2000);
  }

  function showHistory(entry: HistoryView) {
    setActiveHistory(entry.id);
    setOutputs(entry.outputs);
    setMock(false);
    setError(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      {/* Form */}
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {labels.sellingPointsHint}
        </p>

        <label className="block text-sm font-medium text-slate-700">
          {labels.product}
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            disabled={loadingProducts || products.length === 0}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {products.length === 0 ? (
              <option value="">{labels.noProducts}</option>
            ) : (
              <>
                <option value="">{labels.selectProduct}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                    {product.price ? ` · ¥${product.price.toFixed(2)}` : ''}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {labels.audience}
          <input
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            placeholder={labels.audiencePlaceholder}
            maxLength={300}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {labels.sellingPoints}
          <textarea
            value={sellingPoints}
            onChange={(event) => setSellingPoints(event.target.value)}
            placeholder={
              selectedProduct?.sellingPoints
                ? selectedProduct.sellingPoints
                : labels.sellingPointsPlaceholder
            }
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {labels.tone}
          <select
            value={tone}
            onChange={(event) => setTone(event.target.value as CopyTone)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {COPY_TONES.map((option) => (
              <option key={option} value={option}>
                {labels.toneLabels[option]}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">{labels.platforms}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {COPY_PLATFORMS.map((platform) => {
              const checked = platforms.includes(platform);
              return (
                <label
                  key={platform}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    checked
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePlatform(platform)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  {labels.platformLabels[platform]}
                </label>
              );
            })}
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={generate}
          disabled={generating || products.length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {generating ? labels.generating : labels.generate}
        </button>
      </section>

      {/* Results + history */}
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {labels.results}
            </h2>
            {mock ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                {labels.mockBadge}
              </span>
            ) : null}
          </div>

          {copyError ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {copyError}
            </p>
          ) : null}

          {outputs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
              {labels.empty}
            </p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {outputs.map((output) => (
                <article
                  key={output.platform}
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-slate-900">
                      {labels.platformLabels[output.platform]}
                    </h3>
                    {output.text ? (
                      <button
                        type="button"
                        onClick={() => void copy(output.platform, output.text)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {copied === output.platform ? (
                          <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                        ) : (
                          <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {copied === output.platform ? labels.copied : labels.copy}
                      </button>
                    ) : null}
                  </div>

                  {output.blocked ? (
                    <p className="mt-3 flex items-start gap-2 text-sm text-red-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {labels.blocked}
                    </p>
                  ) : output.error ? (
                    <p className="mt-3 text-sm text-amber-700">{labels.generationFailed}</p>
                  ) : (
                    <pre className="mt-3 flex-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700">
                      {output.text}
                    </pre>
                  )}

                  {output.warnings.length > 0 ? (
                    <details className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <summary className="cursor-pointer font-medium">
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                        {labels.warnings} ({output.warnings.length})
                      </summary>
                      <ul className="mt-1 list-inside list-disc space-y-1">
                        {output.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <History className="h-4 w-4" aria-hidden />
            {labels.history}
          </h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{labels.historyEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {history.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => showHistory(entry)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 ${
                      activeHistory === entry.id ? 'bg-brand-50/60' : ''
                    }`}
                  >
                    <span className="min-w-0 truncate text-slate-700">
                      {labels.historyItem
                        .replace('{product}', entry.productName)
                        .replace('{count}', String(entry.outputs.length))}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                      {activeHistory === entry.id ? (
                        <Check className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                      ) : null}
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
