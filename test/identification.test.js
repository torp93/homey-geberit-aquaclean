'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEVICE_IDENTIFICATION_FIELDS,
  FIRMWARE_COMPONENT_IDS,
  MAIN_FIRMWARE_COMPONENT_ID,
  buildFirmwareVersionPayload,
  decodeDeviceIdentification,
  decodeFirmwareVersions,
  decodeSocVersions
} = require('../lib/aquaclean-protocol');

const fixed = (text, length) => {
  const field = Buffer.alloc(length);
  field.write(text, 'utf8');
  return field;
};

test('device identification splits four fixed-width fields', () => {
  const raw = Buffer.concat([
    fixed('146.21x.xx.1', 12),
    fixed('HB2210EU286536', 20),
    fixed('21.10.2022', 10),
    fixed('AquaClean Mera Comfort', 40)
  ]);

  assert.deepEqual(decodeDeviceIdentification(raw), {
    sapNumber: '146.21x.xx.1',
    serialNumber: 'HB2210EU286536',
    productionDate: '21.10.2022',
    description: 'AquaClean Mera Comfort'
  });
});

test('the identification field widths add up to the documented 82 bytes', () => {
  const total = DEVICE_IDENTIFICATION_FIELDS.reduce((sum, [, length]) => sum + length, 0);
  assert.equal(total, 82);
});

test('device identification tolerates a short response', () => {
  const identification = decodeDeviceIdentification(fixed('146.21x.xx.1', 12));
  assert.equal(identification.sapNumber, '146.21x.xx.1');
  assert.equal(identification.serialNumber, '');
  assert.equal(identification.description, '');
});

test('SOC versions decode from the four-byte response', () => {
  // Captured live: 31 30 12 00.
  assert.equal(decodeSocVersions(Buffer.from([0x31, 0x30, 0x12, 0x00])), 'RS10.0 TS18');
});

test('SOC versions return empty on a too-short response', () => {
  assert.equal(decodeSocVersions(Buffer.alloc(2)), '');
});

test('the firmware request is a count byte followed by component ids', () => {
  const payload = buildFirmwareVersionPayload();
  assert.equal(payload[0], FIRMWARE_COMPONENT_IDS.length);
  assert.deepEqual([...payload.subarray(1)], [...FIRMWARE_COMPONENT_IDS]);
  // Thirteen bytes exceeds a single 20-byte frame, so this goes out as
  // FIRST + CONS frames.
  assert.equal(payload.length, 13);
});

test('firmware versions decode the five-byte component records', () => {
  // Captured live from a Mera Comfort on 2026-08-13.
  const raw = Buffer.from(
    '0c013330ce000330381f0004303825000531313c00063038300007313129000830391f00'
    + '0930371300' + '0a30371200' + '0b30381700' + '0c30371200' + '0e30371b00',
    'hex',
  );
  const firmware = decodeFirmwareVersions(raw);

  assert.equal(firmware.main, 'RS30.0 TS206');
  assert.equal(firmware.components[MAIN_FIRMWARE_COMPONENT_ID], 'RS30.0 TS206');
  assert.equal(firmware.components[3], 'RS08.0 TS31');
  assert.equal(firmware.components[14], 'RS07.0 TS27');
  assert.equal(Object.keys(firmware.components).length, 12);
});

test('firmware versions report an empty main when component 1 is absent', () => {
  const raw = Buffer.from([1, 3, 0x30, 0x38, 0x1f, 0x00]);
  const firmware = decodeFirmwareVersions(raw);
  assert.equal(firmware.main, '');
  assert.equal(firmware.components[3], 'RS08.0 TS31');
});

test('firmware versions survive an empty response', () => {
  assert.deepEqual(decodeFirmwareVersions(Buffer.alloc(0)), { main: '', components: {} });
});
