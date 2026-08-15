'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_PROFILE_ID,
  FILTER_STATUS_PAYLOAD,
  PROFILE_SETTINGS,
  buildProfileSettingPayload,
  buildProfileSettingWritePayload,
  decodeFilterStatus,
  decodeStatisticsDescale
} = require('../lib/aquaclean-protocol');

test('profile setting reads put the profile id first, then the setting id', () => {
  // The leading byte is the profile, not an argument count. Reading with the
  // wrong profile silently returns a different profile's value.
  assert.deepEqual([...buildProfileSettingPayload(1, 2)], [1, 2]);
  assert.deepEqual([...buildProfileSettingPayload(3, 13)], [3, 13]);
});

test('profile setting writes append a 16-bit little-endian value', () => {
  assert.deepEqual([...buildProfileSettingWritePayload(1, 2, 4)], [1, 2, 4, 0]);
  assert.deepEqual([...buildProfileSettingWritePayload(1, 6, 300)], [1, 6, 0x2c, 0x01]);
});

test('profile setting writes reject values outside 16 bits', () => {
  assert.throws(() => buildProfileSettingWritePayload(1, 2, -1), RangeError);
  assert.throws(() => buildProfileSettingWritePayload(1, 2, 65536), RangeError);
  assert.throws(() => buildProfileSettingWritePayload(1, 2, 1.5), RangeError);
});

test('the probed ranges are recorded on every profile setting', () => {
  for (const [name, setting] of Object.entries(PROFILE_SETTINGS)) {
    assert.equal(typeof setting.id, 'number', `${name} id`);
    assert.equal(setting.min, 0, `${name} min`);
    assert.ok(setting.max >= 1 && setting.max <= 5, `${name} max out of range`);
  }
  // Confirmed live on a Mera Comfort: five steps for pressure and position,
  // six for the temperatures, two for the on/off settings.
  assert.equal(PROFILE_SETTINGS.ANAL_SHOWER_PRESSURE.max, 4);
  assert.equal(PROFILE_SETTINGS.WATER_TEMPERATURE.max, 5);
  assert.equal(PROFILE_SETTINGS.WC_SEAT_HEAT.max, 5);
  assert.equal(PROFILE_SETTINGS.OSCILLATOR_STATE.max, 1);
  assert.equal(DEFAULT_PROFILE_ID, 1);
});

test('the filter status request is the eight-id list the device answers', () => {
  // Twelve ids — what the iOS app sends — make the device time out.
  assert.equal(FILTER_STATUS_PAYLOAD.length, 13);
  assert.equal(FILTER_STATUS_PAYLOAD[0], 8);
  assert.deepEqual([...FILTER_STATUS_PAYLOAD.subarray(1, 9)], [0, 1, 2, 3, 7, 8, 9, 10]);
  assert.deepEqual([...FILTER_STATUS_PAYLOAD.subarray(9)], [0, 0, 0, 0]);
});

test('descale statistics decode from a real device response', () => {
  // Captured from a Mera Comfort on 2026-08-09.
  const raw = Buffer.from('013e000e0001e08eb969000000000600', 'hex');
  const stats = decodeStatisticsDescale(raw);

  assert.equal(stats.unpostedShowerCycles, 1);
  assert.equal(stats.daysUntilNextDescale, 62);
  assert.equal(stats.daysUntilShowerRestricted, 14);
  assert.equal(stats.showerCyclesUntilConfirmation, 1);
  assert.equal(stats.numberOfDescaleCycles, 6);
  assert.equal(typeof stats.lastDescaleAt, 'number');
  // The device had never been prompted, which it reports as a zero timestamp.
  assert.equal(stats.lastDescalePromptAt, null);
});

test('descale statistics reject a short response', () => {
  assert.throws(() => decodeStatisticsDescale(Buffer.alloc(8)), /16 bytes/);
});

test('filter status decodes the five-byte records', () => {
  const record = (id, value) => {
    const b = Buffer.alloc(5);
    b[0] = id;
    b.writeUInt32LE(value, 1);
    return b;
  };
  const raw = Buffer.concat([
    Buffer.from([4]),
    record(7, 239), record(8, 1773765549), record(9, 0), record(10, 3)
  ]);

  const status = decodeFilterStatus(raw);
  assert.equal(status.daysUntilFilterChange, 239);
  assert.equal(status.lastFilterChangeAt, 1773765549);
  assert.equal(status.filterChangeCount, 3);
  // Nothing scheduled is reported as zero, which is not a timestamp.
  assert.equal(status.nextFilterChangeAt, null);
});

test('filter status survives an empty or truncated response', () => {
  assert.deepEqual(decodeFilterStatus(Buffer.alloc(0)).records, {});
  assert.equal(decodeFilterStatus(Buffer.alloc(0)).daysUntilFilterChange, null);

  // Claims three records but carries one and a half.
  const truncated = Buffer.from([3, 7, 0xef, 0x00, 0x00, 0x00, 8, 0x01]);
  assert.equal(decodeFilterStatus(truncated).daysUntilFilterChange, 239);
});

test('filter status stops at the declared count', () => {
  const raw = Buffer.from([1, 7, 0xef, 0x00, 0x00, 0x00, 10, 0x03, 0x00, 0x00, 0x00]);
  const status = decodeFilterStatus(raw);
  assert.deepEqual(Object.keys(status.records), ['7']);
  assert.equal(status.filterChangeCount, null);
});
