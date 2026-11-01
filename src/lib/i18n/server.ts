import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  getTranslator,
  negotiateLocale,
  resolveLocale,
  type Locale,
} from './index';

/** Reads the locale from the cookie or, failing that, Accept-Language. */
export function getRequestLocale(): Locale {
  const cookieValue = cookies().get(LOCALE_COOKIE)?.value;
  if (cookieValue) return resolveLocale(cookieValue);
  return negotiateLocale(headers().get('accept-language')) ?? DEFAULT_LOCALE;
}

export function getRequestTranslator() {
  return getTranslator(getRequestLocale());
}
