(function () {
  'use strict';
  if (globalThis.__IUXX_CONTENT_LOADED__) return;
  globalThis.__IUXX_CONTENT_LOADED__ = true;

  const {
    api,
    RULES_KEY,
    WHITELIST_KEY,
    normalizeDomain,
    readStore,
    stateForHost,
    describeElement,
    readCache,
    writeCache,
    t
  } = IUXX;

  const hostname = normalizeDomain(location.hostname);
  if (!hostname) return;

  const HOST_TAG = 'iuxx-picker-host';
  const TOAST_TAG = 'iuxx-toast-host';

  let selectors = [];
  let whitelisted = false;
  let styleEl = null;
  let picker = null;
  let notice = null;
  let syncToken = 0;
  let resolveReady = null;
  const stateReady = new Promise((resolve) => {
    resolveReady = resolve;
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'START_PICKER') {
      startPicker();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PING') {
      sendResponse({ ok: true, hostname });
      return false;
    }
    return false;
  });

  api.storage.onChanged.addListener(onStorageChanged);
  init();

  async function init() {
    try {
      const cached = readCache();
      if (cached && cached.host === hostname) {
        selectors = cached.selectors.filter(isValidSelector);
        renderStyle(selectors);
      }
      await syncFromStorage();
    } catch {
    } finally {
      resolveReady();
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (!(RULES_KEY in changes) && !(WHITELIST_KEY in changes)) return;
    syncFromStorage();
  }

  async function syncFromStorage() {
    const token = ++syncToken;
    try {
      const store = await readStore();
      if (token !== syncToken) return;
      const state = stateForHost(store, hostname);
      whitelisted = state.whitelisted;
      selectors = whitelisted
        ? []
        : state.rules.map((rule) => rule && rule.selector).filter(isValidSelector);
      writeCache(selectors);
      renderStyle(selectors);
      if (whitelisted && picker) {
        stopPicker();
        notify(t('notifyWhitelistEnabled'));
      }
    } catch {
    }
  }

  function isValidSelector(selector) {
    if (typeof selector !== 'string' || !selector) return false;
    try {
      document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }

  function renderStyle(list) {
    if (!list.length) {
      if (styleEl) {
        styleEl.remove();
        styleEl = null;
      }
      return;
    }
    if (!styleEl || !styleEl.isConnected) {
      const root = document.head || document.documentElement;
      if (!root) {
        document.addEventListener('DOMContentLoaded', () => renderStyle(selectors), { once: true });
        return;
      }
      styleEl = document.createElement('style');
      root.appendChild(styleEl);
    }
    styleEl.textContent = list
      .map((selector) => `${selector} { display: none !important; }`)
      .join('\n');
  }

  async function startPicker() {
    await stateReady;
    if (whitelisted) {
      notify(t('notifyWhitelistedSite'));
      return;
    }
    if (picker || !document.documentElement) return;
    clearNotice();
    picker = createPicker();
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
    .toast button:hover { background: var(--iu-hover); }
    * { -webkit-tap-highlight-color: transparent; }
    @media (pointer: coarse) {
      .toast { padding: 11px 14px; }
      .toast button { min-height: 40px; padding: 6px 12px; }
    }
  `;

  function notify(text, ruleId) {
    clearNotice();
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
    const textEl = document.createElement('span');
    textEl.textContent = text;
    toast.appendChild(textEl);

    const current = { root, textEl, button: null, timer: 0 };
    if (ruleId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = t('undo');
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await api.runtime.sendMessage({ type: 'REMOVE_RULE', hostname, id: ruleId });
          if (!result || !result.ok) throw new Error('remove failed');
          await syncFromStorage();
          if (!notice || notice !== current) return;
          textEl.textContent = t('undone');
          button.remove();
          armNotice(2600);
        } catch {
          if (!notice || notice !== current) return;
          textEl.textContent = t('undoFailed');
          button.disabled = false;
        }
      });
      current.button = button;
      toast.appendChild(button);
    }

    shadow.append(style, toast);
    document.documentElement.appendChild(root);
    notice = current;
    armNotice(ruleId ? 9000 : 3200);
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
    .hud .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--iu-primary); }
    .hud kbd {
      display: inline-block; padding: 1px 5px; border-radius: 4px;
      border: 1px solid var(--iu-kbd-border); background: var(--iu-kbd-bg);
      font: 11px/1.4 ui-monospace, monospace;
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
      display: none; width: min(640px, calc(100vw - 24px)); padding: 12px 14px;
      max-height: calc(100vh - 24px); overflow-y: auto;
      border-radius: 12px; background: var(--iu-surface); color: var(--iu-text);
      border: 1px solid var(--iu-border);
      box-shadow: var(--iu-shadow); pointer-events: auto;
      z-index: 6; font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .panel.show { display: block; }
    .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .panel-title { font-weight: 650; font-size: 13px; }
    .panel-depth { color: var(--iu-muted); font-size: 11.5px; white-space: nowrap; }
    .panel-desc {
      margin-top: 2px; color: var(--iu-text); font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .panel-selector {
      margin-top: 6px; padding: 5px 7px; border-radius: 6px;
      background: var(--iu-surface-2); color: var(--iu-muted);
      font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
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
      .panel-actions {
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
      }
      .pbtn { min-height: 44px; padding: 8px 12px; font-size: 14px; }
      .panel-hint { display: none; }
    }
  `;

  function createPicker() {
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
    hudText.textContent = coarsePointer ? t('pickerHudTap') : t('pickerHudClick');
    const hudKey = document.createElement('kbd');
    hudKey.textContent = 'Esc';
    const hudExit = document.createElement('button');
    hudExit.type = 'button';
    hudExit.className = 'hud-exit';
    hudExit.textContent = t('exit');
    hudExit.addEventListener('click', stopPicker);
    hud.append(dot, hudText, hudKey, hudExit);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', t('rangePanelAria'));

    const panelHead = document.createElement('div');
    panelHead.className = 'panel-head';
    const panelTitle = document.createElement('span');
    panelTitle.className = 'panel-title';
    panelTitle.textContent = t('selectionRange');
    const panelDepth = document.createElement('span');
    panelDepth.className = 'panel-depth';
    panelHead.append(panelTitle, panelDepth);

    const panelDesc = document.createElement('div');
    panelDesc.className = 'panel-desc';
    const panelSelector = document.createElement('div');
    panelSelector.className = 'panel-selector';

    const panelActions = document.createElement('div');
    panelActions.className = 'panel-actions';
    const shrinkBtn = document.createElement('button');
    shrinkBtn.type = 'button';
    shrinkBtn.className = 'pbtn';
    shrinkBtn.textContent = t('shrinkRange');
    shrinkBtn.title = t('shrinkRangeTitle');
    const growBtn = document.createElement('button');
    growBtn.type = 'button';
    growBtn.className = 'pbtn';
    growBtn.textContent = t('growRange');
    growBtn.title = t('growRangeTitle');
    const reselectBtn = document.createElement('button');
    reselectBtn.type = 'button';
    reselectBtn.className = 'pbtn';
    reselectBtn.textContent = t('reselect');
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'pbtn primary';
    confirmBtn.textContent = t('block');
    confirmBtn.title = t('blockTitle');
    panelActions.append(shrinkBtn, growBtn, reselectBtn, confirmBtn);

    const panelMsg = document.createElement('div');
    panelMsg.className = 'panel-msg';
    const panelHint = document.createElement('div');
    panelHint.className = 'panel-hint';
    panelHint.textContent = t('pickerHintBar');

    panel.append(panelHead, panelDesc, panelSelector, panelActions, panelMsg, panelHint);
    shadow.append(style, hl, tip, hud, panel);
    document.documentElement.appendChild(root);

    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = 'html, html * { cursor: crosshair !important; }';
    (document.head || document.documentElement).appendChild(cursorStyle);

    let hoverEl = null;
    let lastPoint = { x: -1, y: -1 };
    let selection = null;
    let selectedSelector = '';
    let saving = false;
    let rafId = 0;
    let destroyed = false;

    function isOwnEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      return path.includes(root);
    }

    function isPageElement(el) {
      return !!el && el !== document.body && el !== document.documentElement;
    }

    function lightElementFromTarget(target) {
      let el = target;
      while (el && el.getRootNode && el.getRootNode() !== document) {
        const nodeRoot = el.getRootNode();
        if (nodeRoot instanceof ShadowRoot) el = nodeRoot.host;
        else el = el.parentElement;
      }
      return el instanceof Element ? el : null;
    }

    function targetFromEvent(event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      for (const node of path) {
        if (node === root) return null;
        if (!(node instanceof Element)) continue;
        if (node.getRootNode() === document && isPageElement(node)) return node;
      }
      return null;
    }

    function targetFromPoint(x, y) {
      if (x < 0 || y < 0) return null;
      let el = document.elementFromPoint(x, y);
      el = lightElementFromTarget(el);
      if (el === root || !isPageElement(el)) return null;
      return el;
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
      const el = selection ? currentElement() : hoverEl;
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
      tip.textContent = describeElement(el) || el.localName;
      const margin = 4;
      const tipWidth = Math.min(tip.offsetWidth, window.innerWidth - margin * 2);
      const tipHeight = tip.offsetHeight;
      const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - tipWidth - margin));
      let top = rect.top - tipHeight - 6;
      if (top < margin) top = Math.min(rect.bottom + 6, window.innerHeight - tipHeight - margin);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }

    function showMessage(text) {
      panelMsg.textContent = text || '';
      panelMsg.classList.toggle('show', !!text);
    }

    function syncButtons() {
      const el = currentElement();
      const parent = el && el.parentElement;
      shrinkBtn.disabled = saving || !selection || selection.length <= 1;
      growBtn.disabled = saving || !parent || parent === document.body || parent === document.documentElement;
      reselectBtn.disabled = saving;
      confirmBtn.disabled = saving || !selectedSelector;
    }

    function refreshSelection() {
      const el = currentElement();
      if (!el) return;
      panelDepth.textContent = selection.length > 1 ? t('selectionDepth', [String(selection.length)]) : '';
      panelDesc.textContent = describeElement(el) || el.localName;
      panelDesc.title = panelDesc.textContent;
      selectedSelector = el.isConnected ? generateSelector(el) : '';
      panelSelector.textContent = selectedSelector || t('noSelector');
      panelSelector.title = selectedSelector;
      syncButtons();
      schedulePaint();
    }

    function selectElement(el) {
      if (!el || !isPageElement(el) || !el.isConnected || saving) return;
      selection = [el];
      hoverEl = null;
      if (coarsePointer) {
        hudText.textContent = t('pickerHudReselect');
      } else {
        hud.classList.add('hide');
      }
      panel.classList.add('show');
      showMessage('');
      refreshSelection();
    }

    function growRange() {
      if (!selection || saving) return;
      const parent = currentElement().parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) {
        showMessage(t('outermostRange'));
        return;
      }
      selection.push(parent);
      showMessage('');
      refreshSelection();
    }

    function shrinkRange() {
      if (!selection || saving || selection.length <= 1) return;
      selection.pop();
      showMessage('');
      refreshSelection();
    }

    function resetSelection() {
      if (!selection || saving) return;
      selection = null;
      selectedSelector = '';
      panel.classList.remove('show');
      hud.classList.remove('hide');
      hudText.textContent = coarsePointer ? t('pickerHudTap') : t('pickerHudClick');
      showMessage('');
      if (lastPoint.x >= 0) hoverEl = targetFromPoint(lastPoint.x, lastPoint.y);
      schedulePaint();
    }

    async function confirmSelection() {
      if (!selection || saving) return;
      const el = currentElement();
      if (!el || !el.isConnected) {
        showMessage(t('elementGone'));
        return;
      }
      const finalSelector = selectedSelector || generateSelector(el);
      if (!finalSelector) {
        showMessage(t('selectorFailed'));
        return;
      }
      if (selectors.includes(finalSelector)) {
        showMessage(t('alreadyBlocked'));
        return;
      }

      saving = true;
      panelMsg.classList.remove('show');
      confirmBtn.textContent = t('blocking');
      syncButtons();
      let result;
      try {
        result = await api.runtime.sendMessage({
          type: 'ADD_RULE',
          hostname,
          selector: finalSelector,
          preview: describeElement(el)
        });
      } catch {
        if (destroyed) return;
        saving = false;
        confirmBtn.textContent = t('block');
        showMessage(t('extensionUpdated'));
        refreshSelection();
        return;
      }
      if (destroyed) return;

      if (!result || !result.ok) {
        saving = false;
        confirmBtn.textContent = t('block');
        if (result && result.error === 'whitelisted') showMessage(t('siteWhitelisted'));
        else if (result && result.error === 'limit') showMessage(t('ruleLimit'));
        else showMessage(t('saveFailed'));
        refreshSelection();
        return;
      }
      if (result.duplicate) {
        saving = false;
        confirmBtn.textContent = t('block');
        showMessage(t('alreadyBlocked'));
        refreshSelection();
        return;
      }

      selectors = selectors.concat(finalSelector);
      writeCache(selectors);
      renderStyle(selectors);
      const ruleId = result.rule && result.rule.id;
      stopPicker();
      notify(t('blockSuccess'), ruleId);
    }

    function onMouseMove(event) {
      lastPoint.x = event.clientX;
      lastPoint.y = event.clientY;
      if (selection) return;
      hoverEl = targetFromEvent(event);
      schedulePaint();
    }

    function onMouseLeave() {
      if (selection) return;
      hoverEl = null;
      schedulePaint();
    }

    function onMouseOut(event) {
      if (!event.relatedTarget) onMouseLeave();
    }

    function onClick(event) {
      if (isOwnEvent(event)) return;
      const el = targetFromEvent(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (el) selectElement(el);
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
        stopPicker();
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
      if (selection) {
        schedulePaint();
        return;
      }
      if (lastPoint.x >= 0) hoverEl = targetFromPoint(lastPoint.x, lastPoint.y);
      schedulePaint();
    }

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

    const guardTypes = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick',
      'contextmenu', 'dragstart', 'selectstart', 'auxclick', 'touchstart', 'touchend'];
    guardTypes.forEach((type) => window.addEventListener(type, onGuard, true));
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseout', onMouseOut, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange, true);
    hud.classList.remove('hide');

    return {
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
        cursorStyle.remove();
        root.remove();
      }
    };
  }

  const MAX_SELECTOR_LENGTH = 512;
  const MAX_DEPTH = 16;
  const ATTRIBUTE_CANDIDATES = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label'];

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function looksHashedClass(name) {
    if (name.length > 40) return true;
    const parts = name.split(/[-_]+/).filter(Boolean);
    const tail = parts[parts.length - 1] || '';
    if (tail.length >= 4 && /^[a-z0-9]+$/i.test(tail) && /\d/.test(tail) && /[a-z]/i.test(tail)) return true;
    return false;
  }

  function stableClasses(el) {
    return Array.from(el.classList)
      .filter((name) => !!name && !/^\d/.test(name) && !looksHashedClass(name))
      .slice(0, 3);
  }

  function selectorForId(el) {
    if (!el.id) return null;
    const selector = '#' + CSS.escape(el.id);
    return isUnique(selector) ? selector : null;
  }

  function escapeAttrValue(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function selectorForAttributes(el) {
    const tag = el.localName;
    for (const name of ATTRIBUTE_CANDIDATES) {
      const value = el.getAttribute(name);
      if (!value || value.length > 120) continue;
      const selector = `${tag}[${name}="${escapeAttrValue(value)}"]`;
      if (isUnique(selector)) return selector;
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
      if (isUnique(selector)) return selector;
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
      }
      parts.unshift(structuralSegment(node));
      node = node.parentElement;
    }

    if (!anchored || !parts.length) return null;
    const selector = parts.join(' > ');
    if (selector.length > MAX_SELECTOR_LENGTH) return null;
    return isUnique(selector) ? selector : null;
  }
})();
