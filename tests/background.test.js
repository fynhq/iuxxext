'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const messageListeners = [];
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
    },
    onChanged: { addListener() {} }
  },
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      addListener(fn) {
        messageListeners.push(fn);
      }
    }
  }
};

require('../src/shared.js');
require('../src/background.js');

const {
  RULES_KEY,
  WHITELIST_KEY,
  isWhitelisted
} = globalThis.IUXX;

const baseRule = {
  id: 'r1',
  host: 'a.com',
  scope: 'host',
  selector: '#ad',
  path: '',
  enabled: true,
  preview: '',
  createdAt: 1
};

function seed(whitelist, rules) {
  stored = {
    [RULES_KEY]: { version: 2, rules: (rules || []).map((rule) => ({ ...rule })) },
    [WHITELIST_KEY]: whitelist.slice()
  };
}

function send(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const respond = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    for (const listener of messageListeners) {
      listener(message, { tab: { id: 1 } }, respond);
    }
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`No response for ${message.type}`));
      }
    }, 2000);
  });
}

test('enabling blocking removes parent exceptions covering the host', async () => {
  seed(['example.com'], [baseRule]);
  const result = await send({
    type: 'SET_WHITELIST',
    domain: 'sub.example.com',
    enabled: false,
    removeAll: true
  });
  assert.equal(result.ok, true);
  assert.deepEqual(stored[WHITELIST_KEY], []);
  assert.equal(isWhitelisted('sub.example.com', stored[WHITELIST_KEY]), false);
});

test('disabling blocking keeps a parent exception when only the exact host is removed', async () => {
  seed(['example.com'], [baseRule]);
  const result = await send({
    type: 'SET_WHITELIST',
    domain: 'sub.example.com',
    enabled: false,
    removeAll: false
  });
  assert.equal(result.ok, true);
  assert.deepEqual(stored[WHITELIST_KEY], ['example.com']);
  assert.equal(isWhitelisted('sub.example.com', stored[WHITELIST_KEY]), true);
});

test('updating a rule onto a whitelisted host is rejected', async () => {
  seed(['example.com'], [baseRule]);
  const result = await send({
    type: 'UPDATE_RULE',
    id: 'r1',
    rule: {
      host: 'example.com',
      scope: 'host',
      selector: '#ad',
      path: '',
      preview: ''
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'whitelisted');
  assert.equal(stored[RULES_KEY].rules[0].host, 'a.com');
});

test('updating a rule to a non-whitelisted host succeeds', async () => {
  seed([], [baseRule]);
  const result = await send({
    type: 'UPDATE_RULE',
    id: 'r1',
    rule: {
      host: 'b.com',
      scope: 'domain',
      selector: '.promo',
      path: '/watch',
      preview: 'Promo'
    }
  });
  assert.equal(result.ok, true);
  assert.equal(stored[RULES_KEY].rules[0].host, 'b.com');
  assert.equal(stored[RULES_KEY].rules[0].scope, 'domain');
  assert.equal(stored[RULES_KEY].rules[0].selector, '.promo');
});