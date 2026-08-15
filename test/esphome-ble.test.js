'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EsphomeBle } = require('../lib/esphome-ble');

// A discover that knows which device it is looking for must resolve as soon
// as that device is seen, not sit out the full window — the difference is
// several seconds on every cold reconnect.
test('discover resolves early when the target advertises', async () => {
  const ble = new EsphomeBle({ host: 'stub' });
  ble._ensureClient = async () => ({
    _collect: handler => {
      // toalettet annonserer 200 ms etter at innsamlingen startet
      const timer = setTimeout(() => handler('adv', {}), 200);
      return () => clearTimeout(timer);
    },
    _addressesFromAdvertisement: () => [
      { address: 0x94a9a82d77ef, rssi: -80, localName: 'Geberit AC PRO', serviceUuids: [] }
    ]
  });

  const started = Date.now();
  const found = await ble.discover({ targetUuid: '94a9a82d77ef', timeout: 10000 });
  const elapsed = Date.now() - started;

  assert.equal(found.length, 1);
  assert.equal(found[0].uuid, '94a9a82d77ef');
  assert.ok(elapsed < 2000, `resolved in ${elapsed} ms — should not burn the 10 s window`);
});

test('discover without a target still scans the full window', async () => {
  const ble = new EsphomeBle({ host: 'stub' });
  ble._ensureClient = async () => ({
    _collect: handler => {
      const timer = setTimeout(() => handler('adv', {}), 50);
      return () => clearTimeout(timer);
    },
    _addressesFromAdvertisement: () => [
      { address: 0x94a9a82d77ef, rssi: -80, localName: '', serviceUuids: [] }
    ]
  });

  const started = Date.now();
  await ble.discover({ timeout: 400 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 380, `pairing scans must use the whole window (took ${elapsed} ms)`);
});
