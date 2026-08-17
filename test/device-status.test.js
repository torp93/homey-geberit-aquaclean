'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyMock(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const MeraComfortDevice = require('../drivers/mera_comfort/device');
Module._load = originalLoad;

test('legacy system buttons migrate to icon-capable AquaClean buttons', async () => {
  const capabilities = new Set([
    'button.anal_shower',
    'button.lady_shower',
    'button.dryer',
    'button.stop',
    'button.lid',
    'button.odour_extraction',
    'button.odour_run_on',
    'button.flush',
    'button.refresh_status'
  ]);
  const device = {
    hasCapability: capabilityId => capabilities.has(capabilityId),
    addCapability: async capabilityId => capabilities.add(capabilityId),
    removeCapability: async capabilityId => capabilities.delete(capabilityId),
    getCapabilities: () => [...capabilities],
    driver: { manifest: { capabilities: [
      'aquaclean_button_anal_shower', 'aquaclean_button_lady_shower',
      'aquaclean_button_lid', 'aquaclean_button_refresh_status',
      'aquaclean_odour_extraction_running', 'measure_aquaclean_user_sitting',
      'measure_aquaclean_anal_shower', 'aquaclean_button_dryer',
      'aquaclean_button_stop', 'aquaclean_button_odour_extraction',
      'aquaclean_button_odour_run_on', 'aquaclean_user_sitting',
      'aquaclean_anal_shower_running', 'aquaclean_lady_shower_running',
      'measure_aquaclean_lady_shower', 'measure_aquaclean_odour_extraction',
      'aquaclean_descaling_state', 'aquaclean_error_code', 'aquaclean_raw_status',
      'aquaclean_days_until_descaling', 'aquaclean_days_until_filter',
      'aquaclean_dryer_running', 'measure_aquaclean_dryer',
      'aquaclean_last_setting_write', 'measure_signal_strength',
      'aquaclean_connection_state', 'aquaclean_last_status_update',
      'aquaclean_connection_error'
    ] } },
    removeCapabilitiesMissingFromManifest:
      MeraComfortDevice.prototype.removeCapabilitiesMissingFromManifest,
    log: () => {},
    error: () => {}
  };

  await MeraComfortDevice.prototype.ensureCapabilities.call(device);

  assert.equal(capabilities.has('aquaclean_button_anal_shower'), true);
  assert.equal(capabilities.has('aquaclean_button_lady_shower'), true);
  assert.equal(capabilities.has('aquaclean_button_lid'), true);
  assert.equal(capabilities.has('aquaclean_button_refresh_status'), true);
  assert.equal(capabilities.has('aquaclean_odour_extraction_running'), true);
  assert.equal(capabilities.has('measure_aquaclean_user_sitting'), true);
  assert.equal(capabilities.has('measure_aquaclean_anal_shower'), true);
  assert.equal(capabilities.has('button.anal_shower'), false);
  assert.equal(capabilities.has('button.refresh_status'), false);
});

test('boolean event Insights are disabled once for all duration statuses', async () => {
  const capabilities = new Set([
    'aquaclean_user_sitting',
    'aquaclean_anal_shower_running',
    'aquaclean_lady_shower_running',
    'aquaclean_odour_extraction_running'
  ]);
  const applied = [];
  let optionsVersion = null;
  const device = {
    hasCapability: capabilityId => capabilities.has(capabilityId),
    getCapabilityOptions: () => ({ titleTrue: { no: 'Pågår' } }),
    setCapabilityOptions: async (capabilityId, options) => {
      applied.push({ capabilityId, options });
    },
    getStoreValue: () => optionsVersion,
    setStoreValue: async (key, value) => {
      if (key === 'insightsOptionsVersion') optionsVersion = value;
    }
  };

  await MeraComfortDevice.prototype.ensureInsightsCapabilityOptions.call(device);
  await MeraComfortDevice.prototype.ensureInsightsCapabilityOptions.call(device);

  assert.equal(applied.length, 4);
  assert.deepEqual(
    applied.map(item => item.capabilityId),
    [
      'aquaclean_user_sitting',
      'aquaclean_anal_shower_running',
      'aquaclean_lady_shower_running',
      'aquaclean_odour_extraction_running'
    ],
  );
  assert.equal(applied.every(item => item.options.preventInsights === true), true);
  assert.equal(applied.every(item => item.options.titleTrue.no === 'Pågår'), true);
});

test('boolean statuses are mirrored to numeric 0/1 Insights graphs', async () => {
  const values = new Map([
    ['measure_aquaclean_user_sitting', null],
    ['measure_aquaclean_anal_shower', 0]
  ]);
  const device = {
    hasCapability: capabilityId => values.has(capabilityId),
    getCapabilityValue: capabilityId => values.get(capabilityId),
    setCapabilityValue: async (capabilityId, value) => {
      values.set(capabilityId, value);
    }
  };

  await MeraComfortDevice.prototype.syncStatusInsightsCapability.call(
    device,
    'aquaclean_user_sitting',
    true,
  );
  await MeraComfortDevice.prototype.syncStatusInsightsCapability.call(
    device,
    'aquaclean_anal_shower_running',
    false,
  );

  assert.equal(values.get('measure_aquaclean_user_sitting'), 1);
  assert.equal(values.get('measure_aquaclean_anal_shower'), 0);
});

test('adaptive polling is slow while idle and fast during activity', () => {
  const values = new Map([
    ['aquaclean_user_sitting', false],
    ['aquaclean_anal_shower_running', false],
    ['aquaclean_lady_shower_running', false],
    ['aquaclean_odour_extraction_running', false]
  ]);
  const settings = new Map();
  const device = {
    getCapabilityValue: capabilityId => values.get(capabilityId),
    getSetting: settingId => settings.get(settingId),
    getPollIntervalSetting: MeraComfortDevice.prototype.getPollIntervalSetting
  };

  assert.equal(
    MeraComfortDevice.prototype.getStatusPollIntervalMilliseconds.call(device),
    30000,
  );
  values.set('aquaclean_user_sitting', true);
  assert.equal(
    MeraComfortDevice.prototype.getStatusPollIntervalMilliseconds.call(device),
    2500,
  );

  // Configured values win over the built-in defaults.
  settings.set('status_poll_active_seconds', 5);
  settings.set('status_poll_idle_seconds', 120);
  assert.equal(
    MeraComfortDevice.prototype.getStatusPollIntervalMilliseconds.call(device),
    5000,
  );
  values.set('aquaclean_user_sitting', false);
  assert.equal(
    MeraComfortDevice.prototype.getStatusPollIntervalMilliseconds.call(device),
    120000,
  );

  // Nonsense falls back, and nothing may poll faster than the scheduler ticks.
  settings.set('status_poll_idle_seconds', 0);
  assert.equal(
    MeraComfortDevice.prototype.getStatusPollIntervalMilliseconds.call(device),
    30000,
    'zero must fall back to the default rather than poll continuously',
  );
  settings.set('status_poll_idle_seconds', 0.1);
  assert.equal(
    MeraComfortDevice.prototype.getStatusPollIntervalMilliseconds.call(device),
    1000,
  );
});

test('a settings write holds the session open, a background poll does not', async () => {
  const run = async ({ task }) => {
    const closed = [];
    const session = {
      ready: true,
      protocol: {
        getSystemState: async () => ({ state: { parameters: { 0: 0 } } })
      }
    };
    const device = {
      _deleted: false,
      _busy: false,
      _activeOperation: null,
      _idleWaiters: [],
      _controlRequestsWaiting: 0,
      _refreshPreemptRequested: false,
      _session: session,
      ensureProtocolSession: async () => session,
      getSetting: () => 120,
      getKeepWarmMilliseconds: MeraComfortDevice.prototype.getKeepWarmMilliseconds,
      mapConfiguredShowerState: state => state,
      storeOperationResult: async () => {},
      setConnectionState: async () => {},
      setConnectionError: async () => {},
      setAvailable: async () => {},
      closeProtocolSession: async target => {
        closed.push(target);
        target.ready = false;
        device._session = null;
      },
      homey: { clearTimeout: () => {} },
      log: () => {},
      error: () => {}
    };

    await MeraComfortDevice.prototype.runProtocolOperation.call(
      device,
      task ? { task: async () => 'written' } : { parameterIds: [0] }
    );
    return { closed, session };
  };

  const write = await run({ task: true });
  assert.equal(write.closed.length, 0, 'a settings write must leave the session open');
  assert.ok(write.session.keepWarmUntil > Date.now(), 'the warm window must be set');

  const poll = await run({ task: false });
  assert.equal(poll.closed.length, 1, 'a background poll must release the toilet');
});

test('on-demand refresh always disconnects and returns to ready state', async () => {
  const states = [];
  const closed = [];
  const session = {
    ready: true,
    protocol: {
      getSystemState: async () => ({ state: { parameters: { 0: 0 } } })
    }
  };
  const device = {
    _deleted: false,
    _busy: false,
    _activeOperation: null,
    _idleWaiters: [],
    _controlRequestsWaiting: 0,
    _refreshPreemptRequested: false,
    _session: session,
    ensureProtocolSession: async () => session,
    getSetting: () => 120,
    getKeepWarmMilliseconds: MeraComfortDevice.prototype.getKeepWarmMilliseconds,
    mapConfiguredShowerState: state => state,
    storeOperationResult: async () => {},
    setConnectionState: async state => states.push(state),
    setConnectionError: async () => {},
    setAvailable: async () => {},
    closeProtocolSession: async target => {
      closed.push(target);
      target.ready = false;
      device._session = null;
    },
    homey: {
      clearTimeout: () => {}
    },
    log: () => {},
    error: () => {}
  };

  await MeraComfortDevice.prototype.runProtocolOperation.call(device, {
    parameterIds: [0],
    stateScope: 'live'
  });

  assert.deepEqual(closed, [session]);
  assert.deepEqual(states, ['connected', 'ready']);
  assert.equal(device._session, null);
});

test('on-demand command disconnects when the protocol request fails', async () => {
  const closed = [];
  const session = {
    ready: true,
    protocol: {
      executeCommand: async () => {
        throw new Error('command failed');
      }
    }
  };
  const device = {
    _deleted: false,
    _busy: false,
    _activeOperation: null,
    _idleWaiters: [],
    _controlRequestsWaiting: 0,
    _refreshPreemptRequested: false,
    _session: session,
    ensureProtocolSession: async () => session,
    getSetting: () => 120,
    getKeepWarmMilliseconds: MeraComfortDevice.prototype.getKeepWarmMilliseconds,
    closeProtocolSession: async target => {
      closed.push(target);
      target.ready = false;
      device._session = null;
    },
    homey: {
      clearTimeout: () => {}
    },
    log: () => {},
    error: () => {}
  };

  await assert.rejects(
    MeraComfortDevice.prototype.runProtocolOperation.call(device, {
      command: { code: 1 }
    }),
    /command failed/,
  );
  assert.deepEqual(closed, [session]);
  assert.equal(device._session, null);
});

test('automatic odour status follows seating and configured run-on', async () => {
  const written = [];
  const scheduled = [];
  const values = new Map([
    ['aquaclean_odour_extraction_running', false]
  ]);
  const device = {
    isAutomaticOdourTrackingEnabled: () => true,
    hasCapability: capabilityId =>
      capabilityId === 'aquaclean_odour_extraction_running',
    getCapabilityValue: capabilityId => values.get(capabilityId),
    setStatusCapabilityValue: async (capabilityId, value) => {
      values.set(capabilityId, value);
      written.push({ capabilityId, value });
    },
    getOdourRunOnMilliseconds: () => 120000,
    clearOdourRunOnTimer: () => {},
    scheduleOdourExtractionOff: async milliseconds => {
      scheduled.push(milliseconds);
    }
  };

  await MeraComfortDevice.prototype.applyAutomaticOdourState.call(
    device,
    true,
    false,
  );
  await MeraComfortDevice.prototype.applyAutomaticOdourState.call(
    device,
    false,
    true,
  );

  assert.deepEqual(written, [{
    capabilityId: 'aquaclean_odour_extraction_running',
    value: true
  }]);
  assert.deepEqual(scheduled, [120000]);
});

test('anal shower status changes update Homey and fire the matching Flow trigger', async () => {
  const values = new Map([['aquaclean_anal_shower_running', false]]);
  const fired = [];
  const device = {
    hasCapability: capabilityId => values.has(capabilityId),
    syncStatusInsightsCapability: MeraComfortDevice.prototype.syncStatusInsightsCapability,
    getCapabilityValue: capabilityId => values.get(capabilityId),
    setCapabilityValue: async (capabilityId, value) => values.set(capabilityId, value),
    homey: {
      flow: {
        getDeviceTriggerCard: triggerId => ({
          trigger: async target => fired.push({ triggerId, target })
        })
      }
    },
    log: () => {},
    error: () => {}
  };

  await MeraComfortDevice.prototype.setStatusCapabilityValue.call(
    device,
    'aquaclean_anal_shower_running',
    true,
  );

  assert.equal(values.get('aquaclean_anal_shower_running'), true);
  assert.deepEqual(fired, [{
    triggerId: 'aquaclean_anal_shower_running_true',
    target: device
  }]);
});

test('unchanged status does not fire a duplicate Flow trigger', async () => {
  const fired = [];
  const device = {
    hasCapability: () => false,
    syncStatusInsightsCapability: MeraComfortDevice.prototype.syncStatusInsightsCapability,
    getCapabilityValue: () => true,
    setCapabilityValue: async () => {
      throw new Error('unchanged value should not be written');
    },
    homey: {
      flow: {
        getDeviceTriggerCard: triggerId => ({
          trigger: async () => fired.push(triggerId)
        })
      }
    },
    log: () => {},
    error: () => {}
  };

  await MeraComfortDevice.prototype.setStatusCapabilityValue.call(
    device,
    'aquaclean_anal_shower_running',
    true,
  );

  assert.deepEqual(fired, []);
});

test('anal shower status can use parameter 3 for alternate firmware', () => {
  const device = {
    getSetting: settingId => settingId === 'anal_status_parameter' ? '3' : null,
    getAnalStatusParameterId:
      MeraComfortDevice.prototype.getAnalStatusParameterId
  };
  const state = {
    parameters: { 0: 1, 1: 0, 2: 0, 3: 1 },
    analShowerIsRunning: false,
    ladyShowerIsRunning: false
  };

  const mapped = MeraComfortDevice.prototype.mapConfiguredShowerState.call(
    device,
    state,
  );

  assert.equal(mapped.analShowerIsRunning, true);
  assert.equal(mapped.ladyShowerIsRunning, false);
});

test('anal shower status defaults to confirmed parameter 1 and formats raw diagnostics', () => {
  const device = {
    getSetting: () => null,
    getAnalStatusParameterId:
      MeraComfortDevice.prototype.getAnalStatusParameterId
  };
  const state = {
    parameters: { 0: 1, 1: 1, 2: 1, 3: 0 },
    analShowerIsRunning: false,
    ladyShowerIsRunning: false
  };

  const mapped = MeraComfortDevice.prototype.mapConfiguredShowerState.call(
    device,
    state,
  );
  const diagnostic = MeraComfortDevice.prototype.formatRawLiveStatus.call(
    device,
    mapped,
  );

  assert.equal(mapped.analShowerIsRunning, true);
  assert.equal(mapped.ladyShowerIsRunning, true);
  assert.equal(
    diagnostic,
    'P0=1 P1=1 P2=1 P3=0 P4=? P5=? P6=? P7=?',
  );
});

test('GATT setup discovers only the Geberit characteristics after service discovery', async () => {
  const requestedCharacteristicUuids = [];
  const requestedServiceUuids = [];
  const characteristics = [{ uuid: 'characteristic-1' }];
  const service = {
    uuid: '3334429d-90f3-4c41-a02d-5cb3a03e0000',
    discoverCharacteristics: async uuids => {
      requestedCharacteristicUuids.push(...uuids);
      return characteristics;
    }
  };
  const peripheral = {
    discoverServices: async uuids => {
      requestedServiceUuids.push(...uuids);
      return [service];
    },
    discoverAllServicesAndCharacteristics: async () => {
      throw new Error('full GATT discovery must not be used');
    }
  };
  // discoverProtocolGatt wraps both discovery calls in withTimeout, which uses
  // homey.setTimeout — the stub needs it or the test throws before asserting.
  const device = {
    log: () => {},
    homey: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer)
    }
  };

  const services = await MeraComfortDevice.prototype.discoverProtocolGatt.call(
    device,
    peripheral,
  );

  assert.equal(services.length, 1);
  assert.deepEqual(requestedServiceUuids, [
    '3334429d90f34c41a02d5cb3a03e0000'
  ]);
  assert.equal(services[0].uuid, service.uuid);
  assert.equal(services[0].characteristics, characteristics);
  assert.equal(requestedCharacteristicUuids.length, 8);
  assert.equal(new Set(requestedCharacteristicUuids).size, 8);
});

test('stale cached BLE advertisements with RSSI zero force a fresh scan', async () => {
  const stale = { uuid: 'toilet', rssi: 0 };
  const fresh = { uuid: 'toilet', rssi: -69 };
  const device = {
    homey: {
      ble: {
        find: async () => stale
      }
    },
    discoverWithBusyRetry: async () => [fresh],
    log: () => {},
    error: () => {}
  };

  const advertisement = await MeraComfortDevice.prototype.findFreshAdvertisement.call(
    device,
    'toilet',
  );

  assert.equal(advertisement, fresh);
});

test('BLE scan ignores RSSI zero results until a real advertisement arrives', async () => {
  const stale = { uuid: 'toilet', rssi: 0, localName: 'Geberit AC PRO' };
  const fresh = { uuid: 'toilet', rssi: -70, localName: 'Geberit AC PRO' };
  let scanAttempts = 0;
  const device = {
    homey: {
      setTimeout: callback => setTimeout(callback, 0)
    },
    discoverWithBusyRetry: async () => {
      scanAttempts += 1;
      return scanAttempts === 1 ? [stale] : [fresh];
    },
    log: () => {},
    error: () => {}
  };

  const advertisement = await MeraComfortDevice.prototype.findFreshAdvertisement.call(
    device,
    'toilet',
    { forceScan: true },
  );

  assert.equal(scanAttempts, 2);
  assert.equal(advertisement, fresh);
});

test('status heartbeat is throttled while still advancing during healthy polling', async () => {
  const values = [];
  const device = {
    _lastStatusHeartbeatAt: 0,
    _timeZone: 'Europe/Oslo',
    hasCapability: capabilityId => capabilityId === 'aquaclean_last_status_update',
    setCapabilityValue: async (capabilityId, value) => values.push({ capabilityId, value }),
    formatLocalTime: MeraComfortDevice.prototype.formatLocalTime,
    homey: {},
    error: () => {}
  };

  await MeraComfortDevice.prototype.updateLastStatusHeartbeat.call(
    device,
    '2026-07-28T16:00:00.000Z',
  );
  await MeraComfortDevice.prototype.updateLastStatusHeartbeat.call(
    device,
    '2026-07-28T16:00:05.000Z',
  );
  await MeraComfortDevice.prototype.updateLastStatusHeartbeat.call(
    device,
    '2026-07-28T16:00:15.000Z',
  );

  assert.equal(values.length, 2);
  assert.equal(values[0].capabilityId, 'aquaclean_last_status_update');
  assert.notEqual(values[0].value, values[1].value);
});

test('technical Bluetooth error is exposed and cleared after recovery', async () => {
  const values = new Map([['aquaclean_connection_error', null]]);
  const device = {
    hasCapability: capabilityId => capabilityId === 'aquaclean_connection_error',
    getCapabilityValue: capabilityId => values.get(capabilityId),
    setCapabilityValue: async (capabilityId, value) => values.set(capabilityId, value)
  };

  await MeraComfortDevice.prototype.setConnectionError.call(
    device,
    new Error('Could not connect to peripheral'),
  );
  assert.equal(
    values.get('aquaclean_connection_error'),
    'Could not connect to peripheral',
  );

  await MeraComfortDevice.prototype.setConnectionError.call(device, null);
  assert.equal(values.get('aquaclean_connection_error'), '—');
});

test('capabilities dropped from the manifest are removed from the device', async () => {
  const removed = [];
  const device = {
    driver: { manifest: { capabilities: ['aquaclean_button_stop', 'measure_signal_strength'] } },
    getCapabilities: () => ['aquaclean_button_stop', 'button', 'measure_signal_strength', 'onoff'],
    removeCapability: async id => removed.push(id),
    log: () => {},
    error: () => {}
  };

  await MeraComfortDevice.prototype.removeCapabilitiesMissingFromManifest.call(device);
  assert.deepEqual(removed, ['button', 'onoff']);
});

test('a missing manifest removes nothing rather than guessing', async () => {
  const removed = [];
  const base = {
    getCapabilities: () => ['button'],
    removeCapability: async id => removed.push(id),
    log: () => {},
    error: () => {}
  };

  for (const driver of [undefined, {}, { manifest: {} }, { manifest: { capabilities: [] } }]) {
    await MeraComfortDevice.prototype.removeCapabilitiesMissingFromManifest.call({ ...base, driver });
  }
  assert.deepEqual(removed, []);
});

test('a button pressed during settings work waits instead of failing', async () => {
  const session = {
    ready: true,
    protocol: {
      executeCommand: async () => ({ status: 0 }),
      getSystemState: async () => ({ state: { parameters: { 0: 0 } } })
    }
  };
  const device = {
    _deleted: false,
    _busy: true,
    _activeOperation: 'settings',
    _idleWaiters: [],
    _controlRequestsWaiting: 0,
    _refreshPreemptRequested: false,
    _session: session,
    ensureProtocolSession: async () => session,
    getSetting: () => 30,
    getKeepWarmMilliseconds: MeraComfortDevice.prototype.getKeepWarmMilliseconds,
    mapConfiguredShowerState: state => state,
    storeOperationResult: async () => {},
    applyOptimisticCommandState: async () => {},
    setConnectionState: async () => {},
    setConnectionError: async () => {},
    setAvailable: async () => {},
    closeProtocolSession: async () => {},
    waitForIdle: async () => { device._busy = false; device._activeOperation = null; },
    runProtocolOperation: MeraComfortDevice.prototype.runProtocolOperation,
    homey: { clearTimeout: () => {}, setTimeout: (fn, ms) => setTimeout(fn, ms) },
    log: () => {},
    error: () => {}
  };

  // Must resolve rather than throw AQUACLEAN_BUSY.
  await MeraComfortDevice.prototype.runProtocolOperation.call(device, {
    command: { code: 1, label: 'stop' }
  });
});

test('a background poll during another operation is skipped, not an error', async () => {
  const device = {
    _deleted: false,
    _busy: true,
    _activeOperation: 'settings',
    _idleWaiters: [],
    _controlRequestsWaiting: 0,
    log: () => {},
    error: () => {}
  };

  const result = await MeraComfortDevice.prototype.runProtocolOperation.call(device, {
    parameterIds: [0],
    skipIfBusy: true
  });
  assert.equal(result, null);

  await assert.rejects(
    MeraComfortDevice.prototype.runProtocolOperation.call(device, { parameterIds: [0] }),
    /already handling another Bluetooth request/,
    'a foreground refresh must still report the conflict',
  );
});

test('pressing the same toggle again is sent, but a double-fire is not', async () => {
  const sent = [];
  const session = {
    ready: true,
    protocol: {
      executeCommand: async code => { sent.push(code); return { status: 0 }; },
      getSystemState: async () => ({ state: { parameters: { 0: 0 } } })
    }
  };
  const makeDevice = startedAt => {
    const device = {
      _deleted: false,
      _busy: true,
      _activeOperation: 'control',
      _activeCommandCode: 7,
      _activeCommandStartedAt: startedAt,
      _idleWaiters: [],
      _controlRequestsWaiting: 0,
      _refreshPreemptRequested: false,
      _session: session,
      ensureProtocolSession: async () => session,
      getSetting: () => 30,
      getKeepWarmMilliseconds: MeraComfortDevice.prototype.getKeepWarmMilliseconds,
      runProtocolOperation: MeraComfortDevice.prototype.runProtocolOperation,
      mapConfiguredShowerState: state => state,
      storeOperationResult: async () => {},
      applyOptimisticCommandState: async () => {},
      setConnectionState: async () => {},
      setConnectionError: async () => {},
      setAvailable: async () => {},
      closeProtocolSession: async () => {},
      waitForIdle: async () => { device._busy = false; device._activeOperation = null; },
      homey: { clearTimeout: () => {}, setTimeout: (fn, ms) => setTimeout(fn, ms) },
      log: () => {},
      error: () => {}
    };
    return device;
  };

  // Off then on, a couple of seconds apart: the second press must reach the toilet.
  await MeraComfortDevice.prototype.runProtocolOperation.call(
    makeDevice(Date.now() - 3000),
    { command: { code: 7, label: 'odour' } },
  );
  assert.deepEqual(sent, [7], 'a deliberate second press must be sent');

  // The same press counted twice by the interface is dropped.
  const result = await MeraComfortDevice.prototype.runProtocolOperation.call(
    makeDevice(Date.now()),
    { command: { code: 7, label: 'odour' } },
  );
  assert.equal(result, null);
  assert.deepEqual(sent, [7], 'an immediate repeat must not be sent again');
});

test('switching profile and a value in one save writes to the new profile', async () => {
  const written = [];
  const device = {
    getSetting: settingId => (settingId === 'edit_profile' ? 0 : undefined),
    getEditProfileId: MeraComfortDevice.prototype.getEditProfileId,
    runProtocolOperation: async ({ task }) => task({
      setProfileSetting: async (id, value, profileId) => {
        written.push({ id, value, profileId });
      },
      getProfileSetting: async () => 1
    }),
    noteSettingSaved: async () => {},
    log: () => {},
    error: () => {}
  };

  // getSetting still reports profile 0 here — the save has not been committed.
  await MeraComfortDevice.prototype.writeConfigSetting.call(
    device, 'profile_oscillation', true, 3,
  );
  assert.deepEqual(
    written.map(w => w.profileId), [3],
    'the value must land in the profile just chosen, not the one being left',
  );

  // With no switch in the same save, the stored profile still decides.
  written.length = 0;
  await MeraComfortDevice.prototype.writeConfigSetting.call(
    device, 'profile_oscillation', true,
  );
  assert.deepEqual(written.map(w => w.profileId), [0]);
});

test('timestamps follow the Homey timezone, not the app UTC clock', () => {
  const summerNoonUtc = new Date('2026-08-13T20:00:00Z');

  const oslo = {
    _timeZone: 'Europe/Oslo',
    formatLocalTime: MeraComfortDevice.prototype.formatLocalTime
  };
  assert.equal(
    oslo.formatLocalTime(summerNoonUtc, { hour: '2-digit', minute: '2-digit' }),
    '22:00',
    'CEST is two hours ahead of UTC in August',
  );

  // No timezone known: fall back rather than lose the timestamp.
  const unknown = {
    _timeZone: null,
    formatLocalTime: MeraComfortDevice.prototype.formatLocalTime
  };
  assert.match(
    unknown.formatLocalTime(summerNoonUtc, { hour: '2-digit', minute: '2-digit' }),
    /^\d{2}:\d{2}$/,
  );

  // A bogus timezone must not throw either.
  const bogus = {
    _timeZone: 'Not/AZone',
    formatLocalTime: MeraComfortDevice.prototype.formatLocalTime
  };
  assert.match(
    bogus.formatLocalTime(summerNoonUtc, { hour: '2-digit', minute: '2-digit' }),
    /^\d{2}:\d{2}$/,
  );
});

test('a failed write in a multi-setting save triggers a re-read', async () => {
  const written = [];
  let refreshed = false;
  const device = {
    getSetting: () => 0,
    getEditProfileId: () => 0,
    isAutomaticOdourTrackingEnabled: () => false,
    getOdourRunOnMilliseconds: () => 0,
    writeConfigSetting: async settingId => {
      written.push(settingId);
      if (settingId === 'lid_auto_close') throw new Error('the toilet refused');
    },
    refreshSettingsAndMaintenance: async () => { refreshed = true; },
    setSettings: async () => {},
    homey: { setTimeout: fn => fn() },
    log: () => {},
    error: () => {}
  };

  await assert.rejects(
    MeraComfortDevice.prototype.onSettings.call(device, {
      changedKeys: ['lid_auto_open', 'lid_auto_close', 'lid_sensor_range'],
      newSettings: { lid_auto_open: true, lid_auto_close: false, lid_sensor_range: 2 }
    }),
    /refused/,
  );

  assert.deepEqual(written, ['lid_auto_open', 'lid_auto_close'], 'it stops at the failure');
  assert.equal(refreshed, true, 'the page must be re-synced with the toilet');
});

test('maintenance triggers fire on drops only, connection triggers on real transitions', async () => {
  const fired = [];
  const makeDevice = caps => ({
    _caps: caps,
    hasCapability: id => id in caps,
    getCapabilityValue: id => caps[id],
    setCapabilityValue: async (id, v) => { caps[id] = v; },
    homey: { flow: { getDeviceTriggerCard: id => ({
      trigger: async (dev, tokens, state) => fired.push({ id, tokens, state })
    }) } },
    log: () => {},
    error: () => {}
  });

  // A drop fires with previous/current as state; a rise (filter reset) stays quiet.
  const d1 = makeDevice({ aquaclean_days_until_descaling: 20, aquaclean_days_until_filter: 2 });
  await MeraComfortDevice.prototype.applyMaintenance.call(
    d1, { daysUntilNextDescale: 10 }, { daysUntilFilterChange: 239 },
  );
  assert.deepEqual(fired.map(f => f.id), ['aquaclean_days_until_descaling_below']);
  assert.deepEqual(fired[0].state, { previous: 20, current: 10 });

  // The app-side listener: only a crossing of the flow's own limit passes.
  const crossed = (args, state) => state.current < args.days && state.previous >= args.days;
  assert.equal(crossed({ days: 14 }, { previous: 20, current: 10 }), true);
  assert.equal(crossed({ days: 14 }, { previous: 10, current: 5 }), false, 'already below: no refire');
  assert.equal(crossed({ days: 7 }, { previous: 20, current: 10 }), false, 'not yet below this limit');

  // Connection: reconnect churn is silent; giving up and coming back fire.
  fired.length = 0;
  const d2 = makeDevice({ aquaclean_connection_state: 'ready' });
  d2._connectionLossNotified = false;
  const set = state => MeraComfortDevice.prototype.setConnectionState.call(d2, state);
  await set('connected'); await set('reconnecting'); await set('ready');
  assert.deepEqual(fired, [], 'normal churn must not notify');
  await set('disconnected');
  await set('reconnecting');
  await set('disconnected');
  await set('ready');
  assert.deepEqual(fired.map(f => f.id),
    ['aquaclean_connection_lost', 'aquaclean_connection_restored']);
});

test('a failed settings poll backs off instead of retrying back-to-back', async () => {
  let refreshCalls = 0;
  const device = {
    _deleted: false,
    _busy: false,
    _lastSettingsRefreshAt: 0,
    _lastSettingsAttemptAt: 0,
    _nextReconnectAt: 0,
    isSessionReady: () => false,
    refreshSettingsAndMaintenance: async () => { refreshCalls += 1; throw new Error('unreachable'); }
  };
  const poll = () => MeraComfortDevice.prototype.pollSettingsAndMaintenance
    .call(device).catch(() => {});

  await poll();
  assert.equal(refreshCalls, 1);

  // Immediately after the failure: the retry gate holds.
  await poll();
  await poll();
  assert.equal(refreshCalls, 1, 'a failed attempt must not retry back-to-back');

  // The reconnect backoff holds it too, even after the retry window.
  device._lastSettingsAttemptAt = 0;
  device._nextReconnectAt = Date.now() + 60000;
  await poll();
  assert.equal(refreshCalls, 1, 'an unreachable toilet is left to the backoff');

  // Backoff expired: it tries again.
  device._nextReconnectAt = 0;
  await poll();
  assert.equal(refreshCalls, 2);
});

test('background settings refresh does not extend keep-warm; init cache skips info reads', async () => {
  const reads = [];
  const session = {
    ready: true,
    protocol: {
      getCommonSetting: async () => 1,
      getProfileSetting: async () => 1,
      getStatisticsDescale: async () => { reads.push('descale'); return { daysUntilNextDescale: 62 }; },
      getFilterStatus: async () => { reads.push('filter'); return { daysUntilFilterChange: 239 }; },
      getDeviceIdentification: async () => { reads.push('ident'); return { serialNumber: 'X' }; },
      getInitialOperationDate: async () => { reads.push('opdate'); return '16.11.2022'; },
      getSocVersions: async () => { reads.push('soc'); return 'v'; },
      getFirmwareVersions: async () => { reads.push('fw'); return { main: 'RS30.0' }; },
      getSystemState: async () => ({ state: { parameters: { 0: 0 } } })
    }
  };
  const store = new Map();
  const settings = new Map();
  const device = {
    _deleted: false,
    _busy: false,
    _activeOperation: null,
    _idleWaiters: [],
    _controlRequestsWaiting: 0,
    _refreshPreemptRequested: false,
    _session: session,
    _timeZone: 'Europe/Oslo',
    ensureProtocolSession: async () => session,
    getSetting: id => settings.get(id),
    setSettings: async values => { for (const [k, v] of Object.entries(values)) settings.set(k, v); },
    getStoreValue: key => store.get(key),
    setStoreValue: async (key, value) => { store.set(key, value); },
    getKeepWarmMilliseconds: () => 30000,
    getEditProfileId: () => 0,
    runProtocolOperation: MeraComfortDevice.prototype.runProtocolOperation,
    formatLocalTime: MeraComfortDevice.prototype.formatLocalTime,
    applyConfigSettings: async () => {},
    applyMaintenance: async () => {},
    applyDeviceInformation: MeraComfortDevice.prototype.applyDeviceInformation,
    noteProfileValuesRead: async () => {},
    mapConfiguredShowerState: state => state,
    storeOperationResult: async () => {},
    setConnectionState: async () => {},
    setConnectionError: async () => {},
    setAvailable: async () => {},
    closeProtocolSession: async () => { session.keepWarmUntil = undefined; },
    homey: { clearTimeout: () => {} },
    log: () => {},
    error: () => {}
  };

  // First background refresh: reads everything, caches, does not keep warm.
  await MeraComfortDevice.prototype.refreshSettingsAndMaintenance
    .call(device, { keepWarm: false });
  assert.ok(reads.includes('ident'), 'first refresh must read identification');
  assert.ok(store.has('deviceInformation'), 'a complete read must be cached');
  assert.ok(!session.keepWarmUntil, 'a background refresh must not hold the session');

  // Second refresh: information comes from the cache, no BLE reads for it.
  reads.length = 0;
  await MeraComfortDevice.prototype.refreshSettingsAndMaintenance
    .call(device, { keepWarm: false });
  assert.deepEqual(
    reads.filter(r => ['ident', 'opdate', 'soc', 'fw'].includes(r)), [],
    'cached information must not be re-read',
  );
  assert.ok(reads.includes('descale'), 'maintenance counters are still read');

  // forceInformation bypasses the cache.
  reads.length = 0;
  await MeraComfortDevice.prototype.refreshSettingsAndMaintenance
    .call(device, { forceInformation: true });
  assert.ok(reads.includes('ident'), 'forceInformation must re-read from the toilet');

  // The information labels were written once and unchanged data writes nothing.
  const before = settings.get('info_read_at');
  await MeraComfortDevice.prototype.refreshSettingsAndMaintenance
    .call(device, { keepWarm: false });
  assert.equal(settings.get('info_read_at'), before,
    'unchanged information must not rewrite the settings labels');
});

test('connection is lost after 3 failures; the breaker presses proxy buttons after 5', async () => {
  const states = [];
  const pressed = [];
  let resets = 0;
  const device = {
    _reconnectFailures: 0,
    _nextReconnectAt: 0,
    _breakerStage: 0,
    _lastBreakerActionAt: 0,
    setConnectionState: async state => states.push(state),
    setConnectionError: async () => {},
    pressProxyButton: async id => pressed.push(id),
    resetTransport: async () => { resets += 1; },
    runCircuitBreaker: MeraComfortDevice.prototype.runCircuitBreaker,
    homey: { __: key => key },
    setUnavailable: async () => {},
    log: () => {},
    error: () => {}
  };
  const fail = () => MeraComfortDevice.prototype.handleRefreshFailure
    .call(device, 'test', new Error('nope'));

  await fail(); await fail();
  assert.deepEqual(states, ['reconnecting', 'reconnecting'],
    'the first two failures are ordinary — no lost-trigger state yet');

  await fail();
  assert.equal(states[2], 'disconnected', 'the third failure means genuinely lost');
  assert.deepEqual(pressed, [], 'no breaker action before 5 failures');

  await fail(); await fail();
  assert.deepEqual(pressed, ['clear_ble_cache'],
    'failure 5: the cheap cache clear goes first');
  assert.equal(device._reconnectFailures, 0, 'the breaker resets the counter');

  // Five NEW failures escalate to a restart — but only after the cooldown.
  for (let i = 0; i < 5; i += 1) await fail();
  assert.deepEqual(pressed, ['clear_ble_cache'], 'cooldown must hold the restart back');

  device._lastBreakerActionAt = Date.now() - (31 * 60 * 1000);
  for (let i = 0; i < 5; i += 1) await fail();
  assert.deepEqual(pressed, ['clear_ble_cache', 'restart_ble_proxy'],
    'persistent failure escalates to a proxy restart');

  // Stage 3: the app-restart equivalent — a transport reset, no button press.
  device._lastBreakerActionAt = Date.now() - (31 * 60 * 1000);
  for (let i = 0; i < 5; i += 1) await fail();
  assert.equal(resets, 1, 'persistent failure ends in a full transport reset');
  assert.deepEqual(pressed, ['clear_ble_cache', 'restart_ble_proxy'],
    'the reset stage must not press proxy buttons');

  // A successful operation resets the escalation ladder.
  device._breakerStage = 0;
  device._lastBreakerActionAt = Date.now() - (31 * 60 * 1000);
  for (let i = 0; i < 5; i += 1) await fail();
  assert.equal(pressed[pressed.length - 1], 'clear_ble_cache',
    'after a recovery the breaker starts from the cheap action again');
});

// --- Regressions from the pre-certification audit --------------------------

test('an inferred capability must not drive the poll rate', () => {
  // The toilet never reports odour extraction, so the capability is the app's
  // own guess. Toggling it on sets it true with no off-timer; with
  // odour_auto_tracking disabled nothing ever clears it. While it counted as
  // "activity" that pinned the poll to the 2.5 s active interval permanently,
  // and past the keep-warm window every poll is a fresh connect and teardown -
  // during which the toilet's own remote is dead.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'drivers', 'mera_comfort', 'device.js'), 'utf8',
  );
  const block = source.match(/ACTIVE_STATUS_CAPABILITY_IDS = Object\.freeze\(\[([^\]]*)\]/);
  assert.ok(block, 'the active-poll capability list must exist');
  assert.doesNotMatch(block[1], /odour/,
    'only capabilities the toilet actually reports may raise the poll rate');
});

test('a command that may already have been carried out says so', () => {
  const messages = [];
  const device = Object.create(MeraComfortDevice.prototype);
  device.homey = { __: key => { messages.push(key); return key; } };

  // Set when the toggle byte was written but the answer never came back.
  const attempted = Object.assign(new Error('timed out'), {
    code: 'AQUACLEAN_TIMEOUT',
    aquacleanCommandAttempted: true
  });
  assert.equal(
    MeraComfortDevice.prototype.getUserErrorMessage.call(device, attempted),
    'error.command_uncertain',
    'telling the user the toilet was unreachable invites a second press, '
    + 'and a second press on a toggle undoes the first',
  );

  // A failure before the write is still an ordinary timeout.
  const notAttempted = Object.assign(new Error('timed out'), { code: 'AQUACLEAN_TIMEOUT' });
  assert.equal(
    MeraComfortDevice.prototype.getUserErrorMessage.call(device, notAttempted),
    'error.timeout',
  );
});
