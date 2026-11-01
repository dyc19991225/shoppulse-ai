import { zh, type DictionaryKey } from './zh';
import { en } from './en';

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';
export const LOCALE_COOKIE = 'shoppulse_locale';

export type Dictionary = Record<DictionaryKey, string>;

export const dictionaries: Record<Locale, Dictionary> = { zh, en };

export type TranslateVars = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Resolves a locale from a cookie value, falling back to the default. */
export function resolveLocale(cookieValue: string | undefined | null): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

/**
 * Picks the best supported locale from an Accept-Language header.
 * `q=0` entries are skipped; unknown languages fall back to Chinese.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const entries = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((param) => param.trim().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Looks up `key` and replaces `{name}` placeholders. */
export function translate(locale: Locale, key: DictionaryKey, vars?: TranslateVars): string {
  const template = dictionaries[locale][key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Builds a translator bound to a locale. */
export function getTranslator(locale: Locale) {
  return (key: DictionaryKey, vars?: TranslateVars) => translate(locale, key, vars);
}

export type Translator = ReturnType<typeof getTranslator>;

export { zh, en };
export type { DictionaryKey };
