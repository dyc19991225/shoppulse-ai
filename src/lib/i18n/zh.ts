/** Simplified Chinese (default). Keys are flat with dot-notation groups. */
export const zh = {
  'app.name': 'ShopPulse AI',
  'app.tagline': '面向中小商家的 AI 客服与营销文案助手',

  'common.loading': '加载中…',
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.create': '新建',
  'common.search': '搜索',
  'common.logout': '退出登录',
  'common.language': '语言',
  'common.demoMode': '演示模式',
  'common.backHome': '返回首页',
  'common.error': '出错了，请稍后重试',

  'nav.dashboard': '总览',
  'nav.knowledge': '知识库',
  'nav.products': '商品',
  'nav.copywriting': '文案工作台',
  'nav.conversations': '会话记录',
  'nav.sites': '站点设置',

  'login.title': '商家登录',
  'login.subtitle': '登录后管理知识库、商品、文案与会话',
  'login.username': '用户名',
  'login.password': '密码',
  'login.submit': '登录',
  'login.submitting': '登录中…',
  'login.invalid': '用户名或密码错误',
  'login.rateLimited': '尝试次数过多，请一分钟后再试',
  'login.notConfigured': '管理员凭据未配置，请设置 ADMIN_PASSWORD_HASH（或开发环境 ADMIN_PASSWORD）',
  'login.serverError': '服务器错误，请稍后重试',

  'widget.launcher': '在线客服',
  'widget.title': '在线客服',
  'widget.placeholder': '请输入您的问题…',
  'widget.send': '发送',
  'widget.handoff': '已为您转接人工客服，请稍候',
  'widget.error': '网络异常，请稍后重试',
  'widget.poweredBy': '由 ShopPulse AI 提供支持',
} as const;

export type DictionaryKey = keyof typeof zh;
