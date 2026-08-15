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
  aquaclean_action_flush: 'executeFlush'
};

test('every declared Flow action has a handler that can actually run', () => {
  const declared = (appJson.flow.actions || []).map(card => card.id);

  for (const cardId of declared) {
    const capabilityId = CAPABILITY_BACKED_ACTIONS[cardId];
    const methodName = METHOD_BACKED_ACTIONS[cardId];
    assert.ok(
      capabilityId || methodName,
      `Flow action "${cardId}" is declared in app.json but has no registration`,
    );

    if (capabilityId) {
      // executeControlCapability throws for ids missing from this map —
      // exactly the flush bug.
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'drivers', 'mera_comfort', 'device.js'), 'utf8',
      );
      assert.match(
        source,
        new RegExp(`${capabilityId}:`),
        `"${cardId}" maps to "${capabilityId}" which CONTROL_CAPABILITY_COMMANDS does not know`,
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
