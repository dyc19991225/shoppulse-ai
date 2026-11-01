import type { DictionaryKey } from './zh';

/** English dictionary; every zh key must be present. */
export const en: Record<DictionaryKey, string> = {
  'app.name': 'ShopPulse AI',
  'app.tagline': 'AI customer service and marketing copy for small retailers',

  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.create': 'New',
  'common.search': 'Search',
  'common.logout': 'Log out',
  'common.language': 'Language',
  'common.demoMode': 'Demo mode',
  'common.backHome': 'Back to home',
  'common.error': 'Something went wrong. Please try again.',

  'nav.dashboard': 'Overview',
  'nav.knowledge': 'Knowledge',
  'nav.products': 'Products',
  'nav.copywriting': 'Copy studio',
  'nav.conversations': 'Conversations',
  'nav.sites': 'Site settings',

  'login.title': 'Merchant sign-in',
  'login.subtitle': 'Manage your knowledge base, products, copy and conversations',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.invalid': 'Incorrect username or password',
  'login.rateLimited': 'Too many attempts. Please try again in a minute.',
  'login.notConfigured':
    'Admin credentials are not configured. Set ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD in development).',
  'login.serverError': 'Server error. Please try again later.',

  'widget.launcher': 'Chat with us',
  'widget.title': 'Customer support',
  'widget.placeholder': 'Type your question…',
  'widget.send': 'Send',
  'widget.handoff': 'Connecting you to a human agent, please wait',
  'widget.error': 'Network error. Please try again.',
  'widget.poweredBy': 'Powered by ShopPulse AI',
};
