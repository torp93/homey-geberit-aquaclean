'use strict';

// Overriding onPair takes the list_devices template off its default wiring:
// it no longer finds onPairListDevices by itself. Getting that wrong makes
// pairing impossible for everyone, and nothing else in the suite would notice.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyMock(request, parent, isMain) {
  if (request === 'homey') return { App: class App {}, Driver: class Driver {}, Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const MeraComfortDriver = require('../drivers/mera_comfort/driver');
Module._load = originalLoad;

const appJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'),
);
const driverManifest = appJson.drivers.find(driver => driver.id === 'mera_comfort');

const fakeSession = () => {
  const handlers = {};
  return { handlers, setHandler: (name, fn) => { handlers[name] = fn; } };
};

const fakeDriver = (overrides = {}) => {
  const stored = {};
  const driver = Object.create(MeraComfortDriver.prototype);
  driver.log = () => {};
  driver.error = () => {};
  driver.homey = {
    settings: {
      get: key => stored[key],
      set: async (key, value) => { stored[key] = value; }
    }
  };
  driver.stored = stored;
  return Object.assign(driver, overrides);
};

test('every pair view in app.json exists on disk', () => {
  for (const view of driverManifest.pair) {
    if (view.template) continue; // templates ship with Homey
    const file = path.join(__dirname, '..', 'drivers', 'mera_comfort', 'pair', `${view.id}.html`);
    assert.ok(fs.existsSync(file), `pair view "${view.id}" has no ${view.id}.html`);
  }
});

test('the pair flow reaches the device list', () => {
  const ids = driverManifest.pair.map(view => view.id);
  assert.ok(ids.includes('list_devices'), 'no device list in the pair flow');

  // Either Homey's own Next button or a showView() call has to lead onward
  // from each custom view, or the flow dead-ends.
  for (const view of driverManifest.pair) {
    if (view.template || view.navigation) continue;
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'drivers', 'mera_comfort', 'pair', `${view.id}.html`), 'utf8',
    );
    assert.match(html, /Homey\.showView\(/,
      `"${view.id}" has neither navigation.next nor a showView() call — the flow stops there`);
  }
});

test('onPair wires list_devices back to onPairListDevices', async () => {
  const session = fakeSession();
  let listed = 0;
  const driver = fakeDriver({ onPairListDevices: async () => { listed += 1; return ['a device']; } });

  await MeraComfortDriver.prototype.onPair.call(driver, session);

  assert.ok(session.handlers.list_devices,
    'overriding onPair without this handler makes the device list permanently empty');
  assert.deepEqual(await session.handlers.list_devices(), ['a device']);
  assert.equal(listed, 1);
});

test('the proxy view can read and write the address', async () => {
  const session = fakeSession();
  const driver = fakeDriver();
  await MeraComfortDriver.prototype.onPair.call(driver, session);

  const empty = await session.handlers.getProxy();
  assert.equal(empty.host, '', 'a fresh install has no address to prefill');
  assert.equal(empty.port, 6053, 'the default port is offered');

  await session.handlers.saveProxy({ host: '192.168.10.13', port: 6053 });
  assert.equal(driver.stored.proxyHost, '192.168.10.13');
  assert.equal(driver.stored.proxyPort, 6053);

  const filled = await session.handlers.getProxy();
  assert.equal(filled.host, '192.168.10.13', 'a second pairing prefills what was saved');
});

test('a bad address is refused rather than stored', async () => {
  const session = fakeSession();
  const driver = fakeDriver();
  await MeraComfortDriver.prototype.onPair.call(driver, session);

  await assert.rejects(() => session.handlers.saveProxy({ host: 'http://1.2.3.4', port: 6053 }));
  await assert.rejects(() => session.handlers.saveProxy({ host: '1.2.3.4', port: 0 }));
  assert.equal(driver.stored.proxyHost, undefined, 'nothing was written');
});

// ---------------------------------------------------------------------------
// Homey drops already-paired devices from the list without saying so, so the
// user is told "no devices found" while the driver is looking straight at
// their toilet. These tests pin the three outcomes apart.

// Resolve against the real locale file, the way Homey does: the key in, the
// raw string out — placeholders left untouched. A stub that interpolated for
// free would have hidden the very bug these tests exist for.
const locale = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'),
);
const lookup = key => key.split('.').reduce(
  (node, part) => (node && node[part] !== undefined ? node[part] : undefined), locale,
) ?? key;

const scanningDriver = (advertisements, pairedIds = []) => {
  const driver = Object.create(MeraComfortDriver.prototype);
  driver.log = () => {};
  driver.homey = {
    __: lookup,
    app: { getBle: () => ({ discover: async () => advertisements }) }
  };
  driver.getDevices = () => pairedIds.map(id => ({ getData: () => ({ id }) }));
  return driver;
};

const toilet = (uuid = '94a9a82d77ef') => ({
  localName: 'Geberit AC PRO',
  uuid,
  rssi: -84,
  serviceUuids: ['00003ea000001000800000805f9b34fb']
});

test('an unpaired toilet is offered', async () => {
  const driver = scanningDriver([toilet(), { localName: 'Some lamp', uuid: 'aabb' }]);
  const found = await driver.onPairListDevices();
  assert.equal(found.length, 1);
  assert.equal(found[0].data.id, '94a9a82d77ef');
});

test('a toilet that is already added says so, by name', async () => {
  const driver = scanningDriver([toilet()], ['94a9a82d77ef']);
  await assert.rejects(
    () => driver.onPairListDevices(),
    error => {
      assert.match(error.message, /already added/i,
        'the user must not be told "no devices found" when it was found');
      assert.match(error.message, /Geberit AC PRO/, 'name the device that was found');
      assert.doesNotMatch(error.message, /{{/, 'no placeholder may survive');
      return true;
    },
  );
});

test('other Bluetooth traffic but no toilet blames the toilet, not the proxy', async () => {
  const driver = scanningDriver([{ localName: 'Some lamp', uuid: 'aabb' }]);
  await assert.rejects(() => driver.onPairListDevices(), /none of them is an AquaClean/);
});

test('a completely silent scan blames the proxy', async () => {
  const driver = scanningDriver([]);
  await assert.rejects(() => driver.onPairListDevices(), /proxy reported no devices at all/);
});

test('a second toilet can still be added alongside the first', async () => {
  const driver = scanningDriver([toilet('aaaa1111'), toilet('bbbb2222')], ['aaaa1111']);
  const found = await driver.onPairListDevices();
  assert.deepEqual(found.map(device => device.data.id), ['bbbb2222'],
    'only the one that is not already paired');
});

test('probe reports the outcome instead of throwing, so the step can retry', async () => {
  const session = fakeSession();
  const driver = scanningDriver([toilet()], ['94a9a82d77ef']);
  await MeraComfortDriver.prototype.onPair.call(driver, session);

  const result = await session.handlers.probe();
  assert.equal(result.outcome, 'already_added');
  assert.match(result.message, /Geberit AC PRO/,
    'the token must be filled in — this is what reached the phone as {{name}}');
  assert.doesNotMatch(result.message, /\{\{/, 'no placeholder may survive');
});

test('probe says ok when there is something to add', async () => {
  const session = fakeSession();
  const driver = scanningDriver([toilet()]);
  await MeraComfortDriver.prototype.onPair.call(driver, session);

  const result = await session.handlers.probe();
  assert.equal(result.outcome, 'ok');
  assert.equal(result.message, null);
});

test('probe separates a sleeping toilet from a silent proxy', async () => {
  const withTraffic = scanningDriver([{ localName: 'Some lamp', uuid: 'aabb' }]);
  assert.equal((await withTraffic.scanForAquaCleans()).outcome, 'none_advertising');

  const silent = scanningDriver([]);
  assert.equal((await silent.scanForAquaCleans()).outcome, 'proxy_silent');
});
