'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  encodeVarint,
  decodeVarint,
  decodeFields,
  formatUuid,
  macToAddress,
  addressToMac,
  parseAdvertisementData,
  MSG,
} = require('../lib/esphome-api');

test('encodeVarint matches the protobuf wire format', () => {
  assert.deepStrictEqual([...encodeVarint(0)], [0x00]);
  assert.deepStrictEqual([...encodeVarint(1)], [0x01]);
  assert.deepStrictEqual([...encodeVarint(127)], [0x7f]);
  assert.deepStrictEqual([...encodeVarint(128)], [0x80, 0x01]);
  assert.deepStrictEqual([...encodeVarint(300)], [0xac, 0x02]);
  assert.deepStrictEqual([...encodeVarint(16384)], [0x80, 0x80, 0x01]);
});

test('encodeVarint rejects negative values', () => {
  assert.throws(() => encodeVarint(-1), RangeError);
});

test('decodeVarint round-trips every encoded value', () => {
  for (const value of [0, 1, 127, 128, 300, 16384, 6053, 4294967295]) {
    const decoded = decodeVarint(encodeVarint(value), 0);
    assert.strictEqual(decoded.value, BigInt(value), `mismatch for ${value}`);
  }
});

test('decodeVarint returns null on a truncated buffer', () => {
  // 0x80 sets the continuation bit, so the value is incomplete.
  assert.strictEqual(decodeVarint(Buffer.from([0x80]), 0), null);
});

test('decodeVarint reports the offset after the value', () => {
  const buffer = Buffer.concat([encodeVarint(300), Buffer.from([0xff])]);
  const decoded = decodeVarint(buffer, 0);
  assert.strictEqual(decoded.offset, 2);
  assert.strictEqual(buffer[decoded.offset], 0xff);
});

test('decodeFields reads varint, length-delimited and fixed32 fields', () => {
  const payload = Buffer.concat([
    Buffer.from([(1 << 3) | 0]), encodeVarint(42),          // field 1: varint
    Buffer.from([(2 << 3) | 2, 0x03]), Buffer.from('abc'),   // field 2: bytes
    Buffer.from([(3 << 3) | 5]), Buffer.from([0x00, 0x00, 0x80, 0x3f]), // field 3: float 1.0
  ]);

  const fields = decodeFields(payload);
  assert.strictEqual(fields[1], 42n);
  assert.strictEqual(fields[2].toString('utf8'), 'abc');
  assert.strictEqual(fields[3], 0x3f800000);
  assert.strictEqual(fields['3_float'], 1);
});

test('decodeFields collects repeated fields into an array', () => {
  const entry = (text) => Buffer.concat([
    Buffer.from([(4 << 3) | 2, text.length]), Buffer.from(text),
  ]);
  const fields = decodeFields(Buffer.concat([entry('aa'), entry('bb'), entry('cc')]));

  assert.ok(Array.isArray(fields[4]));
  assert.deepStrictEqual(fields[4].map((b) => b.toString('utf8')), ['aa', 'bb', 'cc']);
});

test('decodeFields keeps uint64 as BigInt so BLE addresses survive', () => {
  // 0x94A9A82D77EF exceeds what a float64 mantissa can hold exactly once
  // shifted, so the decoder must not go through Number.
  const address = 0x94a9a82d77efn;
  const payload = Buffer.concat([Buffer.from([(1 << 3) | 0]), encodeVarint(address)]);

  assert.strictEqual(decodeFields(payload)[1], address);
});

test('macToAddress and addressToMac round-trip', () => {
  const mac = '94:A9:A8:2D:77:EF';
  assert.strictEqual(macToAddress(mac), 0x94a9a82d77efn);
  assert.strictEqual(addressToMac(macToAddress(mac)), mac);
});

test('addressToMac zero-pads a low address', () => {
  assert.strictEqual(addressToMac(1n), '00:00:00:00:00:01');
});

test('formatUuid joins the two uint64 halves into 32 hex characters', () => {
  // The Geberit protocol service as reported by the proxy.
  const uuid = formatUuid([0x3334429d90f34c41n, 0xa02d5cb3a03e0000n]);
  assert.strictEqual(uuid, '3334429d90f34c41a02d5cb3a03e0000');
  assert.strictEqual(uuid.length, 32);
});

test('formatUuid pads a short low half', () => {
  assert.strictEqual(formatUuid([0n, 0x2902n]), '00000000000000000000000000002902');
});

test('parseAdvertisementData reads the complete local name', () => {
  const name = 'Geberit AC PRO';
  const buffer = Buffer.concat([
    Buffer.from([name.length + 1, 0x09]), Buffer.from(name, 'utf8'),
  ]);

  assert.strictEqual(parseAdvertisementData(buffer).localName, name);
});

test('parseAdvertisementData reads a shortened local name too', () => {
  const buffer = Buffer.concat([Buffer.from([4, 0x08]), Buffer.from('Geb', 'utf8')]);
  assert.strictEqual(parseAdvertisementData(buffer).localName, 'Geb');
});

test('parseAdvertisementData expands 16-bit service UUIDs to full form', () => {
  // AD type 0x03: complete list of 16-bit service UUIDs, little-endian.
  // The Geberit advertises 0x3ea0, which the driver matches in 128-bit form.
  const buffer = Buffer.from([0x05, 0x03, 0xa0, 0x3e, 0x0f, 0x18]);

  assert.deepStrictEqual(parseAdvertisementData(buffer).serviceUuids, [
    '00003ea000001000800000805f9b34fb',
    '0000180f00001000800000805f9b34fb',
  ]);
});

test('parseAdvertisementData reverses 128-bit service UUIDs to display order', () => {
  const uuid = Buffer.from('3334429d90f34c41a02d5cb3a03e0000', 'hex');
  const buffer = Buffer.concat([
    Buffer.from([17, 0x07]), Buffer.from(uuid).reverse(),
  ]);

  assert.deepStrictEqual(
    parseAdvertisementData(buffer).serviceUuids,
    ['3334429d90f34c41a02d5cb3a03e0000'],
  );
});

test('parseAdvertisementData survives a truncated advertisement', () => {
  // Claims 20 bytes but only 3 follow — must not throw or loop forever.
  const buffer = Buffer.from([0x14, 0x09, 0x41, 0x42]);
  assert.deepStrictEqual(parseAdvertisementData(buffer), { localName: '', serviceUuids: [] });
});

test('parseAdvertisementData ignores manufacturer data and stops on padding', () => {
  const name = 'AC';
  const buffer = Buffer.concat([
    Buffer.from([0x07, 0xff, 0x00, 0x01, 0x31, 0x34, 0x36, 0x32]), // manufacturer
    Buffer.from([name.length + 1, 0x09]), Buffer.from(name, 'utf8'),
    Buffer.from([0x00, 0x00, 0x00]),                                // padding
  ]);

  const parsed = parseAdvertisementData(buffer);
  assert.strictEqual(parsed.localName, name);
  assert.deepStrictEqual(parsed.serviceUuids, []);
});

test('message type constants match the ESPHome native API', () => {
  // Verified against ESPHome 2026.7.4 / API 1.14 on real hardware. The notify
  // pair is the one that matters most: 78 requests, 79 delivers the data.
  assert.strictEqual(MSG.HELLO_REQ, 1);
  assert.strictEqual(MSG.GATT_READ_REQ, 73);
  assert.strictEqual(MSG.GATT_WRITE_REQ, 75);
  assert.strictEqual(MSG.GATT_READ_DESCRIPTOR_REQ, 76);
  assert.strictEqual(MSG.GATT_WRITE_DESCRIPTOR_REQ, 77);
  assert.strictEqual(MSG.GATT_NOTIFY_REQ, 78);
  assert.strictEqual(MSG.GATT_NOTIFY_DATA, 79);
  assert.strictEqual(MSG.GATT_ERROR, 82);
  assert.strictEqual(MSG.GATT_WRITE_RES, 83);
  assert.strictEqual(MSG.GATT_NOTIFY_RES, 84);
});
