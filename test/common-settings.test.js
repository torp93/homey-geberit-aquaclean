'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  COMMON_SETTINGS,
  buildCommonSettingWritePayload
} = require('../lib/aquaclean-protocol');

test('common setting writes are id followed by a 16-bit little-endian value', () => {
  assert.deepEqual([...buildCommonSettingWritePayload(4, 2)], [4, 2, 0]);
  assert.deepEqual([...buildCommonSettingWritePayload(3, 2)], [3, 2, 0]);
  assert.deepEqual([...buildCommonSettingWritePayload(1, 300)], [1, 0x2c, 0x01]);
});

test('common setting writes reject values outside 16 bits', () => {
  assert.throws(() => buildCommonSettingWritePayload(4, -1), RangeError);
  assert.throws(() => buildCommonSettingWritePayload(4, 65536), RangeError);
  assert.throws(() => buildCommonSettingWritePayload(4, 2.5), RangeError);
});

test('the probed ranges are recorded on every common setting', () => {
  for (const [name, setting] of Object.entries(COMMON_SETTINGS)) {
    assert.equal(typeof setting.id, 'number', `${name} id`);
    assert.equal(setting.min, 0, `${name} min`);
    assert.ok(setting.max >= 1, `${name} max`);
  }
});

test('the light and lid ranges match what the device accepted', () => {
  // Probed live on a Mera Comfort: writing past the maximum answers 0x80.
  assert.equal(COMMON_SETTINGS.ORIENTATION_LIGHT_BRIGHTNESS.max, 4);
  assert.equal(COMMON_SETTINGS.ORIENTATION_LIGHT_COLOUR.max, 6);
  assert.equal(COMMON_SETTINGS.ORIENTATION_LIGHT_MODE.max, 2);
  assert.equal(COMMON_SETTINGS.LID_SENSOR_RANGE.max, 4);
  assert.equal(COMMON_SETTINGS.LID_AUTO_OPEN.max, 1);
  assert.equal(COMMON_SETTINGS.LID_AUTO_CLOSE.max, 1);
});

test('the setting ids match the documented common setting space', () => {
  assert.equal(COMMON_SETTINGS.ORIENTATION_LIGHT_BRIGHTNESS.id, 1);
  // Confirmed from the reference source: 2 is colour and 3 is activation,
  // which the narrative docs had the other way round.
  assert.equal(COMMON_SETTINGS.ORIENTATION_LIGHT_COLOUR.id, 2);
  assert.equal(COMMON_SETTINGS.ORIENTATION_LIGHT_MODE.id, 3);
  assert.equal(COMMON_SETTINGS.LID_SENSOR_RANGE.id, 4);
  assert.equal(COMMON_SETTINGS.LID_AUTO_OPEN.id, 6);
  assert.equal(COMMON_SETTINGS.LID_AUTO_CLOSE.id, 7);
});
