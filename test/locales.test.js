'use strict';

// Eleven user-facing error strings survived the first translation pass as
// hardcoded English, and nothing caught it — the keys simply sat unused in
// locales/. These tests make both directions of that drift fail loudly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

const flatten = (object, prefix = '') => Object.entries(object).flatMap(
  ([key, value]) => (value && typeof value === 'object'
    ? flatten(value, `${prefix}${key}.`)
    : [`${prefix}${key}`]),
);

const en = flatten(read('locales/en.json'));
const no = flatten(read('locales/no.json'));

// device.js:721-723 resolves these at runtime from a setting id, so they are
// used without ever appearing as a literal in the source.
const isDynamic = key => key.startsWith('setting.')
  || key === 'state.on'
  || key === 'state.off';

// Every file that can name a translation key: source, driver, pair and repair
// views. Repair views sit in their own folder, so listing only pair/ here would
// report every repair.* key as an unused orphan.
const viewFiles = folder => fs
  .readdirSync(path.join(root, `drivers/mera_comfort/${folder}`))
  .map(name => `drivers/mera_comfort/${folder}/${name}`);

const sourceText = () => {
  const files = [
    'app.js',
    'api.js',
    'drivers/mera_comfort/device.js',
    'drivers/mera_comfort/driver.js',
    ...viewFiles('pair'),
    ...viewFiles('repair')
  ];
  return files
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
};

// A key counts as used when it appears quoted anywhere — __('x'), t('x'),
// data-i18n="x" and lookup tables all name it the same way.
const usedKeys = () => {
  const text = sourceText();
  return new Set(en.filter(key => text.includes(`'${key}'`) || text.includes(`"${key}"`)));
};

test('Norwegian and English carry exactly the same keys', () => {
  assert.deepEqual(en.filter(key => !no.includes(key)), [],
    'these keys are English-only — a Norwegian Homey would fall back');
  assert.deepEqual(no.filter(key => !en.includes(key)), [],
    'these keys are Norwegian-only');
});

test('no translation is empty', () => {
  for (const [lang, file] of [['en', 'locales/en.json'], ['no', 'locales/no.json']]) {
    const walk = (object, prefix = '') => {
      for (const [key, value] of Object.entries(object)) {
        if (value && typeof value === 'object') walk(value, `${prefix}${key}.`);
        else assert.ok(String(value).trim().length > 0, `${lang}: ${prefix}${key} is empty`);
      }
    };
    walk(read(file));
  }
});

test('every key the code asks for exists', () => {
  const missing = [...usedKeys()].filter(key => !en.includes(key));
  assert.deepEqual(missing, [], 'these keys would render as the raw key id');
});

test('every declared key is actually used', () => {
  const used = usedKeys();
  const orphans = en.filter(key => !used.has(key) && !isDynamic(key));
  // An orphan usually means the string it replaced is still hardcoded English
  // somewhere — which is exactly the bug this file was written for.
  assert.deepEqual(orphans, [],
    'unused keys suggest the original hardcoded string was never swapped out');
});

test('placeholders match between the two languages', () => {
  const holders = value => (String(value).match(/\{\{\s*\w+\s*\}\}/g) || [])
    .map(token => token.replace(/[{}\s]/g, '')).sort();
  const enJson = read('locales/en.json');
  const noJson = read('locales/no.json');
  const get = (object, key) => key.split('.').reduce((node, part) => node[part], object);

  for (const key of en) {
    assert.deepEqual(holders(get(noJson, key)), holders(get(enJson, key)),
      `${key}: the two languages fill in different placeholders`);
  }
});
