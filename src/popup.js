(function () {
  'use strict';

  const {
    api,
    t,
    readStore,
    rulesForHost,
    isWhitelisted,
    matchingWhitelist,
    buildRuleText,
    createUndoBar
  } = IUXX;

  const els = {
    unsupported: document.getElementById('unsupported'),
    unsupportedText: document.getElementById('unsupported-text'),
    content: document.getElementById('content'),
    hostname: document.getElementById('hostname'),
    state: document.getElementById('site-state'),
    toggle: document.getElementById('site-toggle'),
    pick: document.getElementById('pick'),
    zap: document.getElementById('zap'),
    hint: document.getElementById('hint'),
    list: document.getElementById('rule-list'),
    empty: document.getElementById('empty'),
    count: document.getElementById('rule-count'),
    limitWarning: document.getElementById('limit-warning'),
    accessNotice: document.getElementById('access-notice'),
    accessTitle: document.getElementById('access-title'),
    accessText: document.getElementById('access-text'),
    accessAction: document.getElementById('access-action'),
    options: document.getElementById('open-options'),
    optionsLink: document.getElementById('options-link'),
    undoBar: document.getElementById('undo-bar'),
    undoText: document.getElementById('undo-text'),
    undoBtn: document.getElementById('undo-btn')
  };

  let tab = null;
  let hostname = '';
  let ready = false;
  let state = {
    rules: [],
    whitelisted: false,
    whitelistEntry: '',
    anchorRules: 0,
    totalRules: 0
  };
  let hintTimer = 0;
  let accessToken = 0;
  let renderTimer = 0;
  let pendingReload = false;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const undo = createUndoBar({
    bar: els.undoBar,
    text: els.undoText,
    button: els.undoBtn
  });
  const ACCESS_ORIGINS = ['*://*/*'];
  const access = {
    checked: false,
    scriptReady: false,
    mode: '',
    busy: false
  };

  IUXX.applyI18n();
  els.zap.title = t('zapButtonTitle');
  els.zap.setAttribute('aria-label', t('zapButtonTitle'));
  els.undoBtn.textContent = t('undo');

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
    els.pick.addEventListener('click', () => onStartPicker('block'));
    els.zap.addEventListener('click', () => onStartPicker('zap'));
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
    if (!(IUXX.RULES_KEY in changes) &&
        !(IUXX.LEGACY_RULES_KEY in changes) &&
        !(IUXX.WHITELIST_KEY in changes)) {
      return;
    }
    scheduleRender(true);
  }

  function scheduleRender(reload) {
    if (reload) pendingReload = true;
    if (renderTimer) return;
    renderTimer = setTimeout(async () => {
      renderTimer = 0;
      if (pendingReload) {
        pendingReload = false;
        await loadState();
      }
      render();
    }, 60);
  }

  async function loadState() {
    try {
      const store = await readStore();
      const related = rulesForHost(store.rules, hostname);
      state = {
        rules: related,
        whitelisted: isWhitelisted(hostname, store.whitelist),
        whitelistEntry: matchingWhitelist(hostname, store.whitelist),
        anchorRules: store.rules.filter((rule) => rule.scope !== 'global' && rule.host === hostname).length,
        totalRules: store.rules.length
      };
    } catch {
      state = {
        rules: [],
        whitelisted: false,
        whitelistEntry: '',
        anchorRules: 0,
        totalRules: 0
      };
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
    els.zap.disabled = !access.scriptReady;

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

    renderLimitWarning();
    els.list.textContent = '';
    for (const rule of rules) {
      els.list.appendChild(buildRuleRow(rule));
    }
    renderAccessNotice();
  }

  function renderLimitWarning() {
    const perAnchorLimit = IUXX.MAX_RULES_PER_ANCHOR;
    const totalLimit = IUXX.MAX_RULES_TOTAL;
    let message = '';
    if (state.anchorRules >= Math.floor(perAnchorLimit * 0.8)) {
      message = t('ruleLimitWarning', [String(state.anchorRules), String(perAnchorLimit)]);
    } else if (state.totalRules >= Math.floor(totalLimit * 0.8)) {
      message = t('ruleLimitTotalWarning', [String(state.totalRules), String(totalLimit)]);
    }
    els.limitWarning.textContent = message;
    els.limitWarning.classList.toggle('hidden', !message);
  }

  function buildRuleRow(rule) {
    const item = document.createElement('li');
    item.className = 'rule' + (rule.enabled === false ? ' off' : '');

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'rule-toggle';
    toggleLabel.title = t('ruleEnabledTitle');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled !== false;
    toggle.setAttribute('aria-label', t('ruleEnabledTitle'));
    toggle.addEventListener('change', () => onRuleToggle(rule, toggle));
    toggleLabel.appendChild(toggle);

    const text = buildRuleText(rule);

    const actions = document.createElement('div');
    actions.className = 'rule-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rule-del';
    del.textContent = t('delete');
    del.setAttribute('aria-label', t('deleteRuleAria'));
    del.addEventListener('click', () => onDeleteRule(rule, del));
    actions.appendChild(del);

    item.append(toggleLabel, text, actions);
    return item;
  }

  async function onRuleToggle(rule, checkbox) {
    if (!rule.id) return;
    checkbox.disabled = true;
    try {
      const result = await api.runtime.sendMessage({
        type: 'SET_RULE_ENABLED',
        id: rule.id,
        enabled: checkbox.checked
      });
      if (!result || !result.ok) throw new Error('failed');
      rule.enabled = checkbox.checked;
      scheduleRender(false);
    } catch {
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      flash(t('ruleToggleFailed'));
    }
  }

  async function onDeleteRule(rule, button) {
    if (!rule.id) return;
    button.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'REMOVE_RULE', id: rule.id });
      if (!result || !result.ok) throw new Error('failed');
      const removed = result.removed || rule;
      state.rules = state.rules.filter((item) => item.id !== rule.id);
      if (rule.scope !== 'global') {
        state.anchorRules = Math.max(0, state.anchorRules - 1);
      }
      state.totalRules = Math.max(0, state.totalRules - 1);
      scheduleRender(false);
      undo.show(t('ruleDeleted'), async () => {
        let restored = null;
        try {
          restored = await api.runtime.sendMessage({ type: 'RESTORE_RULE', rule: removed });
        } catch {
          return false;
        }
        if (!restored || !restored.ok) return false;
        scheduleRender(true);
        return true;
      });
    } catch {
      button.disabled = false;
      flash(t('deleteFailed'));
    }
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
        removeAll: enableSite
      });
      if (!result || !result.ok) throw new Error('failed');
      const whitelist = Array.isArray(result.whitelist) ? result.whitelist : null;
      state.whitelisted = whitelist
        ? isWhitelisted(hostname, whitelist)
        : !enableSite;
      state.whitelistEntry = whitelist
        ? matchingWhitelist(hostname, whitelist)
        : (!enableSite ? hostname : '');
    } catch {
      els.toggle.checked = !els.toggle.checked;
      flash(t('toggleFailed'));
    } finally {
      els.toggle.disabled = false;
      scheduleRender(false);
    }
  }

  async function onStartPicker(mode) {
    if (!ready || !tab) return;
    const button = mode === 'zap' ? els.zap : els.pick;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = t('pickButtonStarting');
    try {
      const ok = await ensureContentScript();
      if (!ok) throw new Error('content script unavailable');
      await api.tabs.sendMessage(tab.id, {
        type: 'START_PICKER',
        mode,
        source: 'popup'
      });
      window.close();
    } catch {
      button.textContent = label;
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
      if (granted) {
        await refreshAccess();
        try {
          await api.tabs.sendMessage(tab.id, { type: 'RESYNC' });
        } catch {
        }
      }
    } catch {
    } finally {
      access.busy = false;
      render();
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