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

// Repair views live in their OWN repair/ folder, not alongside the pairing
// views — HomeyCompose resolves drivers/<id>/<pairType>/ for pairType in
// ['pair', 'repair']. Putting the file in pair/ makes Homey answer
// "unknown_error_getting_file" on the phone, and `homey app validate` says
// nothing: it never looks at the repair array at all.
test('every repair view in app.json exists on disk', () => {
  for (const view of driverManifest.repair || []) {
    if (view.template) continue;
    const file = path.join(__dirname, '..', 'drivers', 'mera_comfort', 'repair', `${view.id}.html`);
    assert.ok(fs.existsSync(file), `repair view "${view.id}" has no repair/${view.id}.html`);
  }
});

test('the repair view sends each calibration step to the device', async () => {
  const session = fakeSession();
  const sent = [];
  const device = { runLidCalibrationStep: async step => { sent.push(step); return { step, code: 33, response: 'ok', serviceState: 0 }; } };

  await MeraComfortDriver.prototype.onRepair.call(fakeDriver(), session, device);

  assert.ok(session.handlers.calibrationStep, 'the buttons have nothing to call');
  const result = await session.handlers.calibrationStep({ step: 'start' });
  assert.deepEqual(sent, ['start']);
  // The view prints code and response as the only evidence the toilet answered.
  assert.equal(result.code, 33);
  assert.equal(result.response, 'ok');
});

// Leaving the routine open cost a real toilet its remote control for several
// minutes. These three pin the way out.
test('closing the view mid-calibration finishes the routine on the toilet', async () => {
  const session = fakeSession();
  const sent = [];
  const device = { runLidCalibrationStep: async step => { sent.push(step); return { step, code: 0, response: 'ok', serviceState: 0 }; } };

  await MeraComfortDriver.prototype.onRepair.call(fakeDriver(), session, device);
  await session.handlers.calibrationStep({ step: 'start' });
  await session.handlers.calibrationStep({ step: 'up' });
  await session.handlers.disconnect();

  assert.deepEqual(sent, ['start', 'up', 'save'],
    'the service mode must not outlive the view');
});

test('closing after saving does not save twice', async () => {
  const session = fakeSession();
  const sent = [];
  const device = { runLidCalibrationStep: async step => { sent.push(step); return { step, code: 0, response: 'ok', serviceState: 0 }; } };

  await MeraComfortDriver.prototype.onRepair.call(fakeDriver(), session, device);
  await session.handlers.calibrationStep({ step: 'start' });
  await session.handlers.calibrationStep({ step: 'save' });
  await session.handlers.disconnect();

  assert.deepEqual(sent, ['start', 'save']);
});

test('closing without ever starting touches nothing', async () => {
  const session = fakeSession();
  const sent = [];
  const device = { runLidCalibrationStep: async step => { sent.push(step); return { step, code: 0, response: 'ok', serviceState: 0 }; } };

  await MeraComfortDriver.prototype.onRepair.call(fakeDriver(), session, device);
  await session.handlers.disconnect();

  assert.deepEqual(sent, [], 'opening and closing the screen must be a no-op');
});

test('the four calibration steps map to the documented command codes', async () => {
  const { AQUACLEAN_COMMANDS } = require('../lib/aquaclean-protocol');
  assert.equal(AQUACLEAN_COMMANDS.START_LID_CALIBRATION, 33);
  assert.equal(AQUACLEAN_COMMANDS.LID_OFFSET_SAVE, 34);
  assert.equal(AQUACLEAN_COMMANDS.LID_OFFSET_INCREMENT, 35);
  assert.equal(AQUACLEAN_COMMANDS.LID_OFFSET_DECREMENT, 36);

  // Every button in the view must name a step the device recognises.
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'drivers', 'mera_comfort', 'repair', 'calibrate_lid.html'), 'utf8',
  );
  for (const step of ['start', 'up', 'down', 'save']) {
    assert.match(html, new RegExp(`id="${step}"`), `the view has no ${step} button`);
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

// The repair screen opens on the fault status, because that is why someone
// opens repair. Two rules matter more than the layout: a failed read must not
// read as "no error", and an unknown code must keep its number.
test('the repair status reports a fault, health and a failed read apart', async () => {
  const { formatErrorCode } = require('../lib/aquaclean-error-codes');
  const MeraComfortDevice = (() => {
    const load = Module._load;
    Module._load = (request, parent, isMain) =>
      (request === 'homey' ? { Device: class Device {} } : load.call(Module, request, parent, isMain));
    const mod = require('../drivers/mera_comfort/device');
    Module._load = load;
    return mod;
  })();

  const make = (code, refreshFails) => {
    const caps = { aquaclean_error_code: code, aquaclean_last_status_update: '18.08.2026, 22:31' };
    const device = Object.create(MeraComfortDevice.prototype);
    Object.assign(device, {
      _busy: false,
      _language: 'en',
      hasCapability: id => id in caps,
      getCapabilityValue: id => caps[id],
      refreshStatus: async () => { if (refreshFails) throw new Error('unreachable'); },
      waitForIdle: async () => {},
      log: () => {},
      error: () => {}
    });
    return device;
  };

  const healthy = await MeraComfortDevice.prototype.getErrorStatus.call(make(0, false));
  assert.equal(healthy.stale, false);
  assert.equal(healthy.code, 0, 'zero is a real answer: no fault');

  const faulty = await MeraComfortDevice.prototype.getErrorStatus.call(make(1035, false));
  assert.equal(faulty.hex, '040B', 'the manual notation, quotable to Geberit as-is');
  assert.match(faulty.description, /spray arm drive/);

  // A read that failed must say so. Reporting the cached zero as fresh would
  // tell the user the toilet is fine when nobody asked it.
  const unreachable = await MeraComfortDevice.prototype.getErrorStatus.call(make(0, true));
  assert.equal(unreachable.stale, true);

  // An unknown code keeps its number rather than being dropped.
  const unknown = await MeraComfortDevice.prototype.getErrorStatus.call(make(9999, false));
  assert.equal(unknown.hex, '270F');
  assert.match(unknown.description, /Unknown error/);
  assert.equal(formatErrorCode(9999, 'en').hex, '270F');
});

test('the repair views exist and the status view comes first', () => {
  const views = driverManifest.repair.map(view => view.id);
  assert.deepEqual(views, ['error_status', 'calibrate_lid'],
    'the fault status is the reason repair gets opened, so it opens on it');
  for (const id of views) {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'drivers', 'mera_comfort', 'repair', `${id}.html`)),
      `repair view "${id}" has no repair/${id}.html`,
    );
  }
});
