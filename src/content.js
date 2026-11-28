(function () {
  'use strict';
  if (globalThis.__IUXX_CONTENT_LOADED__) return;
  globalThis.__IUXX_CONTENT_LOADED__ = true;

  const {
    api,
    RULES_KEY,
    LEGACY_RULES_KEY,
    WHITELIST_KEY,
    SETTINGS_KEY,
    normalizeDomain,
    normalizePath,
    readStore,
    readSettings,
    isWhitelisted,
    selectorsForPage,
    buildCss,
    selectorIsStorable,
    selectorTargetsRoot,
    makeId,
    describeElement,
    t
  } = IUXX;

  const hostname = normalizeDomain(location.hostname);
  if (!hostname) return;

  const HOST_TAG = 'iuxx-picker-host';
  const TOAST_TAG = 'iuxx-toast-host';
  const LEGACY_CACHE_PREFIX = 'iuxx.cache.v1:';
  const loadToken = makeId('page');

  let activeSelectors = [];
  let whitelisted = false;
  let settings = { keepPickerOpen: false };
  let picker = null;
  let notice = null;
  let syncToken = 0;
  let fallbackStyleEl = null;
  let resolveReady = null;
  const contextPoint = { x: -1, y: -1, at: 0 };
  const stateReady = new Promise((resolve) => {
    resolveReady = resolve;
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'START_PICKER') {
      startPicker(message.mode === 'zap' ? 'zap' : 'block', message.source || '');
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'RESYNC') {
      syncFromStorage().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    }
    if (message.type === 'PING') {
      sendResponse({ ok: true, hostname, whitelisted });
      return false;
    }
    return false;
  });

  api.storage.onChanged.addListener(onStorageChanged);
  window.addEventListener('contextmenu', onContextPoint, true);
  try {
    localStorage.removeItem(LEGACY_CACHE_PREFIX + hostname);
  } catch {
  }
  init();

  function onContextPoint(event) {
    if (!event || !event.isTrusted) return;
    contextPoint.x = event.clientX;
    contextPoint.y = event.clientY;
    contextPoint.at = Date.now();
  }

  async function init() {
    try {
      const [store, loadedSettings] = await Promise.all([readStore(), readSettings()]);
      settings = loadedSettings;
      applyState(store);
      await syncPageCss();
    } catch {
    } finally {
      resolveReady();
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (SETTINGS_KEY in changes) {
      readSettings().then((next) => {
        settings = next;
      }).catch(() => {});
    }
    if (!(RULES_KEY in changes) && !(LEGACY_RULES_KEY in changes) && !(WHITELIST_KEY in changes)) {
      return;
    }
    syncFromStorage();
  }

  function applyState(store) {
    whitelisted = isWhitelisted(hostname, store.whitelist);
    const selectors = whitelisted
      ? []
      : selectorsForPage(store.rules, hostname, location.pathname, false);
    activeSelectors = selectors.filter(isApplicableSelector);
  }

  async function syncFromStorage() {
    const token = ++syncToken;
    try {
      const store = await readStore();
      if (token !== syncToken) return;
      applyState(store);
      await syncPageCss();
      if (whitelisted && picker && picker.mode === 'block') {
        picker.destroy();
        picker = null;
        notify(t('notifyWhitelistEnabled'));
      }
    } catch {
    }
  }

  async function syncPageCss() {
    const css = buildCss(activeSelectors);
    let ok = false;
    try {
      const result = await api.runtime.sendMessage({
        type: 'APPLY_CSS',
        css,
        token: loadToken
      });
      ok = !!(result && result.ok);
    } catch {
    }
    applyFallbackStyle(ok ? '' : css);
  }

  function applyFallbackStyle(css) {
    if (!css) {
      if (fallbackStyleEl) {
        fallbackStyleEl.remove();
        fallbackStyleEl = null;
      }
      return;
    }
    if (!fallbackStyleEl || !fallbackStyleEl.isConnected) {
      const root = document.head || document.documentElement;
      if (!root) return;
      fallbackStyleEl = document.createElement('style');
      root.appendChild(fallbackStyleEl);
    }
    fallbackStyleEl.textContent = css;
  }

  function isApplicableSelector(selector) {
    if (typeof selector !== 'string' || !selectorIsStorable(selector)) return false;
    if (selectorTargetsRoot(selector)) return false;
    try {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (node === document.body || node === document.documentElement) return false;
        if (node.localName === HOST_TAG || node.localName === TOAST_TAG) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function startPicker(mode, source) {
    await stateReady;
    if (mode === 'block' && whitelisted) {
      notify(t('notifyWhitelistedSite'));
      return;
    }
    if (picker || !document.documentElement) return;
    clearNotice();
    picker = createPicker({ mode });
    if (source === 'menu' && Date.now() - contextPoint.at < 15000 && contextPoint.x >= 0) {
      picker.preselectAt(contextPoint.x, contextPoint.y);
    }
  }

  function stopPicker() {
    if (!picker) return;
    picker.destroy();
    picker = null;
  }

  const THEME_CSS = `
    :host {
      all: initial;
      --iu-surface: rgba(17, 24, 39, .97);
      --iu-surface-2: rgba(255, 255, 255, .08);
      --iu-text: #f8fafc;
      --iu-muted: #9ca3af;
      --iu-border: rgba(255, 255, 255, .12);
      --iu-btn-border: rgba(255, 255, 255, .26);
      --iu-hover: rgba(255, 255, 255, .1);
      --iu-danger: #fca5a5;
      --iu-shadow: 0 12px 36px rgba(0, 0, 0, .3);
      --iu-kbd-bg: rgba(255, 255, 255, .1);
      --iu-kbd-border: rgba(255, 255, 255, .3);
      --iu-primary: #ef4444;
      --iu-primary-hover: #dc2626;
    }
    @media (prefers-color-scheme: light) {
      :host {
        --iu-surface: #ffffff;
        --iu-surface-2: #f3f5f8;
        --iu-text: #172033;
        --iu-muted: #667085;
        --iu-border: #e3e6ec;
        --iu-btn-border: #d3d8e0;
        --iu-hover: #f2f4f7;
        --iu-danger: #b42318;
        --iu-shadow: 0 12px 36px rgba(15, 23, 42, .16);
        --iu-kbd-bg: #f3f5f8;
        --iu-kbd-border: #d3d8e0;
        --iu-primary: #e5484d;
        --iu-primary-hover: #cc3439;
      }
    }
  `;

  const NOTICE_CSS = THEME_CSS + `
    .toast {
      display: flex; align-items: center; gap: 12px;
      max-width: min(92vw, 720px); padding: 10px 14px; border-radius: 9px;
      background: var(--iu-surface); color: var(--iu-text);
      border: 1px solid var(--iu-border);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: var(--iu-shadow); pointer-events: none;
    }
    .toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toast button {
      pointer-events: auto; cursor: pointer; flex: none;
      padding: 3px 10px; border-radius: 5px; border: 1px solid var(--iu-btn-border);
      background: transparent; color: var(--iu-text); font: inherit;
    }
    .toast button:hover:not(:disabled) { background: var(--iu-hover); }
    .toast button:disabled { opacity: .5; cursor: default; }
    * { -webkit-tap-highlight-color: transparent; }
    @media (pointer: coarse) {
      .toast { padding: 11px 14px; }
      .toast button { min-height: 40px; padding: 6px 12px; }
    }
  `;

  function notify(text, options) {
    options = options || {};
    clearNotice();
    if (!document.documentElement) return;
    const root = document.createElement(TOAST_TAG);
    root.style.cssText =
      'all: initial !important; position: fixed !important; left: 50% !important; bottom: 24px !important;' +
      'transform: translateX(-50%) !important; z-index: 2147483647 !important; display: block !important;' +
      'width: max-content !important; max-width: 92vw !important; pointer-events: none !important;';
    const shadow = root.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = NOTICE_CSS;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const textEl = document.createElement('span');
    textEl.textContent = text;
    toast.appendChild(textEl);

    const current = { root, textEl, button: null, timer: 0 };
    if (typeof options.onAction === 'function' && options.actionLabel) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = options.actionLabel;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          const result = await options.onAction();
          if (result === false) throw new Error('failed');
          if (notice !== current) return;
          textEl.textContent = options.doneText || t('undone');
          button.remove();
          current.button = null;
          armNotice(2600);
        } catch {
          if (notice !== current) return;
          textEl.textContent = options.failText || t('undoFailed');
          button.disabled = false;
        }
      });
      current.button = button;
      toast.appendChild(button);
    }

    shadow.append(style, toast);
    document.documentElement.appendChild(root);
    notice = current;
    armNotice(options.duration || (current.button ? 9000 : 3200));
  }

  function armNotice(ms) {
    if (!notice) return;
    clearTimeout(notice.timer);
    notice.timer = setTimeout(clearNotice, ms);
  }

  function clearNotice() {
    if (!notice) return;
    clearTimeout(notice.timer);
    notice.root.remove();
    notice = null;
  }

  const PICKER_CSS = THEME_CSS + `
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    .hl {
      position: fixed; display: none; pointer-events: none;
      border: 2px solid #ef4444; background: rgba(239, 68, 68, .12);
      border-radius: 2px; z-index: 2;
    }
    .tip {
      position: fixed; display: none; pointer-events: none;
      max-width: 70vw; padding: 3px 8px; border-radius: 4px;
      background: var(--iu-surface); color: var(--iu-text);
      border: 1px solid var(--iu-border);
      font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      z-index: 3;
    }
    .hud {
      position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 8px; pointer-events: none;
      width: max-content; max-width: calc(100vw - 20px); white-space: nowrap;
      padding: 8px 14px; border-radius: 999px;
      background: var(--iu-surface); color: var(--iu-text);
      border: 1px solid var(--iu-border);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: var(--iu-shadow); z-index: 4;
    }
    .hud.hide { display: none; }
    .hud .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--iu-primary); flex: none; }
    .hud kbd {
      display: inline-block; padding: 1px 5px; border-radius: 4px;
      border: 1px solid var(--iu-kbd-border); background: var(--iu-kbd-bg);
      font: 11px/1.4 ui-monospace, monospace;
    }
    .hud .hud-count {
      color: var(--iu-muted); font-size: 12px;
    }
    .hud-exit {
      pointer-events: auto; cursor: pointer; flex: none; white-space: nowrap;
      margin: -2px -4px -2px 0; padding: 2px 8px; border-radius: 5px;
      border: 1px solid var(--iu-btn-border); background: transparent;
      color: var(--iu-text); font: inherit; line-height: 1.4;
    }
    .hud-exit:hover { background: var(--iu-hover); }
    .panel {
      position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
      display: none; width: min(680px, calc(100vw - 24px)); padding: 12px 14px;
      max-height: calc(100vh - 24px); overflow-y: auto;
      border-radius: 12px; background: var(--iu-surface); color: var(--iu-text);
      border: 1px solid var(--iu-border);
      box-shadow: var(--iu-shadow); pointer-events: auto;
      z-index: 6; font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .panel.show { display: block; }
    .panel-grip { display: none; }
    .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .panel-title { font-weight: 650; font-size: 13px; }
    .panel-depth { color: var(--iu-muted); font-size: 11.5px; white-space: nowrap; }
    .panel-desc {
      margin-top: 2px; color: var(--iu-text); font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .panel-selector {
      display: block; width: 100%; margin-top: 8px; padding: 6px 8px; border-radius: 6px;
      background: var(--iu-surface-2); color: var(--iu-text);
      border: 1px solid var(--iu-border); outline: none;
      font: 11.5px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .panel-selector:focus { border-color: var(--iu-primary); }
    .panel-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .panel-match-text { color: var(--iu-muted); font-size: 11.5px; }
    .panel-match-text.warn { color: var(--iu-danger); }
    .panel-label { color: var(--iu-muted); font-size: 11.5px; white-space: nowrap; }
    .panel-mini-btn {
      appearance: none; cursor: pointer; padding: 3px 9px; border-radius: 6px;
      border: 1px solid var(--iu-btn-border); background: transparent;
      color: var(--iu-text); font: inherit; font-size: 11.5px; line-height: 1.4;
    }
    .panel-mini-btn:hover:not(:disabled) { background: var(--iu-hover); }
    .panel-mini-btn.active { background: var(--iu-primary); border-color: var(--iu-primary); color: #fff; }
    .panel-mini-btn:disabled { opacity: .4; cursor: default; }
    .panel-mini-btn[hidden] { display: none; }
    .panel-select {
      appearance: none; max-width: 190px; padding: 4px 26px 4px 8px; border-radius: 6px;
      border: 1px solid var(--iu-border); color: var(--iu-text); font: inherit; font-size: 11.5px;
      background: var(--iu-surface-2)
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%239ca3af'/%3E%3C/svg%3E")
        no-repeat right 8px center;
    }
    .panel-check {
      display: inline-flex; align-items: center; gap: 5px;
      color: var(--iu-muted); font-size: 11.5px; cursor: pointer;
    }
    .panel-check input { margin: 0; accent-color: var(--iu-primary); }
    .panel-warning {
      display: none; margin-top: 7px; color: var(--iu-danger); font-size: 11.5px; line-height: 1.45;
    }
    .panel-warning.show { display: block; }
    .panel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .pbtn {
      appearance: none; padding: 5px 12px; border-radius: 7px; cursor: pointer;
      border: 1px solid var(--iu-btn-border); background: transparent;
      color: var(--iu-text); font: inherit; line-height: 1.4;
    }
    .pbtn:hover:not(:disabled) { background: var(--iu-hover); }
    .pbtn.primary { background: var(--iu-primary); border-color: var(--iu-primary); font-weight: 600; color: #fff; }
    .pbtn.primary:hover:not(:disabled) { background: var(--iu-primary-hover); border-color: var(--iu-primary-hover); }
    .pbtn:disabled { opacity: .4; cursor: default; }
    .pbtn:focus-visible { outline: 2px solid var(--iu-primary); outline-offset: 1px; }
    .panel-msg { display: none; margin-top: 8px; color: var(--iu-danger); font-size: 11.5px; }
    .panel-msg.show { display: block; }
    .panel-hint { margin-top: 8px; color: var(--iu-muted); font-size: 11px; }
    @media (pointer: coarse) {
      .hud { max-width: calc(100vw - 20px); top: 10px; padding: 8px 10px; gap: 8px; }
      .hud kbd { display: none; }
      .hud-exit { min-height: 44px; margin: 0; padding: 4px 12px; }
      .panel { bottom: 10px; width: calc(100vw - 16px); padding: 12px; }
      .panel-grip {
        display: flex; align-items: center; justify-content: center;
        height: 26px; margin: -10px -6px 2px;
        touch-action: none; cursor: grab;
      }
      .panel-grip::before {
        content: ""; width: 44px; height: 5px; border-radius: 999px;
        background: var(--iu-btn-border);
      }
      .panel-head { touch-action: none; cursor: grab; }
      .panel.dragging { user-select: none; }
      .panel.dragging, .panel.dragging .panel-grip, .panel.dragging .panel-head { cursor: grabbing; }
      .panel-actions {
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
      }
      .pbtn { min-height: 44px; padding: 8px 12px; font-size: 14px; }
      .panel-mini-btn { min-height: 36px; padding: 6px 10px; font-size: 12.5px; }
      .panel-select { min-height: 36px; font-size: 12.5px; }
      .panel-check { min-height: 36px; }
      .panel-hint { display: none; }
    }
  `;

  const MAX_SELECTOR_LENGTH = IUXX.MAX_SELECTOR_LENGTH;
  const MAX_DEPTH = 32;
  const ATTRIBUTE_CANDIDATES = [
    'data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy',
    'name', 'aria-label', 'role'
  ];
  const EPHEMERAL_CLASSES = new Set([
    'active', 'selected', 'open', 'opened', 'show', 'shown', 'visible', 'hidden',
    'focus', 'focused', 'hover', 'hovered', 'expanded', 'collapsed', 'disabled',
    'enabled', 'current', 'playing', 'loaded', 'loading', 'dragging'
  ]);
  const MEDIA_TAGS = new Set(['img', 'iframe', 'embed', 'video', 'audio', 'source']);

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function countMatches(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  function looksHashedClass(name) {
    if (name.length > 40) return true;
    const parts = name.split(/[-_]+/).filter(Boolean);
    const tail = parts[parts.length - 1] || '';
    if (tail.length >= 4 && /^[a-z0-9]+$/i.test(tail) && /\d/.test(tail) && /[a-z]/i.test(tail)) return true;
    return false;
  }

  function looksDynamicId(id) {
    if (id.length > 64) return true;
    if (/^\d/.test(id)) return true;
    if (/:r[0-9a-z]+:/i.test(id)) return true;
    if (/^(?:ember|react|radix|mui|headlessui|downshift|ng|vue|svelte)-?\d{2,}$/i.test(id)) return true;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5]?[0-9a-f]{3}-[89ab]?[0-9a-f]{3}-[0-9a-f]{12}/i.test(id)) return true;
    if (/(?:^|[-_])(?:id|uid|uuid|guid)[-_]?[0-9a-f]{6,}$/i.test(id)) return true;
    return false;
  }

  function stableClasses(el) {
    const names = Array.from(el.classList)
      .filter((name) => !!name && !/^\d/.test(name) && !looksHashedClass(name));
    const preferred = names.filter((name) => !EPHEMERAL_CLASSES.has(name.toLowerCase()));
    return (preferred.length ? preferred : names).slice(0, 3);
  }

  function selectorForId(el) {
    if (!el.id || looksDynamicId(el.id)) return null;
    const selector = '#' + CSS.escape(el.id);
    return isUnique(selector) ? selector : null;
  }

  function escapeAttrValue(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n\f]/g, ' ');
  }

  function mediaAttributeCandidates(el) {
    const out = [];
    const tag = el.localName;
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        const trimmed = href.trim();
        const withoutHash = trimmed.split('#')[0];
        const clean = withoutHash.split('?')[0];
        if (clean && clean.length <= 220) {
          out.push({ name: 'href', value: clean, op: clean !== trimmed ? '^' : '=' });
        }
      }
    }
    if (MEDIA_TAGS.has(tag)) {
      const src = el.getAttribute('src');
      if (src) {
        const trimmed = src.trim();
        if (trimmed && !trimmed.startsWith('data:') && !trimmed.startsWith('blob:') && trimmed.length <= 300) {
          out.push({ name: 'src', value: trimmed, op: '=' });
        }
      }
    }
    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      if (alt && alt.length <= 120) out.push({ name: 'alt', value: alt, op: '=' });
    }
    return out;
  }

  function attributeCandidates(el) {
    const out = [];
    for (const name of ATTRIBUTE_CANDIDATES) {
      const value = el.getAttribute(name);
      if (!value || value.length > 160) continue;
      out.push({ name, value, op: '=' });
    }
    out.push(...mediaAttributeCandidates(el));
    return out;
  }

  function attributeSelector(el, candidate) {
    return `${el.localName}[${candidate.name}${candidate.op}"${escapeAttrValue(candidate.value)}"]`;
  }

  function selectorForAttributes(el) {
    for (const candidate of attributeCandidates(el)) {
      const selector = attributeSelector(el, candidate);
      if (selector.length <= MAX_SELECTOR_LENGTH && isUnique(selector)) return selector;
    }
    return null;
  }

  function broadAttributeSelector(el) {
    for (const candidate of attributeCandidates(el)) {
      const selector = attributeSelector(el, candidate);
      if (selector.length <= MAX_SELECTOR_LENGTH && countMatches(selector) > 0) return selector;
    }
    return null;
  }

  function selectorForClasses(el) {
    const classes = stableClasses(el);
    if (!classes.length) return null;
    const tag = el.localName;
    const combos = [classes];
    for (const cls of classes) combos.push([cls]);
    for (const combo of combos) {
      const selector = tag + '.' + combo.map((name) => CSS.escape(name)).join('.');
      if (selector.length <= MAX_SELECTOR_LENGTH && isUnique(selector)) return selector;
    }
    return null;
  }

  function sameTypeSiblings(el) {
    const parent = el.parentElement;
    if (!parent) return false;
    let count = 0;
    for (const child of parent.children) {
      if (child.localName === el.localName && ++count > 1) return true;
    }
    return false;
  }

  function nthOfType(el) {
    let index = 1;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.localName === el.localName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function structuralSegment(el) {
    let segment = el.localName;
    const classes = stableClasses(el).slice(0, 2);
    if (classes.length) segment += '.' + classes.map((name) => CSS.escape(name)).join('.');
    if (sameTypeSiblings(el)) segment += `:nth-of-type(${nthOfType(el)})`;
    return segment;
  }

  function generateSelector(el) {
    if (!(el instanceof Element) || !el.isConnected) return null;
    if (el === document.body || el === document.documentElement) return null;

    const idSelector = selectorForId(el);
    if (idSelector) return idSelector;

    const attrSelector = selectorForAttributes(el);
    if (attrSelector) return attrSelector;

    const classSelector = selectorForClasses(el);
    if (classSelector) return classSelector;

    const parts = [];
    let node = el;
    let anchored = false;
    for (let depth = 0; node && depth < MAX_DEPTH; depth += 1) {
      if (node === document.body || node === document.documentElement) {
        parts.unshift(node.localName);
        anchored = true;
        break;
      }
      if (node !== el) {
        const ancestorId = selectorForId(node);
        if (ancestorId) {
          parts.unshift(ancestorId);
          anchored = true;
          break;
        }
        const ancestorAttr = selectorForAttributes(node);
        if (ancestorAttr) {
          parts.unshift(ancestorAttr);
          anchored = true;
          break;
        }
      }
      parts.unshift(structuralSegment(node));
      node = node.parentElement;
    }

    if (!anchored || !parts.length) return null;
    const selector = parts.join(' > ');
    if (selector.length > MAX_SELECTOR_LENGTH) return null;
    return isUnique(selector) ? selector : null;
  }

  function broadPathSelector(el) {
    const parts = [];
    let node = el;
    let anchored = false;
    let strong = false;
    for (let depth = 0; node && depth < 16; depth += 1) {
      if (node !== el) {
        const anchor = selectorForId(node) || selectorForAttributes(node);
        if (anchor) {
          parts.unshift(anchor);
          anchored = true;
          strong = true;
          break;
        }
      }
      const classes = stableClasses(node).slice(0, 2);
      let segment = node.localName;
      if (classes.length) {
        segment += '.' + classes.map((name) => CSS.escape(name)).join('.');
        strong = true;
      }
      if (node !== el && sameTypeSiblings(node)) {
        segment += `:nth-of-type(${nthOfType(node)})`;
      }
      parts.unshift(segment);
      if (node === document.body || node === document.documentElement) {
        anchored = true;
        break;
      }
      node = node.parentElement;
    }
    if (!anchored || !parts.length || !strong) return null;
    const selector = parts.join(' > ');
    return selector.length <= MAX_SELECTOR_LENGTH ? selector : null;
  }

  function generateBroadSelector(el) {
    if (!(el instanceof Element) || !el.isConnected) return null;
    if (el === document.body || el === document.documentElement) return null;

    const candidates = [];
    const classes = stableClasses(el);
    if (classes.length) {
      candidates.push(el.localName + '.' + classes.map((name) => CSS.escape(name)).join('.'));
    }
    const attr = broadAttributeSelector(el);
    if (attr) candidates.push(attr);
    const path = broadPathSelector(el);
    if (path) candidates.push(path);
    const id = selectorForId(el);
    if (id) candidates.push(id);

    const seen = new Set();
    for (const selector of candidates) {
      if (!selector || seen.has(selector) || selector.length > MAX_SELECTOR_LENGTH) continue;
      seen.add(selector);
      const count = countMatches(selector);
      if (count > 0) return { selector, count };
    }
    return null;
  }

  function createPicker(options) {
    const mode = options.mode === 'zap' ? 'zap' : 'block';
    const root = document.createElement(HOST_TAG);
    root.style.cssText =
      'all: initial !important; position: fixed !important; left: 0 !important; top: 0 !important;' +
      'width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;' +
      'display: block !important;';
    const shadow = root.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = PICKER_CSS;

    const hl = document.createElement('div');
    hl.className = 'hl';
    const tip = document.createElement('div');
    tip.className = 'tip';
    const hud = document.createElement('div');
    hud.className = 'hud';
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const hudText = document.createElement('span');
    const hudKey = document.createElement('kbd');
    hudKey.textContent = 'Esc';
    const hudCount = document.createElement('span');
    hudCount.className = 'hud-count';
    const hudExit = document.createElement('button');
    hudExit.type = 'button';
    hudExit.className = 'hud-exit';
    hudExit.textContent = t('exit');
    hud.append(dot, hudText);
    if (mode === 'zap') hud.append(hudCount);
    hud.append(hudKey, hudExit);
    hudText.textContent = mode === 'zap'
      ? (coarsePointer ? t('pickerHudZapTap') : t('pickerHudZap'))
      : (coarsePointer ? t('pickerHudTap') : t('pickerHudClick'));

    let panel = null;
    let panelGrip = null;
    let panelHead = null;
    let panelDesc = null;
    let panelDepth = null;
    let panelSelector = null;
    let panelMsg = null;
    let matchText = null;
    let matchToggleBtn = null;
    let previewBtn = null;
    let scopeSelect = null;
    let pathCheck = null;
    let panelWarning = null;
    let shrinkBtn = null;
    let growBtn = null;
    let reselectBtn = null;
    let confirmBtn = null;

    if (mode === 'block') {
      panel = document.createElement('div');
      panel.className = 'panel';
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', t('rangePanelAria'));

      panelGrip = document.createElement('div');
      panelGrip.className = 'panel-grip';
      panelGrip.setAttribute('aria-hidden', 'true');

      panelHead = document.createElement('div');
      panelHead.className = 'panel-head';
      const panelTitle = document.createElement('span');
      panelTitle.className = 'panel-title';
      panelTitle.textContent = t('selectionRange');
      panelDepth = document.createElement('span');
      panelDepth.className = 'panel-depth';
      panelHead.append(panelTitle, panelDepth);

      panelDesc = document.createElement('div');
      panelDesc.className = 'panel-desc';

      panelSelector = document.createElement('input');
      panelSelector.type = 'text';
      panelSelector.className = 'panel-selector';
      panelSelector.spellcheck = false;
      panelSelector.autocomplete = 'off';
      panelSelector.setAttribute('aria-label', t('selectorInputAria'));

      const matchRow = document.createElement('div');
      matchRow.className = 'panel-row';
      matchText = document.createElement('span');
      matchText.className = 'panel-match-text';
      matchToggleBtn = document.createElement('button');
      matchToggleBtn.type = 'button';
      matchToggleBtn.className = 'panel-mini-btn';
      matchToggleBtn.hidden = true;
      previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'panel-mini-btn';
      previewBtn.textContent = t('preview');
      previewBtn.setAttribute('aria-pressed', 'false');
      matchRow.append(matchText, matchToggleBtn, previewBtn);

      const scopeRow = document.createElement('div');
      scopeRow.className = 'panel-row';
      const scopeLabel = document.createElement('span');
      scopeLabel.className = 'panel-label';
      scopeLabel.textContent = t('applyScope');
      scopeSelect = document.createElement('select');
      scopeSelect.className = 'panel-select';
      scopeSelect.setAttribute('aria-label', t('applyScope'));
      for (const value of ['host', 'domain', 'global']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === 'host'
          ? t('scopeHost')
          : (value === 'domain' ? t('scopeDomain') : t('scopeGlobal'));
        scopeSelect.appendChild(option);
      }
      pathCheck = document.createElement('input');
      pathCheck.type = 'checkbox';
      const pathLabel = document.createElement('label');
      pathLabel.className = 'panel-check';
      pathLabel.append(pathCheck, document.createTextNode(t('onlyThisPath')));
      pathLabel.title = t('pathScopeTitle', [normalizePath(location.pathname) || '/']);
      scopeRow.append(scopeLabel, scopeSelect, pathLabel);

      panelWarning = document.createElement('div');
      panelWarning.className = 'panel-warning';

      const panelActions = document.createElement('div');
      panelActions.className = 'panel-actions';
      shrinkBtn = document.createElement('button');
      shrinkBtn.type = 'button';
      shrinkBtn.className = 'pbtn';
      shrinkBtn.textContent = t('shrinkRange');
      shrinkBtn.title = t('shrinkRangeTitle');
      growBtn = document.createElement('button');
      growBtn.type = 'button';
      growBtn.className = 'pbtn';
      growBtn.textContent = t('growRange');
      growBtn.title = t('growRangeTitle');
      reselectBtn = document.createElement('button');
      reselectBtn.type = 'button';
      reselectBtn.className = 'pbtn';
      reselectBtn.textContent = t('reselect');
      confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'pbtn primary';
      confirmBtn.textContent = t('block');
      confirmBtn.title = t('blockTitle');
      panelActions.append(shrinkBtn, growBtn, reselectBtn, confirmBtn);

      panelMsg = document.createElement('div');
      panelMsg.className = 'panel-msg';
      const panelHint = document.createElement('div');
      panelHint.className = 'panel-hint';
      panelHint.textContent = t('pickerHintBar');

      panel.append(panelGrip, panelHead, panelDesc, panelSelector, matchRow, scopeRow, panelWarning, panelActions, panelMsg, panelHint);
    }

    shadow.append(style, hl, tip, hud);
    if (panel) shadow.appendChild(panel);
    document.documentElement.appendChild(root);
    hud.classList.remove('hide');

    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = 'html, html * { cursor: crosshair !important; }';
    (document.head || document.documentElement).appendChild(cursorStyle);

    let hoverInfo = null;
    const lastPoint = { x: -1, y: -1 };
    let selection = null;
    let selectionInShadow = false;
    let baseInShadow = false;
    let uniqueSelector = '';
    let broadSelector = '';
    let broadCount = 0;
    let matchState = { valid: false, count: 0, unsafe: false };
    let previewOn = false;
    let matchStyleEl = null;
    let previewStyleEl = null;
    let saving = false;
    let rafId = 0;
    let destroyed = false;
    let dragPointerId = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let dragWidth = 0;
    let dragHeight = 0;
    let dragMinTop = 6;
    let panelMoved = false;
    let selectedPath = '';
    const zapped = [];

    function isOwnEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (path.includes(root)) return true;
      return !!(notice && path.includes(notice.root));
    }

    function isPageElement(el) {
      return !!el && el !== document.body && el !== document.documentElement &&
        el.localName !== HOST_TAG && el.localName !== TOAST_TAG;
    }

    function targetInfoFromEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      let deep = null;
      for (const node of path) {
        if (node === root) return null;
        if (!(node instanceof Element)) continue;
        if (!deep) deep = node;
        if (node.getRootNode() === document && isPageElement(node)) {
          const inShadow = !!(deep && deep !== node && deep.getRootNode() instanceof ShadowRoot);
          return { el: node, inShadow };
        }
      }
      return null;
    }

    function deepElementFromPoint(x, y) {
      if (x < 0 || y < 0) return null;
      let el = document.elementFromPoint(x, y);
      let guard = 0;
      while (el && el.shadowRoot && guard < 10) {
        guard += 1;
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el;
    }

    function targetInfoFromPoint(x, y) {
      const deep = deepElementFromPoint(x, y);
      if (!deep) return null;
      const inShadow = deep.getRootNode() instanceof ShadowRoot;
      let el = deep;
      while (el && el.getRootNode && el.getRootNode() !== document) {
        const nodeRoot = el.getRootNode();
        if (nodeRoot instanceof ShadowRoot) el = nodeRoot.host;
        else el = el.parentElement;
      }
      if (!(el instanceof Element) || el === root || !isPageElement(el)) return null;
      return { el, inShadow };
    }

    function currentElement() {
      return selection ? selection[selection.length - 1] : null;
    }

    function schedulePaint() {
      if (rafId || destroyed) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        paint();
      });
    }

    function paint() {
      if (destroyed) return;
      const info = selection ? { el: currentElement(), inShadow: selectionInShadow } : hoverInfo;
      const el = info && info.el;
      if (!el || !el.isConnected) {
        hl.style.display = 'none';
        tip.style.display = 'none';
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        hl.style.display = 'none';
        tip.style.display = 'none';
        return;
      }
      hl.style.display = 'block';
      hl.style.left = `${rect.left}px`;
      hl.style.top = `${rect.top}px`;
      hl.style.width = `${rect.width}px`;
      hl.style.height = `${rect.height}px`;

      if (selection) {
        tip.style.display = 'none';
        return;
      }
      tip.style.display = 'block';
      let label = describeElement(el) || el.localName;
      if (info.inShadow) label += ' · ' + t('shadowTag');
      tip.textContent = label;
      const margin = 4;
      const tipWidth = Math.min(tip.offsetWidth, window.innerWidth - margin * 2);
      const tipHeight = tip.offsetHeight;
      const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - tipWidth - margin));
      let top = rect.top - tipHeight - 6;
      if (top < margin) top = Math.min(rect.bottom + 6, window.innerHeight - tipHeight - margin);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }

    function setPageStyle(el, css) {
      if (!css) {
        if (el) el.remove();
        return null;
      }
      let styleEl = el;
      if (!styleEl || !styleEl.isConnected) {
        const host = document.head || document.documentElement;
        if (!host) return null;
        styleEl = document.createElement('style');
        host.appendChild(styleEl);
      }
      styleEl.textContent = css;
      return styleEl;
    }

    function inspectSelector(value) {
      if (!value) return { valid: false, count: 0, unsafe: false, error: false };
      if (value.length > MAX_SELECTOR_LENGTH || /[{}]/.test(value) || /[\r\n\0]/.test(value)) {
        return { valid: false, count: 0, unsafe: false, error: true };
      }
      if (selectorTargetsRoot(value)) {
        return { valid: false, count: 0, unsafe: true, error: false };
      }
      let nodes;
      try {
        nodes = document.querySelectorAll(value);
      } catch {
        return { valid: false, count: 0, unsafe: false, error: true };
      }
      let unsafe = false;
      for (const node of nodes) {
        if (node === document.body || node === document.documentElement ||
            node === root || (notice && node === notice.root) ||
            node.localName === HOST_TAG || node.localName === TOAST_TAG) {
          unsafe = true;
          break;
        }
      }
      return { valid: true, count: nodes.length, unsafe, error: false };
    }

    function updateDerivedStyles() {
      if (mode !== 'block') return;
      const value = panelSelector.value.trim();
      let matchCss = '';
      if (!previewOn && matchState.valid && !matchState.unsafe &&
          matchState.count > 1 && matchState.count <= 200) {
        matchCss = `${value} { outline: 2px dashed rgba(239, 68, 68, .9) !important; outline-offset: -2px !important; }`;
      }
      matchStyleEl = setPageStyle(matchStyleEl, matchCss);

      let previewCss = '';
      if (previewOn && matchState.valid && !matchState.unsafe && matchState.count > 0) {
        previewCss = `${value} { display: none !important; }`;
      }
      previewStyleEl = setPageStyle(previewStyleEl, previewCss);
    }

    function refreshMatchToggle() {
      const value = panelSelector.value.trim();
      let target = '';
      let label = '';
      if (uniqueSelector && broadSelector && uniqueSelector !== broadSelector) {
        if (value === uniqueSelector) {
          target = broadSelector;
          label = t('matchSimilar', [String(broadCount)]);
        } else if (value === broadSelector) {
          target = uniqueSelector;
          label = t('matchSingle');
        } else {
          target = uniqueSelector;
          label = t('useAutoSelector');
        }
      } else if (uniqueSelector && value !== uniqueSelector) {
        target = uniqueSelector;
        label = t('useAutoSelector');
      } else if (!uniqueSelector && broadSelector && value !== broadSelector) {
        target = broadSelector;
        label = t('useAutoSelector');
      }
      matchToggleBtn.hidden = !target;
      matchToggleBtn.textContent = label;
      matchToggleBtn.dataset.target = target;
    }

    function refreshPanel() {
      if (mode !== 'block' || !panel || !selection) return;
      const el = currentElement();
      if (!el) return;
      panelDepth.textContent = selection.length > 1 ? t('selectionDepth', [String(selection.length)]) : '';
      panelDesc.textContent = describeElement(el) || el.localName;
      panelDesc.title = panelDesc.textContent;

      const value = panelSelector.value.trim();
      matchState = inspectSelector(value);
      if (previewOn && (!matchState.valid || matchState.unsafe || matchState.count === 0)) {
        previewOn = false;
      }
      previewBtn.classList.toggle('active', previewOn);
      previewBtn.setAttribute('aria-pressed', previewOn ? 'true' : 'false');
      previewBtn.textContent = previewOn ? t('previewOff') : t('preview');
      previewBtn.disabled = saving || !matchState.valid || matchState.unsafe || matchState.count === 0;

      matchText.classList.toggle('warn',
        !matchState.valid || matchState.unsafe || matchState.count === 0 || matchState.count > 100);
      if (!value) {
        matchText.textContent = t('noSelector');
      } else if (!matchState.valid) {
        matchText.textContent = t('selectorInvalid');
      } else if (matchState.unsafe) {
        matchText.textContent = t('selectorUnsafe');
      } else if (matchState.count === 0) {
        matchText.textContent = t('selectorNoMatch');
      } else if (matchState.count > 100) {
        matchText.textContent = t('matchCountLarge', [String(matchState.count)]);
      } else {
        matchText.textContent = t('matchCount', [String(matchState.count)]);
      }

      refreshMatchToggle();
      const parent = el.parentElement;
      shrinkBtn.disabled = saving || !selection || selection.length <= 1;
      growBtn.disabled = saving || !parent || parent === document.body || parent === document.documentElement;
      reselectBtn.disabled = saving;
      confirmBtn.disabled = saving || !matchState.valid || matchState.unsafe || matchState.count === 0;
      confirmBtn.textContent = saving ? t('blocking') : t('block');

      let warning = '';
      if (selectionInShadow) warning = t('shadowWarning');
      if (scopeSelect.value === 'global') {
        warning += (warning ? ' ' : '') + t('globalScopeWarning');
      }
      panelWarning.textContent = warning;
      panelWarning.classList.toggle('show', !!warning);

      updateDerivedStyles();
    }

    function clearDerivedStyles() {
      matchStyleEl = setPageStyle(matchStyleEl, '');
      previewStyleEl = setPageStyle(previewStyleEl, '');
      previewOn = false;
    }

    function recomputeSelection() {
      const el = currentElement();
      uniqueSelector = el && el.isConnected ? generateSelector(el) || '' : '';
      broadSelector = '';
      broadCount = 0;
      if (el && el.isConnected) {
        const broad = generateBroadSelector(el);
        if (broad && broad.selector !== uniqueSelector && (!uniqueSelector || broad.count > 1)) {
          broadSelector = broad.selector;
          broadCount = broad.count;
        }
      }
      if (uniqueSelector) {
        panelSelector.value = uniqueSelector;
      } else if (broadSelector) {
        panelSelector.value = broadSelector;
      } else {
        panelSelector.value = '';
      }
      refreshPanel();
    }

    function showMessage(text) {
      if (!panelMsg) return;
      panelMsg.textContent = text || '';
      panelMsg.classList.toggle('show', !!text);
      clampPanelToViewport();
    }

    function panelTopLimit() {
      const margin = 6;
      if (!hud.classList.contains('hide')) {
        const rect = hud.getBoundingClientRect();
        if (rect.height > 0) return Math.max(margin, rect.bottom + 8);
      }
      return margin;
    }

    function clampPanelToViewport() {
      if (!panel || !panelMoved || destroyed || !panel.classList.contains('show')) return;
      const rect = panel.getBoundingClientRect();
      const margin = 6;
      const minTop = panelTopLimit();
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(minTop, window.innerHeight - rect.height - margin);
      const left = Math.min(Math.max(margin, rect.left), maxLeft);
      const top = Math.min(Math.max(minTop, rect.top), maxTop);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }

    function startPanelDrag(event) {
      if (mode !== 'block' || dragPointerId !== null || event.button !== 0 ||
          !panel.classList.contains('show')) return;
      const rect = panel.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      dragPointerId = event.pointerId;
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      dragWidth = rect.width;
      dragHeight = rect.height;
      dragMinTop = panelTopLimit();
      panelMoved = true;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
      panel.classList.add('dragging');
      if (panelGrip.setPointerCapture) {
        try {
          panelGrip.setPointerCapture(event.pointerId);
        } catch {
        }
      }
      event.preventDefault();
    }

    function movePanelDrag(event) {
      if (dragPointerId === null || event.pointerId !== dragPointerId) return;
      event.preventDefault();
      const margin = 6;
      const maxLeft = Math.max(margin, window.innerWidth - dragWidth - margin);
      const maxTop = Math.max(dragMinTop, window.innerHeight - dragHeight - margin);
      const left = Math.min(Math.max(margin, event.clientX - dragOffsetX), maxLeft);
      const top = Math.min(Math.max(dragMinTop, event.clientY - dragOffsetY), maxTop);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }

    function endPanelDrag(event) {
      if (dragPointerId === null || event.pointerId !== dragPointerId) return;
      if (panelGrip.hasPointerCapture && panelGrip.hasPointerCapture(event.pointerId)) {
        panelGrip.releasePointerCapture(event.pointerId);
      }
      dragPointerId = null;
      panel.classList.remove('dragging');
    }

    function selectElement(info) {
      if (!info || !info.el || !isPageElement(info.el) || !info.el.isConnected || saving) return;
      selection = [info.el];
      baseInShadow = !!info.inShadow;
      selectionInShadow = baseInShadow;
      hoverInfo = null;
      if (coarsePointer) {
        hudText.textContent = t('pickerHudReselect');
      } else {
        hud.classList.add('hide');
      }
      panel.classList.add('show');
      showMessage('');
      recomputeSelection();
    }

    function growRange() {
      if (!selection || saving) return;
      const parent = currentElement().parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) {
        showMessage(t('outermostRange'));
        return;
      }
      selection.push(parent);
      selectionInShadow = false;
      showMessage('');
      recomputeSelection();
    }

    function shrinkRange() {
      if (!selection || saving || selection.length <= 1) return;
      selection.pop();
      selectionInShadow = selection.length === 1 ? baseInShadow : false;
      showMessage('');
      recomputeSelection();
    }

    function resetSelection() {
      if (!selection || saving) return;
      selection = null;
      selectionInShadow = false;
      baseInShadow = false;
      uniqueSelector = '';
      broadSelector = '';
      matchState = { valid: false, count: 0, unsafe: false };
      clearDerivedStyles();
      panel.classList.remove('show');
      hud.classList.remove('hide');
      hudText.textContent = coarsePointer ? t('pickerHudTap') : t('pickerHudClick');
      panelSelector.value = '';
      showMessage('');
      if (lastPoint.x >= 0) hoverInfo = targetInfoFromPoint(lastPoint.x, lastPoint.y);
      schedulePaint();
    }

    async function confirmSelection() {
      if (mode !== 'block' || !selection || saving) return;
      const el = currentElement();
      if (!el || !el.isConnected) {
        showMessage(t('elementGone'));
        return;
      }
      const selector = panelSelector.value.trim();
      if (!selector) {
        showMessage(t('selectorFailed'));
        return;
      }
      const state = inspectSelector(selector);
      if (!state.valid || state.unsafe || state.count === 0) {
        showMessage(state.unsafe ? t('selectorUnsafe') : t('selectorRequired'));
        return;
      }

      const scope = scopeSelect.value;
      const path = selectedPath;
      const preview = describeElement(el);
      saving = true;
      panelMsg.classList.remove('show');
      refreshPanel();

      let result;
      try {
        result = await api.runtime.sendMessage({
          type: 'ADD_RULE',
          hostname,
          selector,
          preview,
          scope,
          path
        });
      } catch {
        if (destroyed) return;
        saving = false;
        showMessage(t('extensionUpdated'));
        refreshPanel();
        return;
      }
      if (destroyed) return;

      if (!result || !result.ok) {
        saving = false;
        if (result && result.error === 'whitelisted') showMessage(t('siteWhitelisted'));
        else if (result && result.error === 'limit') showMessage(t('ruleLimit'));
        else if (result && result.error === 'limitTotal') showMessage(t('ruleLimitTotal'));
        else showMessage(t('saveFailed'));
        refreshPanel();
        return;
      }
      if (result.duplicate) {
        saving = false;
        showMessage(result.rule && result.rule.enabled === false
          ? t('alreadyBlockedDisabled')
          : t('alreadyBlocked'));
        refreshPanel();
        return;
      }

      saving = false;
      previewOn = false;
      const ruleId = result.rule && result.rule.id;
      const undoAction = ruleId
        ? async () => {
          const removed = await api.runtime.sendMessage({ type: 'REMOVE_RULE', id: ruleId });
          if (!removed || !removed.ok) return false;
          await syncFromStorage();
          return true;
        }
        : null;
      await syncFromStorage();
      if (settings.keepPickerOpen) {
        if (panel) resetSelection();
      } else {
        stopPicker();
      }
      notify(t('blockSuccess'), undoAction ? {
        actionLabel: t('undo'),
        onAction: undoAction,
        doneText: t('undone'),
        failText: t('undoFailed')
      } : {});
    }

    function isScrollLockCandidate(el) {
      let node = el;
      while (node && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if (style.position === 'fixed' || style.position === 'sticky') return true;
        node = node.parentElement;
      }
      return false;
    }

    function unlockScrollIfNeeded(el) {
      if (!isScrollLockCandidate(el)) return;
      const body = document.body;
      const docEl = document.documentElement;
      if (!body || !docEl) return;
      try {
        if (getComputedStyle(body).overflowY === 'hidden') {
          body.style.setProperty('overflow', 'auto', 'important');
        }
        if (getComputedStyle(body).position === 'fixed') {
          body.style.setProperty('position', 'initial', 'important');
        }
        if (getComputedStyle(docEl).overflowY === 'hidden') {
          docEl.style.setProperty('overflow', 'auto', 'important');
        }
        if (getComputedStyle(docEl).position === 'fixed') {
          docEl.style.setProperty('position', 'initial', 'important');
        }
      } catch {
      }
    }

    function updateZapHud() {
      hudCount.textContent = zapped.length ? t('zapCount', [String(zapped.length)]) : '';
    }

    function undoZap() {
      const entry = zapped.pop();
      if (!entry) return false;
      const { el, parent, next } = entry;
      if (!parent || !parent.isConnected) return false;
      try {
        if (next && next.parentNode === parent) parent.insertBefore(el, next);
        else parent.appendChild(el);
      } catch {
        return false;
      }
      updateZapHud();
      return true;
    }

    function zapElement(info) {
      if (!info || !info.el || !isPageElement(info.el)) return;
      const el = info.el;
      if (el === document.body || el === document.documentElement) return;
      const parent = el.parentElement;
      if (!parent) return;
      const next = el.nextSibling;
      unlockScrollIfNeeded(el);
      el.remove();
      zapped.push({ el, parent, next });
      updateZapHud();
      hoverInfo = null;
      if (lastPoint.x >= 0) hoverInfo = targetInfoFromPoint(lastPoint.x, lastPoint.y);
      schedulePaint();
      notify(t('zapSuccess'), {
        actionLabel: t('undo'),
        onAction: undoZap,
        doneText: t('zapUndone'),
        failText: t('undoFailed'),
        duration: 9000
      });
    }

    function stopAndReport() {
      if (mode === 'zap' && zapped.length) {
        notify(t('zapExitHint', [String(zapped.length)]));
      }
      stopPicker();
    }

    function onMouseMove(event) {
      lastPoint.x = event.clientX;
      lastPoint.y = event.clientY;
      if (selection) return;
      hoverInfo = targetInfoFromEvent(event);
      schedulePaint();
    }

    function onMouseLeave() {
      if (selection) return;
      hoverInfo = null;
      schedulePaint();
    }

    function onMouseOut(event) {
      if (!event.relatedTarget) onMouseLeave();
    }

    function onClick(event) {
      if (isOwnEvent(event)) return;
      const info = targetInfoFromEvent(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (!info) return;
      if (mode === 'zap') zapElement(info);
      else selectElement(info);
    }

    function onGuard(event) {
      if (isOwnEvent(event)) return;
      if (event.type === 'contextmenu' || event.type === 'dblclick' ||
          event.type === 'selectstart' || event.type === 'dragstart' ||
          event.type === 'auxclick') {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
      event.stopPropagation();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        if (mode === 'zap') stopAndReport();
        else stopPicker();
        return;
      }
      if (mode === 'zap') {
        if ((event.key === 'Delete' || event.key === 'Backspace') &&
            hoverInfo && !isOwnEvent(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          zapElement(hoverInfo);
        }
        return;
      }
      if (!selection || isOwnEvent(event)) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        growRange();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        shrinkRange();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        confirmSelection();
      }
    }

    function onViewportChange() {
      clampPanelToViewport();
      if (selection) {
        schedulePaint();
        return;
      }
      if (lastPoint.x >= 0) hoverInfo = targetInfoFromPoint(lastPoint.x, lastPoint.y);
      schedulePaint();
    }

    hudExit.addEventListener('click', () => {
      if (mode === 'zap') stopAndReport();
      else stopPicker();
    });

    if (mode === 'block') {
      panelGrip.addEventListener('pointerdown', startPanelDrag);
      panelHead.addEventListener('pointerdown', startPanelDrag);
      shrinkBtn.addEventListener('click', () => {
        shrinkRange();
        shrinkBtn.blur();
      });
      growBtn.addEventListener('click', () => {
        growRange();
        growBtn.blur();
      });
      reselectBtn.addEventListener('click', () => {
        resetSelection();
        reselectBtn.blur();
      });
      confirmBtn.addEventListener('click', confirmSelection);
      scopeSelect.addEventListener('change', refreshPanel);
      pathCheck.addEventListener('change', () => {
        selectedPath = pathCheck.checked ? normalizePath(location.pathname) : '';
        refreshPanel();
      });
      previewBtn.addEventListener('click', () => {
        if (!selection) return;
        previewOn = !previewOn;
        refreshPanel();
        previewBtn.blur();
      });
      matchToggleBtn.addEventListener('click', () => {
        const target = matchToggleBtn.dataset.target || '';
        if (!target) return;
        panelSelector.value = target;
        showMessage('');
        refreshPanel();
        matchToggleBtn.blur();
      });
      panelSelector.addEventListener('input', () => {
          showMessage('');
        refreshPanel();
      });
      panelSelector.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          confirmSelection();
        }
      });
    }

    const guardTypes = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick',
      'contextmenu', 'dragstart', 'selectstart', 'auxclick', 'touchstart', 'touchend'];
    guardTypes.forEach((type) => window.addEventListener(type, onGuard, true));
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseout', onMouseOut, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange, true);
    if (mode === 'block') {
      window.addEventListener('pointermove', movePanelDrag, { passive: false });
      window.addEventListener('pointerup', endPanelDrag);
      window.addEventListener('pointercancel', endPanelDrag);
    }

    return {
      mode,
      preselectAt(x, y) {
        const info = targetInfoFromPoint(x, y);
        if (!info) return;
        lastPoint.x = x;
        lastPoint.y = y;
        if (mode === 'zap') {
          hoverInfo = info;
          schedulePaint();
        } else {
          selectElement(info);
        }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        guardTypes.forEach((type) => window.removeEventListener(type, onGuard, true));
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('mouseout', onMouseOut, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('scroll', onViewportChange, true);
        window.removeEventListener('resize', onViewportChange, true);
        if (mode === 'block') {
          window.removeEventListener('pointermove', movePanelDrag, { passive: false });
          window.removeEventListener('pointerup', endPanelDrag);
          window.removeEventListener('pointercancel', endPanelDrag);
        }
        clearDerivedStyles();
        cursorStyle.remove();
        root.remove();
      }
    };
  }
})();