(function () {
  'use strict';
  if (globalThis.IUXX) return;

  const api = globalThis.browser || globalThis.chrome;
  const RULES_KEY = 'iuxx.rules.v1';
  const WHITELIST_KEY = 'iuxx.whitelist.v1';
  const CACHE_PREFIX = 'iuxx.cache.v1:';

  function hostOfUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      return '';
    }
  }

  function normalizeDomain(input) {
    if (typeof input !== 'string') return '';
    let value = input.trim().toLowerCase();
    if (!value) return '';
    value = value.replace(/^\*\./, '');
    let parsed;
    try {
      parsed = new URL(value.includes('://') ? value : 'http://' + value);
    } catch {
      return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host.length > 253) return '';
    return host;
  }

  function matchingWhitelist(hostname, whitelist) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    if (!host) return '';
    let best = '';
    for (const entry of Array.isArray(whitelist) ? whitelist : []) {
      const domain = String(entry || '').toLowerCase().replace(/\.$/, '');
      if (!domain) continue;
      if (host === domain || host.endsWith('.' + domain)) {
        if (domain.length > best.length) best = domain;
      }
    }
    return best;
  }

  function isWhitelisted(hostname, whitelist) {
    return !!matchingWhitelist(hostname, whitelist);
  }

  async function readStore() {
    const data = await api.storage.local.get({
      [RULES_KEY]: {},
      [WHITELIST_KEY]: []
    });
    const rawRules = data[RULES_KEY];
    const rules = {};
    if (rawRules && typeof rawRules === 'object') {
      for (const [host, list] of Object.entries(rawRules)) {
        if (!Array.isArray(list)) continue;
        const clean = list.filter((rule) => rule && typeof rule.selector === 'string' && rule.selector);
        if (clean.length) rules[host] = clean;
      }
    }
    return {
      rules,
      whitelist: Array.isArray(data[WHITELIST_KEY])
        ? data[WHITELIST_KEY].map((item) => String(item || '')).filter(Boolean)
        : []
    };
  }

  function stateForHost(store, hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    const list = host && Array.isArray(store.rules[host]) ? store.rules[host] : [];
    return {
      rules: list.filter((rule) => rule && typeof rule.selector === 'string' && rule.selector),
      whitelisted: isWhitelisted(host, store.whitelist),
      whitelistEntry: matchingWhitelist(host, store.whitelist)
    };
  }

  function cacheKey() {
    return CACHE_PREFIX + location.hostname.toLowerCase().replace(/\.$/, '');
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.host !== location.hostname.toLowerCase().replace(/\.$/, '')) return null;
      if (!Array.isArray(data.selectors)) return null;
      return data;
    } catch {
      return null;
    }
  }

  function writeCache(selectors) {
    try {
      if (!selectors || !selectors.length) {
        localStorage.removeItem(cacheKey());
        return;
      }
      localStorage.setItem(cacheKey(), JSON.stringify({
        host: location.hostname.toLowerCase().replace(/\.$/, ''),
        selectors,
        updatedAt: Date.now()
      }));
    } catch {
    }
  }

  function describeElement(el) {
    if (!(el instanceof Element)) return '';
    let text = el.localName;
    if (el.id) text += '#' + el.id;
    const classes = Array.from(el.classList).slice(0, 2);
    if (classes.length) text += '.' + classes.join('.');
    return text.slice(0, 80);
  }

  function t(key, substitutions) {
    if (!api.i18n || typeof api.i18n.getMessage !== 'function') return key;
    try {
      const message = api.i18n.getMessage(key, substitutions);
      return message || key;
    } catch {
      return key;
    }
  }

  function applyI18n(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return;
    const doc = scope.ownerDocument || scope;
    if (doc.documentElement && api.i18n && typeof api.i18n.getUILanguage === 'function') {
      doc.documentElement.lang = api.i18n.getUILanguage();
    }
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const el of scope.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.getAttribute('data-i18n-title'));
    }
    for (const el of scope.querySelectorAll('[data-i18n-aria-label]')) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    }
    for (const el of scope.querySelectorAll('[data-i18n-placeholder]')) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    }
  }

  globalThis.IUXX = {
    api,
    RULES_KEY,
    WHITELIST_KEY,
    hostOfUrl,
    normalizeDomain,
    matchingWhitelist,
    isWhitelisted,
    readStore,
    stateForHost,
    readCache,
    writeCache,
    describeElement,
    t,
    applyI18n
  };
})();
