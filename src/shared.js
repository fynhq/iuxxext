(function () {
  'use strict';
  if (globalThis.IUXX) return;

  const api = browser;
  const RULES_KEY = 'iuxx.rules.v2';
  const LEGACY_RULES_KEY = 'iuxx.rules.v1';
  const WHITELIST_KEY = 'iuxx.whitelist.v1';
  const SETTINGS_KEY = 'iuxx.settings.v1';
  const BACKUP_FORMAT = 'iuxx-backup';
  const BACKUP_VERSION = 2;
  const MAX_RULES_PER_ANCHOR = 1000;
  const MAX_RULES_TOTAL = 5000;
  const MAX_SELECTOR_LENGTH = 1024;
  const MAX_PATH_LENGTH = 200;
  const MAX_PREVIEW_LENGTH = 120;
  const SCOPES = ['host', 'domain', 'global'];
  const DEFAULT_SETTINGS = Object.freeze({ keepPickerOpen: false });

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

  function normalizePath(input) {
    if (typeof input !== 'string') return '';
    let value = input.trim();
    if (!value) return '';
    if (value === '*') return '*';
    if (/^https?:\/\//i.test(value)) {
      try {
        value = new URL(value).pathname || '/';
      } catch {
        return '';
      }
    }
    if (!value.startsWith('/')) value = '/' + value;
    value = value.replace(/[\r\n\t]/g, '').slice(0, MAX_PATH_LENGTH);
    if (value === '/') return '';
    return value;
  }

  function ruleMatchesPath(rule, pathname) {
    const pattern = rule && typeof rule.path === 'string' ? rule.path : '';
    if (!pattern || pattern === '*') return true;
    let path = typeof pathname === 'string' && pathname ? pathname : '/';
    if (!path.startsWith('/')) path = '/' + path;
    if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
    if (path === pattern) return true;
    if (pattern.endsWith('/')) return path.startsWith(pattern);
    return path.startsWith(pattern + '/');
  }

  function ruleMatchesHost(rule, hostname) {
    if (!rule) return false;
    if (rule.scope === 'global') return true;
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    const anchor = String(rule.host || '').toLowerCase().replace(/\.$/, '');
    if (!host || !anchor) return false;
    if (rule.scope === 'domain') return host === anchor || host.endsWith('.' + anchor);
    return host === anchor;
  }

  function ruleMatchesPage(rule, hostname, pathname) {
    return ruleMatchesHost(rule, hostname) && ruleMatchesPath(rule, pathname);
  }

  function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function stableId(prefix, input) {
    const text = String(input || '');
    return `${prefix || 'id'}-${hashString(text)}-${text.length.toString(36)}`;
  }

  function makeId(prefix) {
    let value;
    try {
      value = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    } catch {
      value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return prefix ? `${prefix}-${value}` : value;
  }

  function normalizeScope(value) {
    return SCOPES.includes(value) ? value : 'host';
  }

  function selectorIsStorable(selector) {
    if (typeof selector !== 'string') return false;
    const value = selector.trim();
    if (!value || value.length > MAX_SELECTOR_LENGTH) return false;
    if (/[{}]/.test(value)) return false;
    if (/[\r\n\0]/.test(value)) return false;
    return true;
  }

  let testDocument = null;

  function selectorTargetsRoot(selector) {
    if (typeof document === 'undefined' || !document.implementation) return false;
    if (typeof selector !== 'string' || !selector) return true;
    if (/(^|,)\s*(?:html|body)(?=[.#\[:]|$)/i.test(selector)) return true;
    if (!testDocument) {
      testDocument = document.implementation.createHTMLDocument('');
      testDocument.body.appendChild(testDocument.createElement('div'));
    }
    try {
      for (const node of testDocument.querySelectorAll(selector)) {
        if (node === testDocument.documentElement || node === testDocument.body) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  function normalizeRule(raw, fallbackHost, fallbackId) {
    if (typeof raw === 'string') raw = { selector: raw };
    if (!raw || typeof raw !== 'object') return null;

    const scope = normalizeScope(raw.scope);
    let host = '*';
    if (scope !== 'global') {
      host = normalizeDomain(raw.host || raw.hostname || fallbackHost || '');
      if (!host) return null;
    }

    const selector = String(raw.selector || '').trim();
    if (!selectorIsStorable(selector)) return null;

    const path = normalizePath(raw.path);
    const createdAt = Number.isFinite(raw.createdAt) && raw.createdAt > 0
      ? raw.createdAt
      : Date.now();
    let id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 120) : '';
    if (!id) {
      id = fallbackId || stableId(
        'rule',
        `${host}\u0000${scope}\u0000${path}\u0000${selector}\u0000${Number.isFinite(raw.createdAt) ? raw.createdAt : 0}`
      );
    }

    return {
      id,
      host,
      scope,
      selector,
      path,
      enabled: raw.enabled !== false,
      preview: String(raw.preview || '').trim().slice(0, MAX_PREVIEW_LENGTH),
      createdAt
    };
  }

  function ruleKey(rule) {
    return `${rule.host}\u0000${rule.scope}\u0000${rule.path}\u0000${rule.selector}`;
  }

  function dedupeRules(rules) {
    const ids = new Set();
    const keys = new Set();
    const out = [];
    for (const rule of rules) {
      if (!rule) continue;
      if (ids.has(rule.id) || keys.has(ruleKey(rule))) continue;
      ids.add(rule.id);
      keys.add(ruleKey(rule));
      out.push(rule);
    }
    return out;
  }

  function normalizeLegacyRules(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const out = [];
    const metaKeys = new Set(['rules', 'whitelist', 'settings', 'format', 'version', 'exportedAt']);
    for (const [host, list] of Object.entries(raw)) {
      if (metaKeys.has(host) || !Array.isArray(list)) continue;
      list.forEach((item, index) => {
        const selector = typeof item === 'string' ? item : item && item.selector;
        const fallbackId = stableId('legacy', `${host}\u0000${String(selector || '')}\u0000${index}`);
        const rule = normalizeRule(item, host, fallbackId);
        if (rule) out.push(rule);
      });
    }
    return dedupeRules(out);
  }

  function normalizeRulesPayload(raw) {
    const list = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && Array.isArray(raw.rules) ? raw.rules : null);
    if (!list) return null;
    const out = [];
    for (const item of list) {
      const rule = normalizeRule(item);
      if (rule) out.push(rule);
    }
    return dedupeRules(out);
  }

  function normalizeWhitelist(raw) {
    const values = Array.isArray(raw) ? raw : [];
    const out = new Set();
    for (const item of values) {
      const domain = normalizeDomain(item);
      if (domain) out.add(domain);
    }
    return Array.from(out).sort();
  }

  async function readStore() {
    const data = await api.storage.local.get({
      [RULES_KEY]: null,
      [LEGACY_RULES_KEY]: null,
      [WHITELIST_KEY]: []
    });
    let rules = normalizeRulesPayload(data[RULES_KEY]);
    if (rules === null) rules = normalizeLegacyRules(data[LEGACY_RULES_KEY]);
    return {
      rules,
      whitelist: normalizeWhitelist(data[WHITELIST_KEY])
    };
  }

  async function readSettings() {
    const data = await api.storage.local.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    const raw = data[SETTINGS_KEY];
    return {
      keepPickerOpen: !!(raw && raw.keepPickerOpen === true)
    };
  }

  function normalizeBackup(raw) {
    let payload = raw;
    if (Array.isArray(payload)) payload = { rules: payload };
    if (!payload || typeof payload !== 'object') throw new Error('invalid backup');

    let rules = [];
    if (Array.isArray(payload.rules)) {
      for (const item of payload.rules) {
        const rule = normalizeRule(item);
        if (rule) rules.push(rule);
      }
      rules = dedupeRules(rules);
    } else if (payload.rules === undefined &&
        !('format' in payload) && !('version' in payload) &&
        !('whitelist' in payload) && !('settings' in payload)) {
      rules = normalizeLegacyRules(payload);
    } else {
      throw new Error('invalid backup');
    }

    const settings = {};
    if (payload.settings && typeof payload.settings === 'object' &&
        typeof payload.settings.keepPickerOpen === 'boolean') {
      settings.keepPickerOpen = payload.settings.keepPickerOpen;
    }

    return {
      rules,
      whitelist: normalizeWhitelist(payload.whitelist),
      settings
    };
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

  function rulesForHost(rules, hostname) {
    return (Array.isArray(rules) ? rules : []).filter((rule) => ruleMatchesHost(rule, hostname));
  }

  function activeRulesForPage(rules, hostname, pathname, whitelisted) {
    if (whitelisted) return [];
    return (Array.isArray(rules) ? rules : []).filter((rule) => (
      rule.enabled !== false && ruleMatchesPage(rule, hostname, pathname)
    ));
  }

  function selectorsForPage(rules, hostname, pathname, whitelisted) {
    const seen = new Set();
    const out = [];
    for (const rule of activeRulesForPage(rules, hostname, pathname, whitelisted)) {
      const selector = typeof rule.selector === 'string' ? rule.selector.trim() : '';
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      out.push(selector);
    }
    return out;
  }

  function buildCss(selectors) {
    const seen = new Set();
    const lines = [];
    for (const selector of Array.isArray(selectors) ? selectors : []) {
      const value = typeof selector === 'string' ? selector.trim() : '';
      if (!value || seen.has(value) || !selectorIsStorable(value)) continue;
      seen.add(value);
      lines.push(`${value} { display: none !important; }`);
    }
    return lines.join('\n');
  }

  function countAnchorRules(rules, host) {
    if (host === '*') {
      return (Array.isArray(rules) ? rules : []).filter((rule) => rule.scope === 'global').length;
    }
    return (Array.isArray(rules) ? rules : []).filter((rule) => (
      rule.scope !== 'global' && rule.host === host
    )).length;
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
    LEGACY_RULES_KEY,
    WHITELIST_KEY,
    SETTINGS_KEY,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    MAX_RULES_PER_ANCHOR,
    MAX_RULES_TOTAL,
    MAX_SELECTOR_LENGTH,
    MAX_PATH_LENGTH,
    MAX_PREVIEW_LENGTH,
    SCOPES,
    DEFAULT_SETTINGS,
    hostOfUrl,
    normalizeDomain,
    normalizePath,
    normalizeScope,
    normalizeRule,
    normalizeLegacyRules,
    normalizeRulesPayload,
    normalizeWhitelist,
    normalizeBackup,
    selectorIsStorable,
    selectorTargetsRoot,
    stableId,
    makeId,
    ruleMatchesHost,
    ruleMatchesPath,
    ruleMatchesPage,
    rulesForHost,
    activeRulesForPage,
    selectorsForPage,
    buildCss,
    countAnchorRules,
    matchingWhitelist,
    isWhitelisted,
    readStore,
    readSettings,
    describeElement,
    t,
    applyI18n
  };
})();