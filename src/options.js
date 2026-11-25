(function () {
  'use strict';

  const { api, t } = IUXX;

  const els = {
    form: document.getElementById('wl-form'),
    input: document.getElementById('wl-input'),
    addButton: document.getElementById('wl-add'),
    error: document.getElementById('wl-error'),
    whitelist: document.getElementById('wl-list'),
    whitelistEmpty: document.getElementById('wl-empty'),
    rulesRoot: document.getElementById('rules-root'),
    rulesEmpty: document.getElementById('rules-empty'),
    rulesCount: document.getElementById('rules-count')
  };

  let store = { rules: {}, whitelist: [] };
  let errorTimer = 0;
  const collapsedDomains = new Set();

  const MULTI_LABEL_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
    'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
    'com.tw', 'org.tw', 'net.tw', 'idv.tw',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'co.nz', 'net.nz', 'org.nz',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
    'co.kr', 'or.kr', 'ne.kr',
    'com.sg', 'com.my', 'com.ph', 'com.vn', 'co.th', 'co.id', 'co.in',
    'co.il', 'co.za', 'co.ke', 'co.ae', 'co.sa',
    'com.br', 'org.br', 'com.ar', 'com.mx', 'com.tr', 'com.ru', 'com.ua',
    'com.pl', 'com.pe', 'com.co', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo',
    'com.eg', 'com.ng', 'com.pk', 'com.bd'
  ]);

  function domainOf(host) {
    const value = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!value) return '';
    if (value.startsWith('[') || !value.includes('.')) return value;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value;
    const parts = value.split('.');
    if (parts.length <= 2) return value;
    const suffix = parts.slice(-2).join('.');
    const take = MULTI_LABEL_SUFFIXES.has(suffix) ? 3 : 2;
    return parts.slice(-take).join('.');
  }

  function ruleCount(count) {
    return t(count === 1 ? 'ruleCountOne' : 'ruleCountMany', [String(count)]);
  }

  IUXX.applyI18n();

  init();

  async function init() {
    els.form.addEventListener('submit', onAddWhitelist);
    els.whitelist.addEventListener('click', onWhitelistClick);
    els.rulesRoot.addEventListener('click', onRuleClick);
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!(IUXX.RULES_KEY in changes) && !(IUXX.WHITELIST_KEY in changes)) return;
      load().then(render);
    });
    await load();
    render();
  }

  async function load() {
    try {
      store = await IUXX.readStore();
    } catch {
      store = { rules: {}, whitelist: [] };
    }
  }

  function showError(message) {
    clearTimeout(errorTimer);
    els.error.textContent = message;
    els.error.classList.remove('hidden');
    errorTimer = setTimeout(() => els.error.classList.add('hidden'), 3600);
  }

  async function onAddWhitelist(event) {
    event.preventDefault();
    const domain = IUXX.normalizeDomain(els.input.value);
    if (!domain) {
      showError(t('invalidDomain'));
      return;
    }
    els.error.classList.add('hidden');
    els.addButton.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'SET_WHITELIST', domain, enabled: true });
      if (!result || !result.ok) throw new Error('failed');
      const saved = result.domain || domain;
      if (!store.whitelist.includes(saved)) {
        store.whitelist = store.whitelist.concat(saved).sort();
      }
      els.input.value = '';
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
      store.whitelist = store.whitelist.filter((item) => item !== domain);
      render();
    } catch {
      button.disabled = false;
      showError(t('removeFailed'));
    }
  }

  async function onRuleClick(event) {
    const button = event.target && event.target.closest
      ? event.target.closest('button[data-host][data-rule-id]')
      : null;
    if (!button) return;
    const host = button.dataset.host;
    const id = button.dataset.ruleId;
    button.disabled = true;
    try {
      const result = await api.runtime.sendMessage({ type: 'REMOVE_RULE', hostname: host, id });
      if (!result || !result.ok) throw new Error('failed');
      const list = (store.rules[host] || []).filter((rule) => rule.id !== id);
      if (list.length) store.rules[host] = list;
      else delete store.rules[host];
      render();
    } catch {
      button.disabled = false;
      showError(t('deleteFailed'));
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

  function renderRules() {
    const entries = [];
    let total = 0;
    for (const host of Object.keys(store.rules)) {
      const rules = (store.rules[host] || [])
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (!rules.length) continue;
      entries.push({ host, rules });
      total += rules.length;
    }

    els.rulesCount.textContent = String(total);
    els.rulesEmpty.classList.toggle('hidden', total > 0);
    els.rulesRoot.textContent = '';

    const groups = new Map();
    for (const entry of entries) {
      const domain = domainOf(entry.host);
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain).push(entry);
    }

    const domains = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
    for (const domain of domains) {
      const hosts = groups.get(domain).slice().sort((a, b) => a.host.localeCompare(b.host));
      const domainCount = hosts.reduce((sum, entry) => sum + entry.rules.length, 0);

      const group = document.createElement('details');
      group.className = 'domain-group';
      group.open = !collapsedDomains.has(domain);
      group.addEventListener('toggle', () => {
        if (group.open) collapsedDomains.delete(domain);
        else collapsedDomains.add(domain);
      });

      const head = document.createElement('summary');
      head.className = 'domain-head';
      const name = document.createElement('span');
      name.className = 'domain-name';
      name.textContent = domain;
      name.title = domain;
      const count = document.createElement('span');
      count.className = 'domain-count';
      count.textContent = ruleCount(domainCount);
      head.append(name, count);

      const body = document.createElement('div');
      body.className = 'domain-body';
      for (const entry of hosts) {
        if (!(hosts.length === 1 && entry.host === domain)) {
          const hostRow = document.createElement('div');
          hostRow.className = 'host-row';
          const hostName = document.createElement('span');
          hostName.className = 'host-name';
          hostName.textContent = entry.host;
          hostName.title = entry.host;
          const hostCount = document.createElement('span');
          hostCount.className = 'host-count';
          hostCount.textContent = ruleCount(entry.rules.length);
          hostRow.append(hostName, hostCount);
          body.appendChild(hostRow);
        }
        const list = document.createElement('ul');
        list.className = 'rule-list';
        for (const rule of entry.rules) list.appendChild(buildRuleRow(rule, entry.host));
        body.appendChild(list);
      }

      group.append(head, body);
      els.rulesRoot.appendChild(group);
    }
  }

  function buildRuleRow(rule, host) {
    const row = document.createElement('li');
    row.className = 'rule-row';

    const text = document.createElement('div');
    text.className = 'rule-text';
    const preview = document.createElement('div');
    preview.className = 'rule-preview';
    preview.textContent = rule.preview || t('blockedElement');
    const selector = document.createElement('div');
    selector.className = 'rule-selector';
    selector.textContent = rule.selector;
    selector.title = rule.selector;
    text.append(preview, selector);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rule-del';
    button.textContent = t('delete');
    button.setAttribute('aria-label', t('deleteRuleAria'));
    if (rule.id) {
      button.dataset.host = host;
      button.dataset.ruleId = rule.id;
    } else {
      button.disabled = true;
    }

    row.append(text, button);
    return row;
  }
})();
