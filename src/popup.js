(function () {
  'use strict';

  const { api, t } = IUXX;

  const els = {
    unsupported: document.getElementById('unsupported'),
    unsupportedText: document.getElementById('unsupported-text'),
    content: document.getElementById('content'),
    hostname: document.getElementById('hostname'),
    state: document.getElementById('site-state'),
    toggle: document.getElementById('site-toggle'),
    pick: document.getElementById('pick'),
    hint: document.getElementById('hint'),
    list: document.getElementById('rule-list'),
    empty: document.getElementById('empty'),
    count: document.getElementById('rule-count'),
    accessNotice: document.getElementById('access-notice'),
    accessTitle: document.getElementById('access-title'),
    accessText: document.getElementById('access-text'),
    accessAction: document.getElementById('access-action'),
    options: document.getElementById('open-options'),
    optionsLink: document.getElementById('options-link')
  };

  let tab = null;
  let hostname = '';
  let ready = false;
  let state = { rules: [], whitelisted: false, whitelistEntry: '' };
  let hintTimer = 0;
  let accessToken = 0;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const ACCESS_ORIGINS = ['*://*/*'];
  const access = {
    checked: false,
    scriptReady: false,
    mode: '',
    busy: false
  };

  IUXX.applyI18n();

  init();

  async function init() {
    bindEvents();
    api.storage.onChanged.addListener(onStorageChanged);
    api.permissions.onAdded.addListener(() => {
      refreshAccess();
    });
    api.permissions.onRemoved.addListener(() => {
      refreshAccess();
    });

    let tabs = [];
    try {
      tabs = await api.tabs.query({ active: true, currentWindow: true });
    } catch {
    }
    tab = tabs && tabs[0];
    const url = (tab && tab.url) || '';

    if (!tab || typeof tab.id !== 'number' || isRestrictedUrl(url)) {
      showUnsupported();
      return;
    }
    hostname = IUXX.hostOfUrl(url);
    if (!hostname) {
      showUnsupported();
      return;
    }

    ready = true;
    els.content.classList.remove('hidden');
    els.hostname.textContent = hostname;
    await loadState();
    render();
    await refreshAccess();
  }

  function bindEvents() {
    els.toggle.addEventListener('change', onToggle);
    els.pick.addEventListener('click', onPick);
    els.list.addEventListener('click', onRuleClick);
    els.accessAction.addEventListener('click', onAccessAction);
    els.options.addEventListener('click', openOptions);
    els.optionsLink.addEventListener('click', openOptions);
  }

  function openOptions() {
    try {
      Promise.resolve(api.runtime.openOptionsPage()).finally(() => window.close());
    } catch {
      window.close();
    }
  }

  function isRestrictedUrl(url) {
    try {
      return new URL(url).hostname === 'addons.mozilla.org';
    } catch {
      return true;
    }
  }

  function showUnsupported() {
    els.content.classList.add('hidden');
    els.unsupportedText.textContent = t('unsupportedText');
    els.unsupported.classList.remove('hidden');
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local' || !ready) return;
    if (!(IUXX.RULES_KEY in changes) && !(IUXX.WHITELIST_KEY in changes)) return;
    loadState().then(render);
  }

  async function loadState() {
    try {
      const store = await IUXX.readStore();
      state = IUXX.stateForHost(store, hostname);
    } catch {
      state = { rules: [], whitelisted: false, whitelistEntry: '' };
    }
  }

  function render() {
    if (!ready) return;
    const rules = state.rules
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    els.toggle.checked = !state.whitelisted;
    els.count.textContent = String(rules.length);
    els.empty.classList.toggle('hidden', rules.length > 0);
    els.pick.disabled = state.whitelisted || !access.scriptReady;

    if (state.whitelisted) {
      els.state.textContent = state.whitelistEntry
        ? t('siteStateWhitelistedEntry', [state.whitelistEntry])
        : t('siteStateWhitelisted');
      els.state.classList.add('off');
    } else {
      if (!rules.length) els.state.textContent = t('siteStateEnabledNone');
      else if (rules.length === 1) els.state.textContent = t('siteStateEnabledOne');
      else els.state.textContent = t('siteStateEnabledMany', [String(rules.length)]);
      els.state.classList.remove('off');
    }

    if (!hintTimer) {
      els.hint.classList.remove('error');
      els.hint.textContent = state.whitelisted
        ? t('pickerHintWhitelisted')
        : (coarsePointer
          ? t('pickerHint')
          : `${t('pickerHint')} · ${t('pickerHintShortcut')}`);
    }

    els.list.textContent = '';
    for (const rule of rules) {
      const item = document.createElement('li');
      item.className = 'rule';

      const text = document.createElement('div');
      text.className = 'rule-text';

      const preview = document.createElement('div');
      preview.className = 'rule-preview';
      preview.textContent = rule.preview || t('blockedElement');
      preview.title = rule.preview || '';

      const selector = document.createElement('div');
      selector.className = 'rule-selector';
      selector.textContent = rule.selector;
      selector.title = rule.selector;

      text.append(preview, selector);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rule-del';
      del.textContent = t('delete');
      del.setAttribute('aria-label', t('deleteRuleAria'));
      if (rule.id) {
        del.dataset.ruleId = rule.id;
      } else {
        del.disabled = true;
      }

      item.append(text, del);
      els.list.appendChild(item);
    }
    renderAccessNotice();
  }

  async function onToggle() {
    if (!ready) return;
    const enableSite = els.toggle.checked;
    els.toggle.disabled = true;
    try {
      const result = await api.runtime.sendMessage({
        type: 'SET_WHITELIST',
        domain: hostname,
        enabled: !enableSite,
        removeAll: !enableSite
      });
      if (!result || !result.ok) throw new Error('failed');
      state.whitelisted = !enableSite;
      state.whitelistEntry = !enableSite ? hostname : '';
    } catch {
      els.toggle.checked = !els.toggle.checked;
      flash(t('toggleFailed'));
    } finally {
      els.toggle.disabled = false;
      render();
    }
  }

  async function onPick() {
    if (!ready || !tab) return;
    const label = els.pick.textContent;
    els.pick.disabled = true;
    els.pick.textContent = t('pickButtonStarting');
    try {
      const ok = await ensureContentScript();
      if (!ok) throw new Error('content script unavailable');
      await api.tabs.sendMessage(tab.id, { type: 'START_PICKER' });
      window.close();
    } catch {
      els.pick.textContent = label;
      await refreshAccess();
      if (access.mode === 'permission') {
        flash(t('permissionMissing'));
      } else if (access.mode === 'inject') {
        flash(t('contentScriptMissing'));
      } else {
        flash(t('pickerStartFailed'));
      }
    }
  }

  async function checkHostAccess() {
    try {
      return await api.permissions.contains({ origins: ACCESS_ORIGINS });
    } catch {
      return true;
    }
  }

  async function pingContentScript() {
    if (!tab) return false;
    try {
      const pong = await api.tabs.sendMessage(tab.id, { type: 'PING' });
      return !!(pong && pong.ok);
    } catch {
      return false;
    }
  }

  async function injectContentScript() {
    if (!tab) return false;
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: ['shared.js', 'content.js']
      });
      return true;
    } catch {
      return false;
    }
  }

  async function ensureContentScript() {
    if (await pingContentScript()) return true;
    if (!(await injectContentScript())) return false;
    return pingContentScript();
  }

  async function refreshAccess() {
    if (!ready || !tab) return;
    const token = ++accessToken;
    const hostAccess = await checkHostAccess();
    let scriptReady = await pingContentScript();
    if (!scriptReady) {
      await injectContentScript();
      scriptReady = await pingContentScript();
    }
    if (token !== accessToken) return;
    access.checked = true;
    access.scriptReady = scriptReady;
    access.mode = !hostAccess ? 'permission' : (!scriptReady ? 'inject' : '');
    render();
  }

  function renderAccessNotice() {
    if (!access.checked || !access.mode) {
      els.accessNotice.classList.add('hidden');
      return;
    }
    els.accessNotice.classList.remove('hidden');

    if (access.mode === 'inject') {
      els.accessTitle.textContent = t('accessInjectTitle');
      els.accessText.textContent = t('accessInjectText');
      els.accessAction.textContent = t('refreshPage');
      els.accessAction.disabled = false;
      return;
    }

    els.accessTitle.textContent = access.scriptReady ? t('accessPartialTitle') : t('accessMissingTitle');
    els.accessText.textContent = access.scriptReady ? t('accessPartialText') : t('accessMissingText');
    els.accessAction.textContent = access.busy ? t('requesting') : t('allowSiteAccess');
    els.accessAction.disabled = access.busy;
  }

  async function onAccessAction() {
    if (!access.checked || !tab || access.busy) return;

    if (access.mode === 'inject') {
      try {
        await api.tabs.reload(tab.id);
        window.close();
      } catch {
        flash(t('reloadFailed'));
      }
      return;
    }

    if (access.mode !== 'permission') return;

    access.busy = true;
    renderAccessNotice();
    try {
      const granted = await api.permissions.request({ origins: ACCESS_ORIGINS });
      if (granted) await refreshAccess();
    } catch {
    } finally {
      access.busy = false;
      render();
    }
  }

  async function onRuleClick(event) {
    const button = event.target && event.target.closest
      ? event.target.closest('button[data-rule-id]')
      : null;
    if (!button || !button.dataset.ruleId) return;
    const id = button.dataset.ruleId;
    button.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'REMOVE_RULE', hostname, id });
      if (!result || !result.ok) throw new Error('failed');
      state.rules = state.rules.filter((rule) => rule.id !== id);
      render();
    } catch {
      button.disabled = false;
      flash(t('deleteFailed'));
    }
  }

  function flash(text) {
    clearTimeout(hintTimer);
    els.hint.textContent = text;
    els.hint.classList.add('error');
    hintTimer = setTimeout(() => {
      hintTimer = 0;
      render();
    }, 3600);
  }
})();
