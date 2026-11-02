/**
 * ShopPulse AI chat widget — vanilla JS, no dependencies.
 *
 * Usage:
 *   <script src="https://your-domain/widget.js" data-site-key="..." async></script>
 *
 * Design notes:
 * - Rendered inside a Shadow DOM so host page CSS cannot leak in or out.
 * - All user- and model-provided text is inserted with textContent only.
 * - Streaming uses fetch + ReadableStream over POST, parsed as SSE manually.
 */

(function () {
  'use strict';

  if (window.__shoppulseWidgetLoaded) return;
  window.__shoppulseWidgetLoaded = true;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i -= 1) {
      if (/(^|\/)widget\.js(\?|$)/.test(scripts[i].src || '')) {
        script = scripts[i];
        break;
      }
    }
  }
  if (!script) return;

  var SITE_KEY = script.getAttribute('data-site-key') || '';
  var LOCALE_ATTR = script.getAttribute('data-locale') || '';
  var API_BASE = (
    script.getAttribute('data-api-base') ||
    new URL(script.src, window.location.href).origin
  ).replace(/\/+$/, '');

  if (!SITE_KEY) {
    console.warn('[ShopPulse] Missing data-site-key; widget disabled.');
    return;
  }

  var VISITOR_KEY = 'shoppulse_visitor_id';
  var CONV_KEY = 'shoppulse_conversation_id:' + SITE_KEY;
  var LOCALE_KEY = 'shoppulse_locale';
  /** Set when this conversation is watched for merchant replies (F3). */
  var WATCH_KEY = 'shoppulse_agent_watch:' + SITE_KEY;
  var MAX_LENGTH = 1000;
  var POLL_INTERVAL_MS = 5000;

  var STRINGS = {
    zh: {
      launcher: '在线客服',
      title: '在线客服',
      subtitle: '通常几秒内回复',
      placeholder: '请输入您的问题…',
      send: '发送',
      close: '关闭',
      handoff: '已记录您的转人工请求，客服会在营业时间内查看并尽快回复。',
      error: '网络异常，请稍后重试。',
      empty: '请输入问题后再发送。',
      tooLong: '消息不能超过 {max} 个字符。',
      poweredBy: '由 ShopPulse AI 提供支持',
      productCta: '查看商品',
      demoMode: '演示模式',
      agent: '人工客服',
    },
    en: {
      launcher: 'Chat with us',
      title: 'Customer support',
      subtitle: 'We usually reply in seconds',
      placeholder: 'Type your question…',
      send: 'Send',
      close: 'Close',
      handoff: 'Your request for a human agent has been recorded for our staff, who will review it during business hours.',
      error: 'Network error. Please try again.',
      empty: 'Please type a question first.',
      tooLong: 'Messages can be at most {max} characters.',
      poweredBy: 'Powered by ShopPulse AI',
      productCta: 'View product',
      demoMode: 'Demo mode',
      agent: 'Support agent',
    },
  };

  function detectLocale() {
    if (LOCALE_ATTR === 'zh' || LOCALE_ATTR === 'en') return LOCALE_ATTR;
    try {
      var saved = window.localStorage.getItem(LOCALE_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) {
      /* storage blocked */
    }
    var lang = (navigator.language || 'zh').toLowerCase();
    return lang.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  var state = {
    locale: detectLocale(),
    open: false,
    sending: false,
    conversationId: readStorage(CONV_KEY),
    visitorId: ensureVisitorId(),
    /** F5: first assistant bubble from /api/widget/config (never stored). */
    welcomeMessage: '',
    configLoaded: false,
    configLoading: false,
    /** F3: conversation watched for merchant replies (handoff happened). */
    needsHuman: false,
    watchConversationId: readStorage(WATCH_KEY) || '',
    lastAgentAt: '',
    polling: false,
    pollingRequest: false,
    renderedAgentIds: {},
  };
  var pollTimer = null;

  function t(key, vars) {
    var table = STRINGS[state.locale] || STRINGS.zh;
    var text = table[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.replace('{' + name + '}', String(vars[name]));
      });
    }
    return text;
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      if (value === null || value === undefined) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) {
      /* storage blocked */
    }
  }

  function ensureVisitorId() {
    var existing = readStorage(VISITOR_KEY);
    if (existing) return existing;
    // The visitor id doubles as the credential for resuming a conversation,
    // so prefer a cryptographically random UUID (never a guessable counter).
    var generated;
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        generated = 'v-' + window.crypto.randomUUID();
      }
    } catch (e) {
      /* fall through */
    }
    if (!generated) {
      var bytes = '';
      try {
        var buffer = new Uint8Array(16);
        window.crypto.getRandomValues(buffer);
        for (var i = 0; i < buffer.length; i += 1) {
          bytes += ('0' + buffer[i].toString(16)).slice(-2);
        }
      } catch (e) {
        bytes = Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      }
      generated = 'v-' + bytes;
    }
    writeStorage(VISITOR_KEY, generated);
    return generated;
  }

  // ---------------------------------------------------------------------------
  // Styles (inside the shadow root, so they are isolated)
  // ---------------------------------------------------------------------------

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    // The UA `[hidden]{display:none}` rule is overridden by the author
    // `.launcher{display:flex}` / `.panel{display:flex}` rules below (author
    // styles beat UA styles at equal specificity), which made `hidden` inert.
    // Pin it back so panel/launcher/badge visibility is actually honored.
    '[hidden]{display:none!important}',
    '.root{position:fixed;right:24px;bottom:24px;z-index:2147483000;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
    'font-size:14px;line-height:1.5;color:#0f172a}',
    '.launcher{display:flex;align-items:center;gap:8px;border:none;border-radius:9999px;',
    'padding:13px 19px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:14px;font-weight:650;cursor:pointer;',
    'box-shadow:0 12px 30px rgba(79,70,229,.32);transition:transform .15s ease,filter .15s ease}',
    '.launcher:hover{filter:brightness(1.08);transform:translateY(-2px)}',
    '.launcher svg{width:20px;height:20px;flex:none}',
    '.panel{position:absolute;right:0;bottom:0;width:360px;max-width:calc(100vw - 32px);',
    'height:560px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;',
    'background:#fff;border-radius:22px;overflow:hidden;border:1px solid #e2e8f0;',
    'box-shadow:0 28px 80px rgba(15,23,42,.24)}',
    '.header{display:flex;align-items:center;gap:11px;padding:16px;background:linear-gradient(135deg,#4338ca,#7c3aed);color:#fff}',
    '.avatar{display:flex;align-items:center;justify-content:center;width:34px;height:34px;',
    'border-radius:14px;background:rgba(255,255,255,.18);flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}',
    '.avatar svg{width:18px;height:18px}',
    '.header-text{min-width:0;flex:1}',
    '.header-title{font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px}',
    '.header-sub{font-size:12px;opacity:.82;margin-top:3px;display:flex;align-items:center;gap:6px}',
    '.header-sub:before{content:"";width:7px;height:7px;border-radius:50%;background:#86efac;box-shadow:0 0 0 3px rgba(134,239,172,.18)}',
    '.badge{font-size:10px;font-weight:500;padding:1px 6px;border-radius:9999px;',
    'background:rgba(255,255,255,.22);text-transform:uppercase;letter-spacing:.04em}',
    '.icon-btn{background:transparent;border:none;color:#fff;cursor:pointer;padding:6px;',
    'border-radius:8px;display:flex;align-items:center;justify-content:center}',
    '.icon-btn:hover{background:rgba(255,255,255,.16)}',
    '.icon-btn svg{width:18px;height:18px}',
    '.messages{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,#f8fafc,#f5f6fb)}',
    '.msg{max-width:82%;padding:10px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word;',
    'font-size:13.5px;line-height:1.55}',
    '.msg.user{align-self:flex-end;background:linear-gradient(135deg,#4f46e5,#6d28d9);color:#fff;border-bottom-right-radius:5px;box-shadow:0 4px 10px rgba(79,70,229,.14)}',
    '.msg.bot{align-self:flex-start;background:#fff;color:#0f172a;border:1px solid #e2e8f0;',
    'border-bottom-left-radius:5px;box-shadow:0 3px 10px rgba(15,23,42,.04)}',
    '.msg.agent{align-self:flex-start;background:#ecfdf5;color:#064e3b;border:1px solid #a7f3d0;',
    'border-bottom-left-radius:5px;box-shadow:0 3px 10px rgba(6,78,59,.06)}',
    '.msg.agent .msg-label{display:block;margin-bottom:3px;font-size:10.5px;font-weight:600;',
    'text-transform:uppercase;letter-spacing:.04em;color:#047857}',
    '.msg.notice{align-self:stretch;max-width:100%;background:#fffbeb;color:#92400e;border:1px solid #fde68a;border-radius:12px;',
    'font-size:12.5px;text-align:center}',
    '.msg.error{align-self:stretch;max-width:100%;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;',
    'font-size:12.5px;text-align:center}',
    '.typing{display:inline-flex;gap:4px;align-items:center;height:14px}',
    '.typing span{width:5px;height:5px;border-radius:9999px;background:#94a3b8;animation:blink 1.2s infinite}',
    '.typing span:nth-child(2){animation-delay:.2s}',
    '.typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}',
    '.products{display:flex;gap:8px;overflow-x:auto;padding:2px 0 4px;align-self:stretch}',
    '.card{flex:0 0 180px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,.06);',
    'display:flex;flex-direction:column}',
    '.card img{width:100%;height:96px;object-fit:cover;background:#f1f5f9;display:block}',
    '.card-body{padding:8px 10px 10px;display:flex;flex-direction:column;gap:4px}',
    '.card-name{font-size:12.5px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.card-price{font-size:14px;font-weight:700;color:#4f46e5}',
    '.card-meta{font-size:11px;color:#64748b}',
    '.card-link{font-size:12px;font-weight:600;color:#4f46e5;text-decoration:none;margin-top:2px}',
    '.card-link:hover{text-decoration:underline}',
    '.composer{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #e2e8f0;background:#fff}',
    '.composer textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:9px 11px;',
    'font:inherit;font-size:13.5px;line-height:1.4;max-height:96px;outline:none;color:#0f172a;background:#fff}',
    '.composer textarea:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.14)}',
    '.send{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border:none;',
    'border-radius:12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;cursor:pointer;flex:none;box-shadow:0 4px 10px rgba(79,70,229,.2)}',
    '.send:disabled{background:#cbd5e1;cursor:not-allowed}',
    '.send svg{width:17px;height:17px}',
    '.footer{padding:6px 12px 8px;text-align:center;font-size:10.5px;color:#94a3b8;background:#fff}',
    '.footer a{color:#94a3b8}',
    '.launcher:focus-visible,.icon-btn:focus-visible,.send:focus-visible,.card-link:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}',
    '@media (max-width:600px){.root{inset:0;right:auto;bottom:auto}.panel{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;border-radius:0;border:0}.launcher{position:fixed;right:16px;bottom:16px}.header{padding-top:max(16px,env(safe-area-inset-top))}.composer{padding-bottom:max(10px,env(safe-area-inset-bottom))}}',
  ].join('');

  var ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  var host = document.createElement('div');
  host.setAttribute('data-shoppulse-widget', '');
  var shadow;
  try {
    shadow = host.attachShadow({ mode: 'open' });
  } catch (e) {
    shadow = host.attachShadow({ mode: 'closed' });
  }

  var style = document.createElement('style');
  style.textContent = CSS;

  var root = document.createElement('div');
  root.className = 'root';

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', t('launcher'));
  launcher.setAttribute('aria-expanded', 'false');
  setIcon(launcher, ICONS.chat);
  var launcherLabel = document.createElement('span');
  launcherLabel.textContent = t('launcher');
  launcher.appendChild(launcherLabel);

  var panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', t('title'));
  panel.hidden = true;

  var header = document.createElement('div');
  header.className = 'header';

  var avatar = document.createElement('div');
  avatar.className = 'avatar';
  setIcon(avatar, ICONS.spark);
  header.appendChild(avatar);

  var headerText = document.createElement('div');
  headerText.className = 'header-text';
  var headerTitle = document.createElement('div');
  headerTitle.className = 'header-title';
  var titleSpan = document.createElement('span');
  titleSpan.textContent = t('title');
  headerTitle.appendChild(titleSpan);
  var badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = t('demoMode');
  badge.hidden = true;
  headerTitle.appendChild(badge);
  headerText.appendChild(headerTitle);
  var headerSub = document.createElement('div');
  headerSub.className = 'header-sub';
  headerSub.textContent = t('subtitle');
  headerText.appendChild(headerSub);
  header.appendChild(headerText);

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.setAttribute('aria-label', t('close'));
  setIcon(closeBtn, ICONS.close);
  closeBtn.addEventListener('click', function () {
    setOpen(false);
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  var messagesEl = document.createElement('div');
  messagesEl.className = 'messages';
  messagesEl.setAttribute('aria-live', 'polite');
  panel.appendChild(messagesEl);

  var composer = document.createElement('form');
  composer.className = 'composer';
  var input = document.createElement('textarea');
  input.rows = 1;
  input.maxLength = MAX_LENGTH;
  input.placeholder = t('placeholder');
  input.setAttribute('aria-label', t('placeholder'));
  var sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'send';
  sendBtn.setAttribute('aria-label', t('send'));
  setIcon(sendBtn, ICONS.send);
  composer.appendChild(input);
  composer.appendChild(sendBtn);
  panel.appendChild(composer);

  var footer = document.createElement('div');
  footer.className = 'footer';
  footer.textContent = t('poweredBy');
  panel.appendChild(footer);

  root.appendChild(panel);
  root.appendChild(launcher);
  shadow.appendChild(style);
  shadow.appendChild(root);
  document.body.appendChild(host);

  function setIcon(element, markup) {
    // ICONS is a fixed internal constant, never user/model data.
    element.innerHTML = markup;
  }

  function setOpen(open) {
    state.open = open;
    panel.hidden = !open;
    launcher.hidden = open;
    if (open) {
      loadConfig();
      startPolling();
      input.focus();
      scrollToBottom();
    } else {
      stopPolling();
    }
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  launcher.addEventListener('click', function () {
    setOpen(true);
  });

  composer.addEventListener('submit', function (event) {
    event.preventDefault();
    sendMessage();
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text) {
    var bubble = document.createElement('div');
    bubble.className = 'msg ' + role;
    if (role === 'agent') {
      var label = document.createElement('span');
      label.className = 'msg-label';
      label.textContent = t('agent');
      bubble.appendChild(label);
      bubble.appendChild(document.createTextNode(text));
    } else {
      bubble.textContent = text;
    }
    messagesEl.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function addTyping() {
    var bubble = document.createElement('div');
    bubble.className = 'msg bot';
    var typing = document.createElement('span');
    typing.className = 'typing';
    for (var i = 0; i < 3; i += 1) typing.appendChild(document.createElement('span'));
    bubble.appendChild(typing);
    messagesEl.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  /** Renders DB-backed product cards. All fields go through textContent. */
  function renderProducts(items) {
    if (!items || !items.length) return;
    var row = document.createElement('div');
    row.className = 'products';
    items.slice(0, 5).forEach(function (product) {
      if (!product || typeof product.name !== 'string') return;

      var card = document.createElement('article');
      card.className = 'card';

      if (product.imageUrl && isHttpUrl(product.imageUrl)) {
        var img = document.createElement('img');
        img.src = product.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', function () {
          img.style.display = 'none';
        });
        card.appendChild(img);
      }

      var body = document.createElement('div');
      body.className = 'card-body';

      var name = document.createElement('p');
      name.className = 'card-name';
      name.textContent = product.name;
      body.appendChild(name);

      if (typeof product.price === 'number' && isFinite(product.price)) {
        var price = document.createElement('span');
        price.className = 'card-price';
        price.textContent = '¥' + product.price.toFixed(2);
        body.appendChild(price);
      }

      var meta = [];
      if (product.category) meta.push(product.category);
      if (typeof product.stock === 'number') {
        meta.push(
          product.stock > 0
            ? state.locale === 'en'
              ? product.stock + ' in stock'
              : '库存 ' + product.stock
            : state.locale === 'en'
              ? 'Out of stock'
              : '暂时缺货',
        );
      }
      if (meta.length) {
        var metaEl = document.createElement('span');
        metaEl.className = 'card-meta';
        metaEl.textContent = meta.join(' · ');
        body.appendChild(metaEl);
      }

      if (product.url && isHttpUrl(product.url)) {
        var link = document.createElement('a');
        link.className = 'card-link';
        link.href = product.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = t('productCta');
        body.appendChild(link);
      }

      card.appendChild(body);
      row.appendChild(card);
    });
    if (row.childNodes.length) {
      messagesEl.appendChild(row);
      scrollToBottom();
    }
  }

  function isHttpUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function setSending(sending) {
    state.sending = sending;
    sendBtn.disabled = sending;
    input.disabled = false;
  }

  // ---------------------------------------------------------------------------
  // Welcome message (F5) and agent replies (F3)
  // ---------------------------------------------------------------------------

  /** Fetches the public config once, then renders the welcome bubble. */
  function loadConfig() {
    if (state.configLoaded || state.configLoading) return;
    state.configLoading = true;
    fetch(API_BASE + '/api/widget/config?site_key=' + encodeURIComponent(SITE_KEY), {
      method: 'GET',
      credentials: 'omit',
    })
      .then(function (response) {
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (config) {
        state.configLoaded = true;
        if (
          config &&
          typeof config.welcomeMessage === 'string' &&
          config.welcomeMessage.trim()
        ) {
          state.welcomeMessage = config.welcomeMessage;
          // Always the first bubble, even if the visitor typed before the
          // config request finished.
          var bubble = addMessage('bot', state.welcomeMessage);
          if (bubble !== messagesEl.firstChild) {
            messagesEl.insertBefore(bubble, messagesEl.firstChild);
          }
        }
      })
      .catch(function () {
        /* config is optional; the widget still works without it */
      })
      .then(function () {
        state.configLoading = false;
      });
  }

  /**
   * Remembers that this conversation should be watched for merchant replies.
   * Stored per conversation so a new chat does not inherit the old watch.
   */
  function markWatchAgent() {
    if (!state.conversationId) return;
    state.watchConversationId = state.conversationId;
    writeStorage(WATCH_KEY, state.conversationId);
    startPolling();
  }

  function shouldPoll() {
    return Boolean(
      state.open &&
        state.conversationId &&
        (state.needsHuman || state.watchConversationId === state.conversationId),
    );
  }

  function startPolling() {
    if (state.polling || !shouldPoll()) return;
    state.polling = true;
    // Poll once immediately so a reply that landed while the panel was closed
    // appears without an extra 5 s wait, then keep polling while it is open.
    pollAgentMessages();
    pollTimer = window.setInterval(pollAgentMessages, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    state.polling = false;
  }

  /** GET /api/widget/messages; only agent messages after the newest one seen. */
  function pollAgentMessages() {
    if (!state.conversationId || !state.visitorId || state.pollingRequest) return;
    var params = new URLSearchParams();
    params.set('site_key', SITE_KEY);
    params.set('conversation_id', state.conversationId);
    params.set('visitor_id', state.visitorId);
    if (state.lastAgentAt) params.set('after', state.lastAgentAt);

    state.pollingRequest = true;
    fetch(API_BASE + '/api/widget/messages?' + params.toString(), {
      method: 'GET',
      credentials: 'omit',
    })
      .then(function (response) {
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (body) {
        if (!body || !body.items || !body.items.length) return;
        body.items.forEach(function (message) {
          if (
            !message ||
            typeof message.id !== 'string' ||
            typeof message.content !== 'string' ||
            state.renderedAgentIds[message.id]
          ) {
            return;
          }
          state.renderedAgentIds[message.id] = true;
          addMessage('agent', message.content);
          if (typeof message.createdAt === 'string' && message.createdAt > state.lastAgentAt) {
            state.lastAgentAt = message.createdAt;
          }
          // Once a merchant replies, keep watching even if the handoff flag is
          // cleared by handling the conversation.
          markWatchAgent();
        });
      })
      .catch(function () {
        /* polling is best-effort; the next tick retries */
      })
      .then(function () {
        state.pollingRequest = false;
      });
  }

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------

  var currentController = null;

  function sendMessage() {
    if (state.sending) return;
    var text = (input.value || '').trim();
    if (!text) {
      addMessage('error', t('empty'));
      return;
    }
    if (text.length > MAX_LENGTH) {
      addMessage('error', t('tooLong', { max: MAX_LENGTH }));
      return;
    }

    addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    setSending(true);
    var typingBubble = addTyping();

    var botBubble = null;
    var pendingText = '';
    var receivedDone = false;

    function dropTyping() {
      if (typingBubble.parentNode) typingBubble.parentNode.removeChild(typingBubble);
    }

    function ensureBotBubble() {
      if (botBubble) return botBubble;
      dropTyping();
      botBubble = addMessage('bot', '');
      return botBubble;
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    currentController = controller;

    fetch(API_BASE + '/api/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        siteKey: SITE_KEY,
        message: text,
        conversationId: state.conversationId,
        visitorId: state.visitorId,
        locale: state.locale,
      }),
    })
      .then(function (response) {
        if (!response.ok) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              var code = body && body.error;
              if (code === 'rate_limited') throw new Error(t('error'));
              if (code === 'origin_not_allowed') throw new Error(t('error'));
              throw new Error(t('error'));
            });
        }
        if (!response.body || !response.body.getReader) {
          // No streaming support (very old browser): fall back to text.
          return response.text().then(function (raw) {
            var blocks = raw.split(/\r\n\r\n|\n\n|\r\r/);
            for (var b = 0; b < blocks.length; b += 1) handleSseBlock(blocks[b], onEvent);
          });
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buffer = '';
        function pump() {
          return reader.read().then(function (result) {
            if (result.done) {
              if (buffer.trim()) handleSseBlock(buffer, onEvent);
              return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            var boundaries = /(\r\n\r\n|\n\n|\r\r)/;
            var match;
            while ((match = boundaries.exec(buffer))) {
              var block = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              handleSseBlock(block, onEvent);
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') return;
        dropTyping();
        if (botBubble && botBubble.textContent) {
          addMessage('error', t('error'));
        } else {
          if (botBubble && botBubble.parentNode) botBubble.parentNode.removeChild(botBubble);
          addMessage('error', error && error.message ? error.message : t('error'));
        }
      })
      .then(function () {
        dropTyping();
        finish();
      });

    function onEvent(name, data) {
      if (name === 'meta') {
        if (data && typeof data.conversationId === 'string') {
          state.conversationId = data.conversationId;
          writeStorage(CONV_KEY, data.conversationId);
        }
        if (data && data.mock) badge.hidden = false;
        if (data && (data.locale === 'zh' || data.locale === 'en')) state.locale = data.locale;
        if (data && typeof data.needsHuman === 'boolean') {
          state.needsHuman = data.needsHuman;
          if (data.needsHuman) markWatchAgent();
        }
        return;
      }
      if (name === 'products') {
        dropTyping();
        renderProducts(data && data.items);
        return;
      }
      if (name === 'handoff') {
        dropTyping();
        addMessage('notice', t('handoff'));
        state.needsHuman = true;
        markWatchAgent();
        return;
      }
      if (name === 'delta') {
        if (!data || typeof data.text !== 'string') return;
        var bubble = ensureBotBubble();
        pendingText += data.text;
        bubble.textContent = pendingText;
        scrollToBottom();
        return;
      }
      if (name === 'done') {
        receivedDone = true;
        return;
      }
      if (name === 'error') {
        receivedDone = true;
        if (!pendingText) {
          if (botBubble && botBubble.parentNode) botBubble.parentNode.removeChild(botBubble);
          addMessage('error', t('error'));
        } else {
          addMessage('error', t('error'));
        }
      }
    }

    function finish() {
      setSending(false);
      currentController = null;
      if (botBubble && !pendingText && !receivedDone) {
        if (botBubble.parentNode) botBubble.parentNode.removeChild(botBubble);
      }
    }
  }

  /** Parses one SSE event block and invokes `handler(eventName, data)`. */
  function handleSseBlock(block, handler) {
    if (!block) return;
    var eventName = 'message';
    var dataLines = [];
    var lines = block.split(/\r\n|\n|\r/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (!line || line.charAt(0) === ':') continue;
      var colon = line.indexOf(':');
      var field = colon === -1 ? line : line.slice(0, colon);
      var value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.charAt(0) === ' ') value = value.slice(1);
      if (field === 'event') eventName = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (!dataLines.length) return;
    var raw = dataLines.join('\n');
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
    try {
      handler(eventName, parsed);
    } catch (e) {
      /* a rendering error must never break the stream */
    }
  }

  // Expose a tiny test/debug surface without leaking internals.
  window.ShopPulseWidget = {
    open: function () {
      setOpen(true);
    },
    close: function () {
      setOpen(false);
    },
    destroy: function () {
      stopPolling();
      if (currentController) currentController.abort();
      if (host.parentNode) host.parentNode.removeChild(host);
      delete window.ShopPulseWidget;
      window.__shoppulseWidgetLoaded = false;
    },
    getConversationId: function () {
      return state.conversationId;
    },
    isPolling: function () {
      return state.polling;
    },
    clearAgentWatch: function () {
      state.watchConversationId = '';
      state.needsHuman = false;
      writeStorage(WATCH_KEY, null);
      stopPolling();
    },
  };

  setSending(false);
})();
