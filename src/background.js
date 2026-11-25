if (typeof importScripts === 'function') importScripts('shared.js');

const { api, RULES_KEY, WHITELIST_KEY, readStore, isWhitelisted, normalizeDomain, t } = IUXX;
const menus = api.menus || api.contextMenus;
const MENU_ID = 'iuxx-block-element';
const MAX_RULES_PER_HOST = 300;

let writeChain = Promise.resolve();

function enqueue(task) {
  const run = writeChain.then(task);
  writeChain = run.catch(() => {});
  return run;
}

function removeAllMenus() {
  if (!menus || typeof menus.removeAll !== 'function') return Promise.resolve();
  if (globalThis.browser) return menus.removeAll();
  return new Promise((resolve) => menus.removeAll(() => resolve()));
}

api.runtime.onInstalled.addListener(async () => {
  if (!menus || typeof menus.create !== 'function') return;
  try {
    await removeAllMenus();
    await menus.create({
      id: MENU_ID,
      title: t('menuBlockElement'),
      contexts: ['all']
    });
  } catch {
  }
});

if (menus && menus.onClicked) {
  menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab || typeof tab.id !== 'number') return;
    openPicker(tab.id);
  });
}

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    if (command !== 'start-picker') return;
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (tab && typeof tab.id === 'number') openPicker(tab.id);
    } catch {
    }
  });
}

async function openPicker(tabId) {
  const message = { type: 'START_PICKER' };
  try {
    await api.tabs.sendMessage(tabId, message);
    return;
  } catch {
  }
  if (!api.scripting || typeof api.scripting.executeScript !== 'function') return;
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

  if (message.type === 'ADD_RULE') {
    enqueue(() => addRule(message)).then(
      (result) => sendResponse(result),
      () => sendResponse({ ok: false, error: 'storage' })
    );
    return true;
  }

  if (message.type === 'REMOVE_RULE') {
    enqueue(() => removeRule(message)).then(
      (result) => sendResponse(result),
      () => sendResponse({ ok: false, error: 'storage' })
    );
    return true;
  }

  if (message.type === 'SET_WHITELIST') {
    enqueue(() => setWhitelist(message)).then(
      (result) => sendResponse(result),
      () => sendResponse({ ok: false, error: 'storage' })
    );
    return true;
  }

  return false;
});

function cleanHost(value) {
  const host = String(value || '').toLowerCase().trim();
  return /^[a-z0-9._\-\[\]:]+$/.test(host) && host.length <= 253 ? host : '';
}

async function addRule(message) {
  const host = cleanHost(message.hostname);
  const selector = String(message.selector || '').trim();
  if (!host || !selector || selector.length > 600) return { ok: false, error: 'invalid' };

  const store = await readStore();
  if (isWhitelisted(host, store.whitelist)) return { ok: false, error: 'whitelisted' };

  const list = Array.isArray(store.rules[host]) ? store.rules[host].slice() : [];
  const existing = list.find((rule) => rule && rule.selector === selector);
  if (existing) return { ok: true, rule: existing, duplicate: true };
  if (list.length >= MAX_RULES_PER_HOST) return { ok: false, error: 'limit' };

  const rule = {
    id: crypto.randomUUID(),
    selector,
    preview: String(message.preview || '').slice(0, 120),
    createdAt: Date.now()
  };
  list.push(rule);
  store.rules[host] = list;
  await api.storage.local.set({ [RULES_KEY]: store.rules });
  return { ok: true, rule };
}

async function removeRule(message) {
  const host = cleanHost(message.hostname);
  const id = String(message.id || '');
  if (!host || !id) return { ok: false, error: 'invalid' };

  const store = await readStore();
  const list = Array.isArray(store.rules[host]) ? store.rules[host] : [];
  const next = list.filter((rule) => !rule || rule.id !== id);
  if (next.length === list.length) return { ok: true, removed: 0 };

  if (next.length) store.rules[host] = next;
  else delete store.rules[host];
  await api.storage.local.set({ [RULES_KEY]: store.rules });
  return { ok: true, removed: 1 };
}

async function setWhitelist(message) {
  const domain = normalizeDomain(message.domain);
  if (!domain) return { ok: false, error: 'invalid' };

  const store = await readStore();
  const domains = new Set(store.whitelist.map((item) => normalizeDomain(item)).filter(Boolean));
  if (message.enabled) {
    domains.add(domain);
  } else if (message.removeAll) {
    for (const entry of Array.from(domains)) {
      if (domain === entry || domain.endsWith('.' + entry)) domains.delete(entry);
    }
  } else {
    domains.delete(domain);
  }

  await api.storage.local.set({ [WHITELIST_KEY]: Array.from(domains).sort() });
  return { ok: true, domain, enabled: !!message.enabled };
}
