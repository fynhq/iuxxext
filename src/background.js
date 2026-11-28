const {
  api,
  RULES_KEY,
  WHITELIST_KEY,
  SETTINGS_KEY,
  readStore,
  isWhitelisted,
  normalizeDomain,
  normalizeRule,
  normalizeBackup,
  normalizeScope,
  normalizeWhitelist,
  countAnchorRules,
  MAX_RULES_PER_ANCHOR,
  MAX_RULES_TOTAL,
  t
} = IUXX;

const menus = api.menus;
const MENU_BLOCK_ID = 'iuxx-block-element';
const MENU_ZAP_ID = 'iuxx-zap-element';
const DEFAULT_SETTINGS = IUXX.DEFAULT_SETTINGS;

let writeChain = Promise.resolve();
let menuSetup = null;
let migration = null;

const cssState = new Map();
const cssChains = new Map();
const CSS_STATE_PREFIX = 'iuxx.css.v1.';

function cssSessionKey(tabId) {
  return CSS_STATE_PREFIX + tabId;
}

async function rememberCssState(tabId, state) {
  cssState.set(tabId, state);
  try {
    if (api.storage.session && typeof api.storage.session.set === 'function') {
      await api.storage.session.set({ [cssSessionKey(tabId)]: state });
    }
  } catch {
  }
}

async function loadCssState(tabId) {
  const cached = cssState.get(tabId);
  if (cached) return cached;
  try {
    if (api.storage.session && typeof api.storage.session.get === 'function') {
      const key = cssSessionKey(tabId);
      const data = await api.storage.session.get(key);
      const state = data && data[key];
      if (state && typeof state.token === 'string' && typeof state.css === 'string') {
        cssState.set(tabId, state);
        return state;
      }
    }
  } catch {
  }
  return { token: '', css: '' };
}

function enqueue(task) {
  const run = writeChain.then(task);
  writeChain = run.catch(() => {});
  return run;
}

function sameRule(a, b) {
  return !!a && !!b &&
    a.host === b.host &&
    a.scope === b.scope &&
    a.path === b.path &&
    a.selector === b.selector;
}

async function writeRules(rules) {
  await api.storage.local.set({ [RULES_KEY]: { version: 2, rules } });
}

async function writeWhitelist(whitelist) {
  await api.storage.local.set({ [WHITELIST_KEY]: whitelist });
}

async function migrateLegacy() {
  const data = await api.storage.local.get({
    [RULES_KEY]: null,
    [IUXX.LEGACY_RULES_KEY]: null
  });
  if (data[RULES_KEY]) return;
  const legacy = data[IUXX.LEGACY_RULES_KEY];
  if (!legacy) return;
  const rules = IUXX.normalizeLegacyRules(legacy);
  if (!rules.length) return;
  await writeRules(rules);
}

function runMigration() {
  if (!migration) migration = migrateLegacy().catch(() => {});
  return migration;
}

function ensureMenus() {
  if (!menus) return Promise.resolve();
  if (menuSetup) return menuSetup;
  menuSetup = (async () => {
    await menus.removeAll();
    await menus.create({
      id: MENU_BLOCK_ID,
      title: t('menuBlockElement'),
      contexts: ['all']
    });
    await menus.create({
      id: MENU_ZAP_ID,
      title: t('menuZapElement'),
      contexts: ['all']
    });
  })().catch(() => {});
  return menuSetup;
}

api.runtime.onInstalled.addListener(() => {
  runMigration();
  ensureMenus();
});

runMigration();
ensureMenus();

if (menus && menus.onClicked) {
  menus.onClicked.addListener((info, tab) => {
    if (!tab || typeof tab.id !== 'number') return;
    const source = typeof info.frameId === 'number' && info.frameId > 0 ? 'menu-frame' : 'menu';
    if (info.menuItemId === MENU_BLOCK_ID) openPicker(tab.id, 'block', source);
    else if (info.menuItemId === MENU_ZAP_ID) openPicker(tab.id, 'zap', source);
  });
}

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    if (command !== 'start-picker') return;
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (tab && typeof tab.id === 'number') openPicker(tab.id, 'block', 'command');
    } catch {
    }
  });
}

async function openPicker(tabId, mode, source) {
  const message = { type: 'START_PICKER', mode, source };
  try {
    await api.tabs.sendMessage(tabId, message);
    return;
  } catch {
  }
  try {
    await api.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['shared.js', 'content.js']
    });
    await api.tabs.sendMessage(tabId, message);
  } catch {
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'APPLY_CSS') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false });
      return false;
    }
    const css = typeof message.css === 'string' ? message.css : '';
    const token = String(message.token || '');
    applyCssToTab(tabId, token, css).then(
      (ok) => sendResponse({ ok }),
      () => sendResponse({ ok: false })
    );
    return true;
  }

  if (message.type === 'ADD_RULE') {
    enqueue(() => addRule(message)).then(sendResponse, () => sendResponse({ ok: false, error: 'storage' }));
    return true;
  }

  if (message.type === 'UPDATE_RULE') {
    enqueue(() => updateRule(message)).then(sendResponse, () => sendResponse({ ok: false, error: 'storage' }));
    return true;
  }

  if (message.type === 'REMOVE_RULE') {
    enqueue(() => removeRule(message)).then(sendResponse, () => sendResponse({ ok: false, error: 'storage' }));
    return true;
  }

  if (message.type === 'RESTORE_RULE') {
    enqueue(() => restoreRule(message)).then(sendResponse, () => sendResponse({ ok: false, error: 'storage' }));
    return true;
  }

  if (message.type === 'SET_RULE_ENABLED') {
    enqueue(() => setRuleEnabled(message)).then(sendResponse, () => sendResponse({ ok: false, error: 'storage' }));
    return true;
  }

  if (message.type === 'SET_WHITELIST') {
    enqueue(() => setWhitelist(message)).then(sendResponse, () => sendResponse({ ok: false, error: 'storage' }));
    return true;
  }

  if (message.type === 'IMPORT_BACKUP') {
    enqueue(() => importBackup(message)).then(sendResponse, () => sendResponse({ ok: false, error: 'storage' }));
    return true;
  }

  return false;
});

async function addRule(message) {
  const scope = normalizeScope(message.scope);
  const rule = normalizeRule({
    id: IUXX.makeId(),
    host: scope === 'global' ? '*' : message.hostname,
    scope,
    selector: message.selector,
    path: message.path,
    preview: message.preview,
    enabled: true,
    createdAt: Date.now()
  });
  if (!rule) return { ok: false, error: 'invalid' };

  const store = await readStore();
  if (rule.scope !== 'global' && isWhitelisted(rule.host, store.whitelist)) {
    return { ok: false, error: 'whitelisted' };
  }
  const existing = store.rules.find((item) => sameRule(item, rule));
  if (existing) return { ok: true, rule: existing, duplicate: true };
  if (countAnchorRules(store.rules, rule.host) >= MAX_RULES_PER_ANCHOR) {
    return { ok: false, error: 'limit' };
  }
  if (store.rules.length >= MAX_RULES_TOTAL) {
    return { ok: false, error: 'limitTotal' };
  }

  store.rules.push(rule);
  await writeRules(store.rules);
  return { ok: true, rule };
}

async function updateRule(message) {
  const id = String(message.id || '');
  if (!id || !message.rule || typeof message.rule !== 'object') {
    return { ok: false, error: 'invalid' };
  }
  const store = await readStore();
  const index = store.rules.findIndex((item) => item.id === id);
  if (index === -1) return { ok: false, error: 'missing' };
  const existing = store.rules[index];
  const rule = normalizeRule({
    ...message.rule,
    id,
    createdAt: existing.createdAt
  });
  if (!rule) return { ok: false, error: 'invalid' };
  if (store.rules.some((item) => item.id !== id && sameRule(item, rule))) {
    return { ok: false, error: 'duplicate' };
  }

  const others = store.rules.filter((item) => item.id !== id);
  if (countAnchorRules(others, rule.host) >= MAX_RULES_PER_ANCHOR) {
    return { ok: false, error: 'limit' };
  }

  store.rules[index] = rule;
  await writeRules(store.rules);
  return { ok: true, rule };
}

async function removeRule(message) {
  const id = String(message.id || '');
  if (!id) return { ok: false, error: 'invalid' };
  const store = await readStore();
  const index = store.rules.findIndex((rule) => rule.id === id);
  if (index === -1) return { ok: true, removed: null };
  const [removed] = store.rules.splice(index, 1);
  await writeRules(store.rules);
  return { ok: true, removed };
}

async function restoreRule(message) {
  if (!message.rule || typeof message.rule !== 'object') {
    return { ok: false, error: 'invalid' };
  }
  const rule = normalizeRule(message.rule, null, String(message.rule.id || ''));
  if (!rule) return { ok: false, error: 'invalid' };
  const store = await readStore();
  if (store.rules.some((item) => item.id === rule.id)) return { ok: true, skipped: true };
  if (store.rules.some((item) => sameRule(item, rule))) return { ok: true, skipped: true };
  if (countAnchorRules(store.rules, rule.host) >= MAX_RULES_PER_ANCHOR) {
    return { ok: false, error: 'limit' };
  }
  if (store.rules.length >= MAX_RULES_TOTAL) {
    return { ok: false, error: 'limitTotal' };
  }
  store.rules.push(rule);
  await writeRules(store.rules);
  return { ok: true, rule };
}

async function setRuleEnabled(message) {
  const id = String(message.id || '');
  if (!id) return { ok: false, error: 'invalid' };
  const store = await readStore();
  const rule = store.rules.find((item) => item.id === id);
  if (!rule) return { ok: false, error: 'missing' };
  rule.enabled = message.enabled !== false;
  await writeRules(store.rules);
  return { ok: true, rule };
}

async function setWhitelist(message) {
  const domain = normalizeDomain(message.domain);
  if (!domain) return { ok: false, error: 'invalid' };

  const store = await readStore();
  const domains = new Set(store.whitelist);
  if (message.enabled) {
    domains.add(domain);
  } else if (message.removeAll) {
    for (const entry of Array.from(domains)) {
      if (domain === entry || domain.endsWith('.' + entry)) domains.delete(entry);
    }
  } else {
    domains.delete(domain);
  }

  const whitelist = normalizeWhitelist(Array.from(domains));
  await writeWhitelist(whitelist);
  return { ok: true, domain, enabled: !!message.enabled, whitelist };
}

async function importBackup(message) {
  let parsed;
  try {
    parsed = normalizeBackup(message.data);
  } catch {
    return { ok: false, error: 'invalid' };
  }

  const mode = message.mode === 'replace' ? 'replace' : 'merge';
  const store = await readStore();
  const rules = mode === 'replace' ? [] : store.rules.slice();
  const whitelist = mode === 'replace' ? [] : store.whitelist.slice();
  const existingIds = new Set(rules.map((rule) => rule.id));
  const existingKeys = new Set(rules.map((rule) => (
    `${rule.host}\u0000${rule.scope}\u0000${rule.path}\u0000${rule.selector}`
  )));

  let added = 0;
  let skipped = 0;
  for (const source of parsed.rules) {
    const rule = { ...source };
    const key = `${rule.host}\u0000${rule.scope}\u0000${rule.path}\u0000${rule.selector}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    if (rules.length >= MAX_RULES_TOTAL ||
        countAnchorRules(rules, rule.host) >= MAX_RULES_PER_ANCHOR) {
      skipped += 1;
      continue;
    }
    if (!rule.id || existingIds.has(rule.id)) rule.id = IUXX.makeId();
    rules.push(rule);
    existingIds.add(rule.id);
    existingKeys.add(key);
    added += 1;
  }

  const mergedWhitelist = new Set(whitelist);
  for (const domain of parsed.whitelist) mergedWhitelist.add(domain);
  const finalWhitelist = normalizeWhitelist(Array.from(mergedWhitelist));

  const payload = {
    [RULES_KEY]: { version: 2, rules },
    [WHITELIST_KEY]: finalWhitelist
  };
  if (typeof parsed.settings.keepPickerOpen === 'boolean') {
    payload[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, keepPickerOpen: parsed.settings.keepPickerOpen };
  }
  await api.storage.local.set(payload);

  return {
    ok: true,
    added,
    skipped,
    total: rules.length,
    whitelist: finalWhitelist.length
  };
}

function applyCssToTab(tabId, token, css) {
  if (typeof tabId !== 'number') return Promise.resolve(false);
  const previous = cssChains.get(tabId) || Promise.resolve();
  const run = previous.then(async () => {
    const state = await loadCssState(tabId);
    if (state.token === token && state.css === css) return true;

    if (state.css) {
      try {
        await api.scripting.removeCSS({
          target: { tabId, frameIds: [0] },
          css: state.css,
          origin: 'USER'
        });
      } catch {
      }
      await rememberCssState(tabId, { token, css: '' });
    }

    if (!css) {
      await rememberCssState(tabId, { token, css: '' });
      return true;
    }

    try {
      await api.scripting.insertCSS({
        target: { tabId, frameIds: [0] },
        css,
        origin: 'USER'
      });
      await rememberCssState(tabId, { token, css });
      return true;
    } catch {
      await rememberCssState(tabId, { token, css: '' });
      return false;
    }
  }).catch(() => false);

  cssChains.set(tabId, run);
  return run;
}

if (api.tabs && api.tabs.onRemoved) {
  api.tabs.onRemoved.addListener((tabId) => {
    cssState.delete(tabId);
    cssChains.delete(tabId);
    try {
      if (api.storage.session && typeof api.storage.session.remove === 'function') {
        api.storage.session.remove(cssSessionKey(tabId)).catch(() => {});
      }
    } catch {
    }
  });
}