'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

let stored = {};

globalThis.browser = {
  storage: {
    local: {
      async get(defaults) {
        if (typeof defaults === 'string') {
          return { [defaults]: stored[defaults] };
        }
        const out = {};
        for (const [key, value] of Object.entries(defaults || {})) {
          out[key] = key in stored ? stored[key] : value;
        }
        return out;
      },
      async set(values) {
        Object.assign(stored, values);
      }
    }
  },
  i18n: {
    getMessage(key) {
      return key;
    }
  }
};

require('../src/shared.js');

const {
  hostOfUrl,
  normalizeDomain,
  normalizePath,
  normalizeScope,
  normalizeRule,
  normalizeRulesPayload,
  normalizeLegacyRules,
  normalizeWhitelist,
  normalizeBackup,
  selectorIsStorable,
  ruleMatchesHost,
  ruleMatchesPath,
  ruleMatchesPage,
  countAnchorRules,
  matchingWhitelist,
  isWhitelisted,
  readStore,
  readSettings,
  buildCss,
  looksHashedClass,
  looksDynamicId,
  stableClasses,
  RULES_KEY,
  WHITELIST_KEY,
  SETTINGS_KEY
} = globalThis.IUXX;

test('hostOfUrl only accepts http and https', () => {
  assert.equal(hostOfUrl('https://Example.COM/path'), 'example.com');
  assert.equal(hostOfUrl('http://example.com.'), 'example.com');
  assert.equal(hostOfUrl('ftp://example.com'), '');
  assert.equal(hostOfUrl('not a url'), '');
});

test('normalizeDomain handles URLs, wildcards, and invalid input', () => {
  assert.equal(normalizeDomain('https://Sub.Example.com/page'), 'sub.example.com');
  assert.equal(normalizeDomain('*.example.com'), 'example.com');
  assert.equal(normalizeDomain(' Example.COM. '), 'example.com');
  assert.equal(normalizeDomain('ftp://example.com'), '');
  assert.equal(normalizeDomain(''), '');
});

test('normalizePath handles URLs, wildcards, and root paths', () => {
  assert.equal(normalizePath('https://example.com/watch?q=1'), '/watch');
  assert.equal(normalizePath('watch'), '/watch');
  assert.equal(normalizePath('/'), '');
  assert.equal(normalizePath('*'), '*');
  assert.equal(normalizePath('/watch/'), '/watch/');
});

test('rule host and path matching respects scopes', () => {
  assert.equal(ruleMatchesHost({ scope: 'host', host: 'example.com' }, 'example.com'), true);
  assert.equal(ruleMatchesHost({ scope: 'host', host: 'example.com' }, 'sub.example.com'), false);
  assert.equal(ruleMatchesHost({ scope: 'domain', host: 'example.com' }, 'sub.example.com'), true);
  assert.equal(ruleMatchesHost({ scope: 'global', host: '*' }, 'anything.test'), true);

  assert.equal(ruleMatchesPath({ path: '' }, '/any'), true);
  assert.equal(ruleMatchesPath({ path: '*' }, '/any'), true);
  assert.equal(ruleMatchesPath({ path: '/watch' }, '/watch'), true);
  assert.equal(ruleMatchesPath({ path: '/watch' }, '/watch/episode'), true);
  assert.equal(ruleMatchesPath({ path: '/watch' }, '/watching'), false);
  assert.equal(ruleMatchesPath({ path: '/watch*' }, '/watching'), true);
  assert.equal(ruleMatchesPage({ scope: 'domain', host: 'example.com', path: '/watch' }, 'sub.example.com', '/watch/1'), true);
});

test('whitelist matching uses the longest covering entry', () => {
  const whitelist = ['example.com', 'b.example.com'];
  assert.equal(matchingWhitelist('a.b.example.com', whitelist), 'b.example.com');
  assert.equal(isWhitelisted('a.b.example.com', whitelist), true);
  assert.equal(isWhitelisted('other.test', whitelist), false);
  assert.deepEqual(normalizeWhitelist(['B.Example.com', 'a.com', 'a.com']), ['a.com', 'b.example.com']);
});

test('normalizeRule applies defaults and rejects unsafe selector syntax', () => {
  const rule = normalizeRule({
    host: 'Example.com',
    selector: '.ad',
    preview: ' Ad '
  });
  assert.equal(rule.host, 'example.com');
  assert.equal(rule.scope, 'host');
  assert.equal(rule.selector, '.ad');
  assert.equal(rule.preview, 'Ad');
  assert.equal(rule.enabled, true);

  const globalRule = normalizeRule({ scope: 'global', selector: '.cookie' });
  assert.equal(globalRule.host, '*');

  assert.equal(normalizeRule({ scope: 'host', selector: '.ad {' }), null);
  assert.equal(normalizeRule({ scope: 'host', host: '', selector: '.ad' }), null);
});

test('rule payload normalization deduplicates rules', () => {
  const rules = normalizeRulesPayload({
    version: 2,
    rules: [
      { id: 'one', host: 'example.com', scope: 'host', selector: '.ad', path: '', enabled: true },
      { id: 'two', host: 'example.com', scope: 'host', selector: '.ad', path: '', enabled: true },
      { id: 'three', host: 'example.com', scope: 'host', selector: '.other', path: '', enabled: true }
    ]
  });
  assert.equal(rules.length, 2);
  assert.equal(new Set(rules.map((rule) => rule.id)).size, 2);
});

test('legacy rules and backup payloads are normalized', () => {
  const legacy = normalizeLegacyRules({
    'example.com': ['.ad', { selector: '.promo', preview: 'Promo' }]
  });
  assert.equal(legacy.length, 2);
  assert.equal(legacy.every((rule) => rule.host === 'example.com'), true);

  const backup = normalizeBackup({
    format: 'iuxx-backup',
    version: 2,
    rules: [{ host: 'example.com', scope: 'host', selector: '.ad' }],
    whitelist: ['example.com'],
    settings: { keepPickerOpen: true }
  });
  assert.equal(backup.rules.length, 1);
  assert.deepEqual(backup.whitelist, ['example.com']);
  assert.equal(backup.settings.keepPickerOpen, true);
  assert.throws(() => normalizeBackup({ format: 'iuxx-backup', rules: 'nope' }));
});

test('selector safety checks basic CSS syntax', () => {
  assert.equal(selectorIsStorable('.ad'), true);
  assert.equal(selectorIsStorable('   '), false);
  assert.equal(selectorIsStorable('.ad { display:none }'), false);
  assert.equal(selectorIsStorable('a\nb'), false);
});

test('buildCss deduplicates selectors and skips unsafe input', () => {
  const css = buildCss(['.ad', '.ad', '.promo {', '.cookie']);
  assert.equal(css, '.ad { display: none !important; }\n.cookie { display: none !important; }');
});

test('anchor limits count rules per host and global separately', () => {
  const rules = [
    { scope: 'host', host: 'example.com' },
    { scope: 'domain', host: 'example.com' },
    { scope: 'host', host: 'sub.example.com' },
    { scope: 'global', host: '*' }
  ];
  assert.equal(countAnchorRules(rules, 'example.com'), 2);
  assert.equal(countAnchorRules(rules, '*'), 1);
});

test('readStore and readSettings normalize storage values', async () => {
  stored = {
    [RULES_KEY]: { version: 2, rules: [{ host: 'example.com', scope: 'host', selector: '.ad' }] },
    [WHITELIST_KEY]: ['Example.com'],
    [SETTINGS_KEY]: { keepPickerOpen: true }
  };
  const store = await readStore();
  assert.equal(store.rules.length, 1);
  assert.equal(store.rules[0].host, 'example.com');
  assert.deepEqual(store.whitelist, ['example.com']);
  assert.deepEqual(await readSettings(), { keepPickerOpen: true });
});

test('selector heuristics ignore volatile ids and classes', () => {
  assert.equal(looksHashedClass('card-a1b2'), true);
  assert.equal(looksHashedClass('promo-banner'), false);
  assert.equal(looksDynamicId(':r1:'), true);
  assert.equal(looksDynamicId('ember-123'), true);
  assert.equal(looksDynamicId('id-abcdef'), true);
  assert.equal(looksDynamicId('main'), false);
  assert.equal(looksDynamicId('550e8400-e29b-41d4-a716-446655440000'), true);
});

test('stableClasses prefers non-ephemeral names', () => {
  const el = { classList: ['active', 'card', 'hero'] };
  assert.deepEqual(stableClasses(el), ['card', 'hero']);
  const onlyEphemeral = { classList: ['active', 'open'] };
  assert.deepEqual(stableClasses(onlyEphemeral), ['active', 'open']);
  const hashed = { classList: ['card-a1b2', 'layout'] };
  assert.deepEqual(stableClasses(hashed), ['layout']);
});