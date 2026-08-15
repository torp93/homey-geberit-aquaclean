'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  isValidHost,
  isValidPort,
  resolveProxyConfig,
} = require('../lib/proxy-config');

const settingsFrom = (values) => ({ get: (key) => values[key] });

test('isValidHost accepts IP addresses and hostnames', () => {
  assert.ok(isValidHost('192.168.10.13'));
  assert.ok(isValidHost('aquaclean-proxy.local'));
  assert.ok(isValidHost('proxy'));
});

test('isValidHost rejects schemes, paths, ports and empty input', () => {
  assert.ok(!isValidHost('http://192.168.10.13'));
  assert.ok(!isValidHost('192.168.10.13:6053'));
  assert.ok(!isValidHost('192.168.10.13/status'));
  assert.ok(!isValidHost('   '));
  assert.ok(!isValidHost(''));
  assert.ok(!isValidHost(undefined));
  assert.ok(!isValidHost(null));
  assert.ok(!isValidHost(1234));
});

test('isValidPort accepts the legal TCP range only', () => {
  assert.ok(isValidPort(1));
  assert.ok(isValidPort(6053));
  assert.ok(isValidPort(65535));
  assert.ok(!isValidPort(0));
  assert.ok(!isValidPort(65536));
  assert.ok(!isValidPort(6053.5));
  assert.ok(!isValidPort('6053'));
  assert.ok(!isValidPort(NaN));
});

test('resolveProxyConfig falls back when no settings exist', () => {
  // A fresh install has no stored address and must come back unconfigured
  // before the user has saved anything.
  const config = resolveProxyConfig(undefined);
  assert.deepStrictEqual(config, {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    source: 'unconfigured',
  });
});

test('resolveProxyConfig prefers a stored host', () => {
  const config = resolveProxyConfig(settingsFrom({ proxyHost: '10.0.0.7', proxyPort: 6053 }));
  assert.strictEqual(config.host, '10.0.0.7');
  assert.strictEqual(config.port, 6053);
  assert.strictEqual(config.source, 'settings');
});

test('resolveProxyConfig trims surrounding whitespace', () => {
  const config = resolveProxyConfig(settingsFrom({ proxyHost: '  10.0.0.7  ' }));
  assert.strictEqual(config.host, '10.0.0.7');
});

test('resolveProxyConfig ignores an invalid stored host', () => {
  const config = resolveProxyConfig(settingsFrom({ proxyHost: 'http://10.0.0.7' }));
  assert.strictEqual(config.host, DEFAULT_HOST);
  assert.strictEqual(config.source, 'unconfigured');
});

test('resolveProxyConfig ignores an invalid stored port but keeps the host', () => {
  const config = resolveProxyConfig(settingsFrom({ proxyHost: '10.0.0.7', proxyPort: 0 }));
  assert.strictEqual(config.host, '10.0.0.7');
  assert.strictEqual(config.port, DEFAULT_PORT);
  assert.strictEqual(config.source, 'settings');
});
