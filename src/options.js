(function () {
  'use strict';

  const {
    api,
    t,
    readStore,
    readSettings,
    normalizeDomain,
    normalizePath,
    normalizeBackup,
    selectorIsStorable,
    selectorTargetsRoot,
    SETTINGS_KEY
  } = IUXX;

  const els = {
    form: document.getElementById('wl-form'),
    input: document.getElementById('wl-input'),
    addButton: document.getElementById('wl-add'),
    error: document.getElementById('wl-error'),
    whitelist: document.getElementById('wl-list'),
    whitelistEmpty: document.getElementById('wl-empty'),
    rulesRoot: document.getElementById('rules-root'),
    rulesEmpty: document.getElementById('rules-empty'),
    rulesCount: document.getElementById('rules-count'),
    limitWarning: document.getElementById('limit-warning'),
    rulesStatus: document.getElementById('rules-status'),
    search: document.getElementById('rule-search'),
    searchCount: document.getElementById('search-count'),
    keepOpen: document.getElementById('keep-open'),
    behaviorStatus: document.getElementById('behavior-status'),
    ruleCard: document.getElementById('rule-card'),
    ruleForm: document.getElementById('rule-form'),
    ruleFormTitle: document.getElementById('rule-form-title'),
    ruleHost: document.getElementById('rule-host'),
    ruleScope: document.getElementById('rule-scope'),
    ruleSelector: document.getElementById('rule-selector'),
    rulePath: document.getElementById('rule-path'),
    rulePreview: document.getElementById('rule-preview'),
    ruleSubmit: document.getElementById('rule-submit'),
    ruleCancel: document.getElementById('rule-cancel'),
    ruleError: document.getElementById('rule-error'),
    exportBtn: document.getElementById('export-btn'),
    importBtn: document.getElementById('import-btn'),
    importMode: document.getElementById('import-mode'),
    importFile: document.getElementById('import-file'),
    backupStatus: document.getElementById('backup-status'),
    undoBar: document.getElementById('undo-bar'),
    undoText: document.getElementById('undo-text'),
    undoBtn: document.getElementById('undo-btn')
  };

  let store = { rules: [], whitelist: [] };
  let settings = { keepPickerOpen: false };
  let editingId = null;
  let lastDeleted = null;
  let search = '';
  let undoTimer = 0;
  let errorTimer = 0;
  let importBusy = false;
  const collapsedHosts = new Set();
  const statusTimers = new WeakMap();

  IUXX.applyI18n();
  els.undoBtn.textContent = t('undo');

  init();

  async function init() {
    bindEvents();
    api.storage.onChanged.addListener(onStorageChanged);
    await Promise.all([load(), loadSettings()]);
    render();
    updateFormForScope();
  }

  function bindEvents() {
    els.form.addEventListener('submit', onAddWhitelist);
    els.whitelist.addEventListener('click', onWhitelistClick);
    els.rulesRoot.addEventListener('click', onRuleClick);
    els.keepOpen.addEventListener('change', onKeepOpenChange);
    els.ruleForm.addEventListener('submit', onRuleSubmit);
    els.ruleCancel.addEventListener('click', resetRuleForm);
    els.ruleScope.addEventListener('change', updateFormForScope);
    els.search.addEventListener('input', () => {
      search = els.search.value.trim().toLowerCase();
      renderRules();
    });
    els.exportBtn.addEventListener('click', onExport);
    els.importBtn.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', onImportFile);
    els.undoBtn.addEventListener('click', onUndoDelete);
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (SETTINGS_KEY in changes) {
      loadSettings().then(() => {
        els.keepOpen.checked = settings.keepPickerOpen;
      }).catch(() => {});
    }
    if (!(IUXX.RULES_KEY in changes) &&
        !(IUXX.LEGACY_RULES_KEY in changes) &&
        !(IUXX.WHITELIST_KEY in changes)) {
      return;
    }
    load().then(render);
  }

  async function load() {
    try {
      store = await readStore();
    } catch {
      store = { rules: [], whitelist: [] };
    }
  }

  async function loadSettings() {
    try {
      settings = await readSettings();
      els.keepOpen.checked = settings.keepPickerOpen;
    } catch {
      settings = { keepPickerOpen: false };
    }
  }

  function ruleCount(count) {
    return t(count === 1 ? 'ruleCountOne' : 'ruleCountMany', [String(count)]);
  }

  function setStatus(el, text, isError) {
    const prev = statusTimers.get(el);
    if (prev) clearTimeout(prev);
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
    if (text) {
      statusTimers.set(el, setTimeout(() => {
        el.textContent = '';
        el.classList.remove('error');
      }, 5200));
    }
  }

  function showError(message) {
    clearTimeout(errorTimer);
    els.error.textContent = message;
    els.error.classList.remove('hidden');
    errorTimer = setTimeout(() => els.error.classList.add('hidden'), 4200);
  }

  function showRuleError(message) {
    els.ruleError.textContent = message || '';
    els.ruleError.classList.toggle('hidden', !message);
  }

  async function onAddWhitelist(event) {
    event.preventDefault();
    const domain = normalizeDomain(els.input.value);
    if (!domain) {
      showError(t('invalidDomain'));
      return;
    }
    els.error.classList.add('hidden');
    els.addButton.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'SET_WHITELIST', domain, enabled: true });
      if (!result || !result.ok) throw new Error('failed');
      els.input.value = '';
      await load();
      render();
    } catch {
      showError(t('saveFailed'));
    } finally {
      els.addButton.disabled = false;
    }
  }

  async function onWhitelistClick(event) {
    const button = event.target && event.target.closest
      ? event.target.closest('button[data-domain]')
      : null;
    if (!button) return;
    const domain = button.dataset.domain;
    button.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'SET_WHITELIST', domain, enabled: false });
      if (!result || !result.ok) throw new Error('failed');
      await load();
      render();
    } catch {
      button.disabled = false;
      showError(t('removeFailed'));
    }
  }

  function render() {
    renderWhitelist();
    renderRules();
  }

  function renderWhitelist() {
    const domains = store.whitelist.slice().sort();
    els.whitelistEmpty.classList.toggle('hidden', domains.length > 0);
    els.whitelist.textContent = '';
    for (const domain of domains) {
      const item = document.createElement('li');
      item.className = 'wl-item';

      const name = document.createElement('span');
      name.className = 'wl-domain';
      name.textContent = domain;
      name.title = domain;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wl-remove';
      button.textContent = t('remove');
      button.dataset.domain = domain;
      button.setAttribute('aria-label', t('removeFromWhitelistAria', [domain]));

      item.append(name, button);
      els.whitelist.appendChild(item);
    }
  }

  function matchesSearch(rule) {
    if (!search) return true;
    return [
      rule.host,
      rule.selector,
      rule.preview,
      rule.path,
      rule.scope
    ].some((value) => String(value || '').toLowerCase().includes(search));
  }

  function groupLabel(host) {
    return host === '*' ? t('allSites') : host;
  }

  function renderRules() {
    const total = store.rules.length;
    els.rulesCount.textContent = String(total);

    const filtered = store.rules.filter(matchesSearch);
    const groups = new Map();
    for (const rule of filtered) {
      if (!groups.has(rule.host)) groups.set(rule.host, []);
      groups.get(rule.host).push(rule);
    }

    const ordered = Array.from(groups.entries()).map(([host, rules]) => ({
      host,
      rules: rules.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    }));
    ordered.sort((a, b) => {
      if (a.host === '*') return 1;
      if (b.host === '*') return -1;
      return a.host.localeCompare(b.host);
    });

    if (search) {
      els.searchCount.textContent = t('searchCount', [String(filtered.length), String(total)]);
    } else {
      els.searchCount.textContent = '';
    }

    if (!total) {
      els.rulesEmpty.textContent = t('rulesEmpty');
      els.rulesEmpty.classList.remove('hidden');
    } else if (!filtered.length) {
      els.rulesEmpty.textContent = t('rulesNoMatch');
      els.rulesEmpty.classList.remove('hidden');
    } else {
      els.rulesEmpty.classList.add('hidden');
    }

    els.rulesRoot.textContent = '';
    for (const group of ordered) {
      if (!group.rules.length) continue;
      const details = document.createElement('details');
      details.className = 'domain-group';
      details.open = search ? true : !collapsedHosts.has(group.host);
      details.addEventListener('toggle', () => {
        if (details.open) collapsedHosts.delete(group.host);
        else collapsedHosts.add(group.host);
      });

      const head = document.createElement('summary');
      head.className = 'domain-head';
      const name = document.createElement('span');
      name.className = 'domain-name';
      name.textContent = groupLabel(group.host);
      name.title = groupLabel(group.host);
      const count = document.createElement('span');
      count.className = 'domain-count';
      count.textContent = ruleCount(group.rules.length);
      head.append(name, count);

      if (!search && group.rules.length >= Math.floor(IUXX.MAX_RULES_PER_ANCHOR * 0.8)) {
        const warn = document.createElement('span');
        warn.className = 'group-warn';
        warn.textContent = t('groupLimit', [
          String(group.rules.length),
          String(IUXX.MAX_RULES_PER_ANCHOR)
        ]);
        head.appendChild(warn);
      }

      const body = document.createElement('div');
      body.className = 'domain-body';
      const list = document.createElement('ul');
      list.className = 'rule-list';
      for (const rule of group.rules) list.appendChild(buildRuleRow(rule));
      body.appendChild(list);

      details.append(head, body);
      els.rulesRoot.appendChild(details);
    }

    renderLimitWarning();
  }

  function renderLimitWarning() {
    const total = store.rules.length;
    const limit = IUXX.MAX_RULES_TOTAL;
    let message = '';
    if (total >= Math.floor(limit * 0.8)) {
      message = t('ruleLimitTotalWarning', [String(total), String(limit)]);
    }
    els.limitWarning.textContent = message;
    els.limitWarning.classList.toggle('hidden', !message);
  }

  function scopeLabel(rule) {
    if (rule.scope === 'global') return t('scopeGlobal');
    if (rule.scope === 'domain') return t('scopeDomain');
    return t('scopeHost');
  }

  function buildRuleRow(rule) {
    const row = document.createElement('li');
    row.className = 'rule-row' + (rule.enabled === false ? ' off' : '');

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'rule-toggle';
    toggleLabel.title = t('ruleEnabledTitle');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled !== false;
    toggle.setAttribute('aria-label', t('ruleEnabledTitle'));
    toggle.addEventListener('change', () => onRuleToggle(rule, toggle));
    toggleLabel.appendChild(toggle);

    const text = document.createElement('div');
    text.className = 'rule-text';
    const preview = document.createElement('div');
    preview.className = 'rule-preview';
    preview.textContent = rule.preview || t('blockedElement');
    const selector = document.createElement('div');
    selector.className = 'rule-selector';
    selector.textContent = rule.selector;
    selector.title = rule.selector;

    const meta = document.createElement('div');
    meta.className = 'rule-meta';
    const scope = document.createElement('span');
    scope.className = 'rule-badge';
    scope.textContent = scopeLabel(rule);
    meta.appendChild(scope);
    if (rule.path) {
      const path = document.createElement('span');
      path.className = 'rule-badge path';
      path.textContent = rule.path;
      path.title = t('pathBadgeTitle');
      meta.appendChild(path);
    }
    if (rule.enabled === false) {
      const disabled = document.createElement('span');
      disabled.className = 'rule-badge disabled';
      disabled.textContent = t('ruleDisabled');
      meta.appendChild(disabled);
    }

    text.append(preview, selector, meta);

    const actions = document.createElement('div');
    actions.className = 'rule-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'rule-act';
    edit.textContent = t('edit');
    edit.dataset.action = 'edit';
    edit.dataset.ruleId = rule.id;
    edit.setAttribute('aria-label', t('editRuleAria'));

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'rule-act';
    copy.textContent = t('copySelector');
    copy.dataset.action = 'copy';
    copy.dataset.ruleId = rule.id;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rule-act danger';
    del.textContent = t('delete');
    del.dataset.action = 'delete';
    del.dataset.ruleId = rule.id;
    del.setAttribute('aria-label', t('deleteRuleAria'));

    actions.append(edit, copy, del);
    row.append(toggleLabel, text, actions);
    return row;
  }

  function findRule(id) {
    return store.rules.find((rule) => rule.id === id) || null;
  }

  function onRuleClick(event) {
    const button = event.target && event.target.closest
      ? event.target.closest('button[data-action]')
      : null;
    if (!button) return;
    const rule = findRule(button.dataset.ruleId);
    if (!rule) return;
    if (button.dataset.action === 'edit') startEdit(rule);
    else if (button.dataset.action === 'copy') onCopySelector(rule, button);
    else if (button.dataset.action === 'delete') onDeleteRule(rule, button);
  }

  async function onRuleToggle(rule, checkbox) {
    checkbox.disabled = true;
    try {
      const result = await api.runtime.sendMessage({
        type: 'SET_RULE_ENABLED',
        id: rule.id,
        enabled: checkbox.checked
      });
      if (!result || !result.ok) throw new Error('failed');
      rule.enabled = checkbox.checked;
      renderRules();
    } catch {
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      setStatus(els.rulesStatus, t('ruleToggleFailed'), true);
    }
  }

  async function onCopySelector(rule, button) {
    button.disabled = true;
    const ok = await copyText(rule.selector);
    button.disabled = false;
    setStatus(els.rulesStatus, ok ? t('copyDone') : t('copyFailed'), !ok);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function onDeleteRule(rule, button) {
    button.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'REMOVE_RULE', id: rule.id });
      if (!result || !result.ok) throw new Error('failed');
      lastDeleted = result.removed || rule;
      store.rules = store.rules.filter((item) => item.id !== rule.id);
      if (editingId === rule.id) resetRuleForm();
      render();
      showUndo(t('ruleDeleted'));
    } catch {
      button.disabled = false;
      setStatus(els.rulesStatus, t('deleteFailed'), true);
    }
  }

  function showUndo(text) {
    clearTimeout(undoTimer);
    els.undoText.textContent = text;
    els.undoBtn.disabled = false;
    els.undoBtn.textContent = t('undo');
    els.undoBar.classList.remove('hidden');
    undoTimer = setTimeout(hideUndo, 8000);
  }

  function hideUndo() {
    clearTimeout(undoTimer);
    undoTimer = 0;
    lastDeleted = null;
    els.undoBar.classList.add('hidden');
  }

  async function onUndoDelete() {
    if (!lastDeleted) return;
    const rule = lastDeleted;
    els.undoBtn.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'RESTORE_RULE', rule });
      if (!result || !result.ok) throw new Error('failed');
      hideUndo();
      await load();
      render();
    } catch {
      els.undoBtn.disabled = false;
      els.undoText.textContent = t('undoFailed');
    }
  }

  function updateFormForScope() {
    const global = els.ruleScope.value === 'global';
    els.ruleHost.disabled = global;
    if (global) els.ruleHost.value = '';
  }

  function startEdit(rule) {
    editingId = rule.id;
    els.ruleHost.value = rule.scope === 'global' ? '' : rule.host;
    els.ruleScope.value = rule.scope;
    els.ruleSelector.value = rule.selector;
    els.rulePath.value = rule.path || '';
    els.rulePreview.value = rule.preview || '';
    els.ruleFormTitle.textContent = t('editRuleHeading');
    els.ruleSubmit.textContent = t('saveRuleButton');
    els.ruleCancel.hidden = false;
    updateFormForScope();
    showRuleError('');
    els.ruleCard.open = true;
    els.ruleCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.ruleSelector.focus();
  }

  function resetRuleForm() {
    editingId = null;
    els.ruleForm.reset();
    els.ruleScope.value = 'host';
    els.ruleHost.disabled = false;
    els.ruleFormTitle.textContent = t('addRuleHeading');
    els.ruleSubmit.textContent = t('addRuleButton');
    els.ruleCancel.hidden = true;
    showRuleError('');
    updateFormForScope();
    els.ruleCard.open = false;
  }

  function validateSelector(selector) {
    if (!selector) return t('ruleSelectorRequired');
    if (!selectorIsStorable(selector)) return t('ruleSelectorInvalid');
    if (selectorTargetsRoot(selector)) return t('ruleSelectorUnsafe');
    try {
      document.querySelector(selector);
    } catch {
      return t('ruleSelectorInvalid');
    }
    try {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (node === document.body || node === document.documentElement) {
          return t('ruleSelectorUnsafe');
        }
      }
    } catch {
      return t('ruleSelectorInvalid');
    }
    return '';
  }

  async function onRuleSubmit(event) {
    event.preventDefault();
    const scope = els.ruleScope.value;
    const host = scope === 'global' ? '*' : normalizeDomain(els.ruleHost.value);
    if (scope !== 'global' && !host) {
      showRuleError(t('invalidDomain'));
      return;
    }
    const selector = els.ruleSelector.value.trim();
    const selectorError = validateSelector(selector);
    if (selectorError) {
      showRuleError(selectorError);
      return;
    }
    const path = normalizePath(els.rulePath.value);
    const preview = els.rulePreview.value.trim();

    els.ruleSubmit.disabled = true;
    showRuleError('');
    try {
      let result;
      if (editingId) {
        const existing = findRule(editingId);
        if (!existing) throw new Error('missing');
        result = await api.runtime.sendMessage({
          type: 'UPDATE_RULE',
          id: editingId,
          rule: {
            host,
            scope,
            selector,
            path,
            preview,
            enabled: existing.enabled !== false
          }
        });
      } else {
        result = await api.runtime.sendMessage({
          type: 'ADD_RULE',
          hostname: host,
          scope,
          selector,
          path,
          preview
        });
      }

      if (!result || !result.ok) {
        if (result && result.error === 'duplicate') showRuleError(t('ruleDuplicate'));
        else if (result && result.error === 'limit') showRuleError(t('ruleLimit'));
        else if (result && result.error === 'limitTotal') showRuleError(t('ruleLimitTotal'));
        else if (result && result.error === 'whitelisted') showRuleError(t('ruleHostWhitelisted'));
        else showRuleError(t('saveFailed'));
        return;
      }
      if (result.duplicate) {
        showRuleError(t('ruleDuplicate'));
        return;
      }
      resetRuleForm();
      await load();
      render();
      setStatus(els.rulesStatus, t('ruleSaved'));
    } catch {
      showRuleError(t('saveFailed'));
    } finally {
      els.ruleSubmit.disabled = false;
    }
  }

  async function onKeepOpenChange() {
    const next = { ...settings, keepPickerOpen: els.keepOpen.checked };
    try {
      await api.storage.local.set({ [SETTINGS_KEY]: next });
      settings = next;
      setStatus(els.behaviorStatus, t('settingSaved'));
    } catch {
      els.keepOpen.checked = !els.keepOpen.checked;
      setStatus(els.behaviorStatus, t('saveFailed'), true);
    }
  }

  async function onExport() {
    els.exportBtn.disabled = true;
    try {
      const [freshStore, freshSettings] = await Promise.all([readStore(), readSettings()]);
      const payload = {
        format: IUXX.BACKUP_FORMAT,
        version: IUXX.BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        rules: freshStore.rules,
        whitelist: freshStore.whitelist,
        settings: freshSettings
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `iuxx-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(els.backupStatus, t('exportDone', [String(freshStore.rules.length)]));
    } catch {
      setStatus(els.backupStatus, t('exportFailed'), true);
    } finally {
      els.exportBtn.disabled = false;
    }
  }

  async function onImportFile() {
    if (importBusy) return;
    const file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setStatus(els.backupStatus, t('importTooLarge'), true);
      return;
    }

    let parsed;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      parsed = normalizeBackup(json);
    } catch {
      setStatus(els.backupStatus, t('importInvalid'), true);
      return;
    }
    if (!parsed.rules.length && !parsed.whitelist.length) {
      setStatus(els.backupStatus, t('importNothing'), true);
      return;
    }

    const mode = els.importMode.value === 'replace' ? 'replace' : 'merge';
    if (mode === 'replace' && !window.confirm(t('importReplaceConfirm'))) return;

    importBusy = true;
    els.exportBtn.disabled = true;
    setStatus(els.backupStatus, t('importing'));
    try {
      const result = await api.runtime.sendMessage({
        type: 'IMPORT_BACKUP',
        data: parsed,
        mode
      });
      if (!result || !result.ok) throw new Error('failed');
      await Promise.all([load(), loadSettings()]);
      resetRuleForm();
      render();
      setStatus(els.backupStatus, t('importDone', [
        String(result.added),
        String(result.skipped),
        String(result.total)
      ]));
    } catch {
      setStatus(els.backupStatus, t('importFailed'), true);
    } finally {
      importBusy = false;
      els.exportBtn.disabled = false;
    }
  }
})();