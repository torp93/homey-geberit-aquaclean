'use strict';

// Every Flow card declared in app.json must have a working handler. The flush
// action was registered against a capability id that no code could execute,
// so every run threw — this suite exists so that class of drift is caught
// before install, not on the toilet.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyMock(request, parent, isMain) {
  if (request === 'homey') return { App: class App {}, Device: class Device {} };
  return originalLoad.call(this, request, parent, isMain);
};
const MeraComfortDevice = require('../drivers/mera_comfort/device');
Module._load = originalLoad;

const appJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'),
);

// The action->capability map in app.js, restated here: if app.js changes its
// registrations this list must be updated, and the assertions below make an
// unregistered or unexecutable card fail loudly either way.
const CAPABILITY_BACKED_ACTIONS = {
  aquaclean_action_anal_shower: 'aquaclean_button_anal_shower',
  aquaclean_action_lady_shower: 'aquaclean_button_lady_shower',
  aquaclean_action_dryer: 'aquaclean_button_dryer',
  aquaclean_action_stop: 'aquaclean_button_stop',
  aquaclean_action_lid: 'aquaclean_button_lid',
  aquaclean_action_odour_extraction: 'aquaclean_button_odour_extraction',
  aquaclean_action_odour_run_on: 'aquaclean_button_odour_run_on'
};
const METHOD_BACKED_ACTIONS = {
  aquaclean_action_refresh_status: 'executeStatusRefresh',
  // The settings cards all go through the same writer the settings page uses,
  // which range-checks the value and reads it back before reporting success.
  aquaclean_action_set_profile_level: 'writeConfigSetting',
  aquaclean_action_set_profile_switch: 'writeConfigSetting',
  aquaclean_action_set_light_mode: 'writeConfigSetting',
  aquaclean_action_set_light_colour: 'writeConfigSetting',
  aquaclean_action_set_light_brightness: 'writeConfigSetting',
  aquaclean_action_set_lid_auto: 'writeConfigSetting',
  aquaclean_action_set_lid_sensor_range: 'writeConfigSetting',
  aquaclean_action_reset_filter_counter: 'executeFilterReset',
  aquaclean_action_restart_proxy: 'pressProxyButton'
};
// The deterministic cards all land in setFunctionState(), which refuses any
// function key it does not know — so the key matters as much as the card id.
const FUNCTION_BACKED_ACTIONS = {
  aquaclean_action_anal_shower_start: 'anal_shower',
  aquaclean_action_anal_shower_stop: 'anal_shower',
  aquaclean_action_lady_shower_start: 'lady_shower',
  aquaclean_action_lady_shower_stop: 'lady_shower',
  aquaclean_action_dryer_start: 'dryer',
  aquaclean_action_dryer_stop: 'dryer',
  aquaclean_action_odour_extraction_on: 'odour_extraction',
  aquaclean_action_odour_extraction_off: 'odour_extraction'
};

test('every declared Flow action has a handler that can actually run', () => {
  const declared = (appJson.flow.actions || []).map(card => card.id);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const deviceSource = fs.readFileSync(
    path.join(__dirname, '..', 'drivers', 'mera_comfort', 'device.js'), 'utf8',
  );

  for (const cardId of declared) {
    const capabilityId = CAPABILITY_BACKED_ACTIONS[cardId];
    const methodName = METHOD_BACKED_ACTIONS[cardId];
    const functionKey = FUNCTION_BACKED_ACTIONS[cardId];
    assert.ok(
      capabilityId || methodName || functionKey,
      `Flow action "${cardId}" is declared in app.json but has no registration`,
    );

    // Every card must also be registered; a card nobody wires up is dead.
    assert.ok(
      appSource.includes(`'${cardId}'`) || appSource.includes(`${cardId}:`),
      `Flow action "${cardId}" is declared in app.json but app.js never registers it`,
    );

    if (capabilityId) {
      // executeControlCapability throws for ids missing from this map —
      // exactly the flush bug.
      assert.match(
        deviceSource,
        new RegExp(`${capabilityId}:`),
        `"${cardId}" maps to "${capabilityId}" which CONTROL_CAPABILITY_COMMANDS does not know`,
      );
    }
    if (functionKey) {
      assert.equal(
        typeof MeraComfortDevice.prototype.setFunctionState, 'function',
        `"${cardId}" needs device.setFunctionState() which does not exist`,
      );
      assert.match(
        deviceSource,
        new RegExp(`\\n\\s+${functionKey}: \\{`),
        `"${cardId}" uses function key "${functionKey}" which DETERMINISTIC_FUNCTIONS does not know`,
      );
    }
    if (methodName) {
      assert.equal(
        typeof MeraComfortDevice.prototype[methodName], 'function',
        `"${cardId}" maps to device.${methodName}() which does not exist`,
      );
    }
  }
});

test('every declared Flow trigger and condition id is known to the code', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'drivers', 'mera_comfort', 'device.js'), 'utf8')
  ].join('\n');

  // Ids appear either quoted ('id') or as bare object keys (id:).
  const mentioned = id => source.includes(`'${id}'`) || source.includes(`${id}:`);

  for (const card of appJson.flow.conditions || []) {
    assert.ok(
      mentioned(card.id),
      `Condition "${card.id}" is declared in app.json but never registered`,
    );
  }
  for (const card of appJson.flow.triggers || []) {
    assert.ok(
      mentioned(card.id),
      `Trigger "${card.id}" is declared in app.json but never fired anywhere`,
    );
  }
});

// ---------------------------------------------------------------------------
// The deterministic cards exist because a toggle run twice by a Flow leaves the
// toilet in the opposite state from the one the Flow asked for. These tests
// pin the "read first, only act on a real difference" contract.

const deterministicDevice = (state, toggles) => ({
  homey: { __: key => key },
  getCapabilityValue: id => state[id],
  refreshStatus: async () => { state.refreshed = (state.refreshed || 0) + 1; },
  executeControlCapability: async id => toggles.push(id),
  log: () => {},
  error: () => {}
});

test('a start action toggles only when the function is actually off', async () => {
  const toggles = [];
  const state = { aquaclean_dryer_running: false };
  const device = deterministicDevice(state, toggles);

  await MeraComfortDevice.prototype.setFunctionState.call(device, 'dryer', true);
  assert.deepEqual(toggles, ['aquaclean_button_dryer'],
    'off -> on has to send the toggle');
  assert.equal(state.refreshed, 1,
    'the toilet reports the dryer, so its state is re-read before deciding');

  state.aquaclean_dryer_running = true;
  await MeraComfortDevice.prototype.setFunctionState.call(device, 'dryer', true);
  assert.deepEqual(toggles, ['aquaclean_button_dryer'],
    'already running: a second start must not toggle it back off');
});

test('a stop action toggles only when the function is actually on', async () => {
  const toggles = [];
  const state = { aquaclean_anal_shower_running: true };
  const device = deterministicDevice(state, toggles);

  await MeraComfortDevice.prototype.setFunctionState.call(device, 'anal_shower', false);
  assert.deepEqual(toggles, ['aquaclean_button_anal_shower']);

  state.aquaclean_anal_shower_running = false;
  await MeraComfortDevice.prototype.setFunctionState.call(device, 'anal_shower', false);
  assert.equal(toggles.length, 1, 'already stopped: nothing to send');
});

test('odour extraction is not re-read, because the toilet never reports it', async () => {
  const toggles = [];
  const state = { aquaclean_odour_extraction_running: false };
  const device = deterministicDevice(state, toggles);

  await MeraComfortDevice.prototype.setFunctionState.call(device, 'odour_extraction', true);
  assert.deepEqual(toggles, ['aquaclean_button_odour_extraction']);
  assert.equal(state.refreshed, undefined,
    'a refresh would only re-read the app\'s own optimistic value');
});

test('an unknown function key is refused rather than toggling something else', async () => {
  const device = deterministicDevice({}, []);
  await assert.rejects(
    () => MeraComfortDevice.prototype.setFunctionState.call(device, 'flush', true),
  );
});

test('every deprecated card still has a working handler', () => {
  const deprecated = (appJson.flow.actions || []).filter(card => card.deprecated);
  assert.ok(deprecated.length > 0, 'the old toggle cards must survive for existing Flows');
  // Deprecation hides a card from the Add Card list; it does not unregister it.
  // A deprecated card with no handler is worse than a removed one, because the
  // Flow still looks valid and fails only when it runs. Both backings count:
  // the original toggles are capability-backed, the retired deterministic
  // odour actions are function-backed.
  for (const card of deprecated) {
    assert.ok(
      CAPABILITY_BACKED_ACTIONS[card.id] || FUNCTION_BACKED_ACTIONS[card.id],
      `deprecated card "${card.id}" lost its handler — existing Flows would break`,
    );
  }
});

// ---------------------------------------------------------------------------
// CHARACTERISATION: the odour ON/OFF cards decide from occupancy, not the fan.
//
// These tests assert what the code does TODAY, not what it should do. The
// toilet never reports odour extraction and the only command available is a
// toggle, so the deterministic contract the two cards advertise cannot be
// honoured. If either assertion below starts failing, the semantics changed
// deliberately and the card hints must be revisited with it.

test('KNOWN DEFECT: sitting down makes "turn odour extraction on" a no-op', async () => {
  const toggles = [];
  const state = { aquaclean_odour_extraction_running: null };
  const device = {
    homey: { __: key => key },
    getCapabilityValue: id => state[id],
    setStatusCapabilityValue: async (id, value) => { state[id] = value; },
    executeControlCapability: async id => toggles.push(id),
    hasCapability: () => true,
    isAutomaticOdourTrackingEnabled: () => true,
    clearOdourRunOnTimer: () => {},
    scheduleOdourExtractionOff: async () => {},
    getOdourRunOnMilliseconds: () => 60000,
    refreshStatus: async () => {},
    log: () => {},
    error: () => {}
  };

  // Nobody has touched odour extraction. Someone simply sits down.
  await MeraComfortDevice.prototype.applyAutomaticOdourState.call(device, true, false);
  assert.equal(state.aquaclean_odour_extraction_running, true,
    'occupancy alone flips the capability, with no evidence about the fan');

  // A Flow now asks for the fan. It is refused as "already on".
  await MeraComfortDevice.prototype.setFunctionState.call(device, 'odour_extraction', true);
  assert.deepEqual(toggles, [],
    'the fan may well be off — the toilet ships with profile_odour_extraction '
    + 'disabled — yet the action sends nothing because someone is seated');
});

test('KNOWN DEFECT: "turn odour extraction on" sends a toggle that can stop a running fan', async () => {
  const toggles = [];
  // Run-on expired, nobody seated, so the app believes extraction is off.
  // The fan can still be running: started at the toilet's own panel, which the
  // app has no way to observe.
  const state = { aquaclean_odour_extraction_running: false };
  const device = {
    homey: { __: key => key },
    getCapabilityValue: id => state[id],
    executeControlCapability: async id => toggles.push(id),
    refreshStatus: async () => { throw new Error('never called: reported === false'); },
    log: () => {},
    error: () => {}
  };

  await MeraComfortDevice.prototype.setFunctionState.call(device, 'odour_extraction', true);
  assert.deepEqual(toggles, ['aquaclean_button_odour_extraction'],
    'the only command available is TOGGLE_ODOUR_EXTRACTION (code 12) — sent '
    + 'against a belief, it turns a running fan off');
});

// ---------------------------------------------------------------------------
// The odour Flow cards, after the product decision of the certification audit.
//
// WHY: the AquaClean protocol exposes exactly one odour operation — command 12,
// TOGGLE_ODOUR_EXTRACTION — and reports no fan state back. decodeSystemParameters
// returns odourExtractionIsRunning: null because there is no such parameter, not
// because a read failed. A card promising "turn odour extraction on" therefore
// cannot keep its promise: asked to turn the fan on while the app's inferred
// value happens to disagree with reality, the only command it can send is the
// one that turns a running fan off.
//
// So the two deterministic cards are hidden from new Flows and the honest
// toggle is offered instead. Nothing is removed: every Flow built on the old
// cards keeps loading and running exactly as before.

const odourCard = id => (appJson.flow.actions || []).find(card => card.id === id);

test('the deterministic odour actions are retired but still present', () => {
  for (const id of [
    'aquaclean_action_odour_extraction_on',
    'aquaclean_action_odour_extraction_off'
  ]) {
    const card = odourCard(id);
    assert.ok(card, `"${id}" must not be removed — existing Flows reference it`);
    assert.equal(card.deprecated, true,
      `"${id}" promises determinism the toggle-only protocol cannot deliver, `
      + 'so it must not be offered for new Flows');
    assert.ok(FUNCTION_BACKED_ACTIONS[id],
      `"${id}" must keep its handler so existing Flows still execute`);
  }
});

test('the truthful toggle card is offered for new Flows', () => {
  const card = odourCard('aquaclean_action_odour_extraction');
  assert.ok(card, 'the toggle card must exist');
  assert.ok(!card.deprecated,
    'this is the operation the protocol actually has, so it must be available');
  assert.equal(CAPABILITY_BACKED_ACTIONS['aquaclean_action_odour_extraction'],
    'aquaclean_button_odour_extraction');
});

test('the toggle card sends exactly one toggle and reads no fan state', () => {
  const { AQUACLEAN_COMMANDS } = require('../lib/aquaclean-protocol');
  const deviceSource = fs.readFileSync(
    path.join(__dirname, '..', 'drivers', 'mera_comfort', 'device.js'), 'utf8',
  );

  assert.equal(AQUACLEAN_COMMANDS.TOGGLE_ODOUR_EXTRACTION, 12);
  assert.match(
    deviceSource,
    /aquaclean_button_odour_extraction: \{\s*\n\s*code: AQUACLEAN_COMMANDS\.TOGGLE_ODOUR_EXTRACTION/,
    'the toggle card must stay bound to command 12',
  );

  // executeControlCapability looks the command up and sends it. If it ever
  // starts consulting a capability value, the card has quietly become
  // deterministic again against a state nobody can verify.
  const body = deviceSource.slice(
    deviceSource.indexOf('async executeControlCapability('),
    deviceSource.indexOf('async setFunctionState('),
  );
  assert.doesNotMatch(body, /getCapabilityValue/,
    'the toggle must not pretend to know whether the fan is running');
});

test('the toilet reports no odour state to decide from', () => {
  const { decodeSystemParameters, SYSTEM_PARAMETER_IDS } = require('../lib/aquaclean-protocol');
  const ids = Array.from(SYSTEM_PARAMETER_IDS);
  const data = Buffer.alloc(1 + (ids.length * 5));
  ids.forEach((id, index) => { data[1 + (index * 5)] = id; });

  const decoded = decodeSystemParameters(data, ids);
  assert.equal(decoded.odourExtractionIsRunning, null,
    'this is the reason deterministic on/off cannot be honoured: there is no '
    + 'fan parameter to read, so any on/off decision rests on a guess');
});
