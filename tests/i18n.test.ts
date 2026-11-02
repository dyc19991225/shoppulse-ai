import { describe, expect, it } from 'vitest';
import {
  dictionaries,
  en,
  getTranslator,
  isLocale,
  LOCALES,
  negotiateLocale,
  resolveLocale,
  translate,
  zh,
} from '@/lib/i18n';

describe('dictionaries', () => {
  it('zh and en have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it('has no empty strings', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('translates and interpolates variables', () => {
    expect(translate('zh', 'login.title')).toBe('商家登录');
    expect(translate('en', 'login.title')).toBe('Merchant sign-in');
    expect(
      translate('en', 'widget.handoff', { ignored: 'x' }),
    ).toBe('Your human-agent request has been recorded for our staff');
  });
});

describe('locale helpers', () => {
  it('validates locale values', () => {
    expect(isLocale('zh')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('resolves cookie values with fallback to zh', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('de')).toBe('zh');
    expect(resolveLocale(undefined)).toBe('zh');
  });

  it('negotiates Accept-Language with q-values', () => {
    expect(negotiateLocale('en-US,en;q=0.9,zh;q=0.8')).toBe('en');
    expect(negotiateLocale('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh');
    expect(negotiateLocale('fr,de;q=0.8,en;q=0.5')).toBe('en');
    expect(negotiateLocale('fr-FR,de;q=0.9')).toBe('zh');
    expect(negotiateLocale('en;q=0')).toBe('zh');
    expect(negotiateLocale(null)).toBe('zh');
    expect(negotiateLocale('')).toBe('zh');
  });

  it('binds a translator', () => {
    const t = getTranslator('en');
    expect(t('common.save')).toBe('Save');
  });
});
