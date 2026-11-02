/**
 * Copywriting constants shared by the admin client UI and the server pipeline.
 * Kept free of Node built-ins so it can be bundled into the browser.
 */

export const COPY_PLATFORMS = ['xiaohongshu', 'moments', 'detail', 'douyin'] as const;
export type CopyPlatform = (typeof COPY_PLATFORMS)[number];

export const COPY_TONES = ['lively', 'professional', 'warm', 'premium', 'humorous'] as const;
export type CopyTone = (typeof COPY_TONES)[number];

export const PLATFORM_LABELS: Record<CopyPlatform, { zh: string; en: string }> = {
  xiaohongshu: { zh: '小红书', en: 'Xiaohongshu' },
  moments: { zh: '朋友圈', en: 'Moments' },
  detail: { zh: '电商详情页', en: 'Product detail page' },
  douyin: { zh: '抖音脚本', en: 'Douyin script' },
};

export const TONE_LABELS: Record<CopyTone, { zh: string; en: string }> = {
  lively: { zh: '活泼', en: 'Lively' },
  professional: { zh: '专业', en: 'Professional' },
  warm: { zh: '温馨', en: 'Warm' },
  premium: { zh: '高级感', en: 'Premium' },
  humorous: { zh: '幽默', en: 'Humorous' },
};

export function isCopyPlatform(value: unknown): value is CopyPlatform {
  return typeof value === 'string' && (COPY_PLATFORMS as readonly string[]).includes(value);
}

export function isCopyTone(value: unknown): value is CopyTone {
  return typeof value === 'string' && (COPY_TONES as readonly string[]).includes(value);
}
