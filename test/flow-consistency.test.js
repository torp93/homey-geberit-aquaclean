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
  aquaclean_action_refresh_status: 'executeStatusRefresh'
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

test('the deprecated toggle cards still map to real capabilities', () => {
  const deprecated = (appJson.flow.actions || []).filter(card => card.deprecated);
  assert.ok(deprecated.length > 0, 'the old toggle cards must survive for existing Flows');
  for (const card of deprecated) {
    assert.ok(
      CAPABILITY_BACKED_ACTIONS[card.id],
      `deprecated card "${card.id}" lost its handler — existing Flows would break`,
    );
  }
});
