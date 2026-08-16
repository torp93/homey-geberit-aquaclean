'use strict';

// A pairing message reached a phone reading "Fant {{name}}, men den er allerede
// lagt til" — homey.__() had resolved the key but left the token in place.
// Every message with a placeholder was broken the same way.

const test = require('node:test');
const assert = require('node:assert/strict');
const { translate, fillTokens } = require('../lib/i18n');

const homey = table => ({ __: key => table[key] });

test('a token is replaced by its value', () => {
  const h = homey({ greet: 'Fant {{name}}, men den finnes' });
  assert.equal(translate(h, 'greet', { name: 'Geberit AC PRO' }),
    'Fant Geberit AC PRO, men den finnes');
});

test('several tokens, including repeats, are all replaced', () => {
  assert.equal(
    fillTokens('{{a}} og {{b}} og {{a}}', { a: '1', b: '2' }),
    '1 og 2 og 1',
  );
});

test('numbers and zero survive the substitution', () => {
  assert.equal(fillTokens('{{n}} enheter', { n: 0 }), '0 enheter',
    'zero must not be dropped as falsy');
  assert.equal(fillTokens('{{min}}–{{max}}', { min: 1, max: 5 }), '1–5');
});

test('whitespace inside the braces is tolerated', () => {
  assert.equal(fillTokens('{{ name }}', { name: 'x' }), 'x');
});

test('an unknown token is left visible rather than blanked', () => {
  assert.equal(fillTokens('{{missing}} her', {}), '{{missing}} her',
    'an empty gap would silently lose information');
});

test('text without tokens is untouched', () => {
  const h = homey({ plain: 'Ingen plassholder her' });
  assert.equal(translate(h, 'plain'), 'Ingen plassholder her');
  assert.equal(translate(h, 'plain', { unused: 'x' }), 'Ingen plassholder her');
});

test('a missing key falls back to the key instead of throwing', () => {
  assert.equal(translate(homey({}), 'no.such.key'), 'no.such.key');
  assert.equal(translate({ __: () => { throw new Error('boom'); } }, 'k'), 'k');
});

test('no user-facing message is sent through __() with tokens directly', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['drivers/mera_comfort/device.js', 'drivers/mera_comfort/driver.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const direct = source.match(/\.__\('[^']+',\s*\{/g) || [];
    assert.deepEqual(direct, [],
      `${file} passes tokens straight to __(), which does not substitute them`);
  }
});
