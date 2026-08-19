'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AQUACLEAN_COMMANDS,
  AquaCleanProtocol,
  MESSAGE_ID_RESPONSE,
  SYSTEM_PARAMETER_IDS,
  buildControlFrame,
  buildCrcMessage,
  buildLegacyFrames,
  buildRequestMessage,
  crc16,
  decodeSystemParameters,
  parseCrcMessage
} = require('../lib/aquaclean-protocol');

const NOTIFY_UUIDS = ['a5', 'a6', 'a7', 'a8'];

const buildResponseFrames = ({ context, procedure, result, status = 0 }) => {
  const body = Buffer.concat([
    Buffer.from([status, 0x01, context, procedure, result.length]),
    result
  ]);
  return buildLegacyFrames(buildCrcMessage(MESSAGE_ID_RESPONSE, 0x00, body));
};

const makeSystemParameterResult = values => {
  const result = Buffer.alloc(1 + (values.length * 5));
  result[0] = values.length;
  values.forEach((value, index) => {
    result[1 + (index * 5)] = index;
    result.writeUInt32LE(value, 2 + (index * 5));
  });
  return result;
};

class MockAquaClean {
  constructor() {
    this.protocol = null;
    this.request = null;
    this.receivedProcedures = [];
    this.responseAcknowledgements = [];
  }

  async writePrimary(frame) {
    if (((frame[0] >> 5) & 0x07) === 3) {
      this.responseAcknowledgements.push(Buffer.from(frame));
      return;
    }
    await this.receiveRequestFrame(frame);
  }

  async writeContinuation(frame) {
    await this.receiveRequestFrame(frame);
  }

  async receiveRequestFrame(frame) {
    const isFirst = (frame[0] & 0x01) !== 0;
    const index = (frame[0] >> 1) & 0x03;

    if (isFirst) {
      this.request = {
        expected: index + 1,
        chunks: new Map([[0, Buffer.from(frame.subarray(1))]]),
        bitmap: Buffer.alloc(8, 0)
      };
      this.request.bitmap[0] = 0x01;
    } else {
      assert.ok(this.request, 'continuation must follow a first request frame');
      this.request.chunks.set(index, Buffer.from(frame.subarray(1)));
      this.request.bitmap[0] |= 1 << index;
    }

    await this.protocol.queueNotification('a5', buildControlFrame(this.request.bitmap));
    if (this.request.chunks.size !== this.request.expected) return;

    const chunks = [];
    for (let chunkIndex = 0; chunkIndex < this.request.expected; chunkIndex += 1) {
      chunks.push(this.request.chunks.get(chunkIndex));
    }
    const request = parseCrcMessage(Buffer.concat(chunks));
    const [node, context, procedure, argLength] = request.body;
    assert.equal(node, 0x01);
    const args = request.body.subarray(4, 4 + argLength);
    this.receivedProcedures.push({ context, procedure, args: Buffer.from(args) });

    let result;
    if ([0x11, 0x13].includes(procedure)) {
      const count = args[0];
      result = Buffer.alloc(1 + (count * 13), 0);
      result[0] = count;
      for (let resultIndex = 0; resultIndex < count; resultIndex += 1) {
        result[1 + (resultIndex * 13)] = args[1 + resultIndex];
      }
    } else if (procedure === 0x0d) {
      result = makeSystemParameterResult([1, 1, 0, 1, 2, 14, 0, 99]);
    } else {
      result = Buffer.alloc(0);
    }

    const responseFrames = buildResponseFrames({ context, procedure, result });
    for (let frameIndex = 0; frameIndex < responseFrames.length; frameIndex += 1) {
      await this.protocol.queueNotification(
        NOTIFY_UUIDS[frameIndex % NOTIFY_UUIDS.length],
        responseFrames[frameIndex],
      );
    }
    this.request = null;
  }
}

test('CRC and request framing match the confirmed Mera wire format', () => {
  const message = buildRequestMessage({
    context: 0x01,
    procedure: 0x11,
    args: Buffer.from([0x04, 0x01, 0x03, 0x04, 0x05])
  });
  assert.equal(message.toString('hex'), '04ff00098640010111050401030405');
  assert.equal(crc16(message.subarray(6)), 0x8640);

  const frames = buildLegacyFrames(message);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].toString('hex'), '1104ff0009864001011105040103040500000000');
});

test('system-parameter request uses FIRST + CONS framing', () => {
  const args = Buffer.from([8, 0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0]);
  const frames = buildLegacyFrames(buildRequestMessage({
    context: 0x01,
    procedure: 0x0d,
    args
  }));

  assert.equal(frames.length, 2);
  assert.equal(frames[0].toString('hex'), '1304ff0011a14901010d0d080001020304050607');
  assert.equal(frames[1].toString('hex'), '1200000000000000000000000000000000000000');
});

test('full session unlock and safe state poll complete over fragmented responses', async () => {
  const mock = new MockAquaClean();
  const protocol = new AquaCleanProtocol({
    writePrimary: frame => mock.writePrimary(frame),
    writeContinuation: frame => mock.writeContinuation(frame),
    responseTimeoutMs: 1000,
    ackTimeoutMs: 1000
  });
  mock.protocol = protocol;

  const initialization = await protocol.initializeSession();
  const { state } = await protocol.getSystemState(SYSTEM_PARAMETER_IDS);

  assert.equal(initialization.length, 8);
  assert.deepEqual(
    mock.receivedProcedures.map(item => item.procedure),
    [0x11, 0x11, 0x11, 0x11, 0x13, 0x13, 0x13, 0x13, 0x0d],
  );
  assert.equal(mock.receivedProcedures.at(-1).args.length, 13);
  assert.equal(mock.receivedProcedures.at(-1).args[0], 8);

  assert.equal(state.userIsSitting, true);
  assert.equal(state.analShowerIsRunning, true);
  assert.equal(state.ladyShowerIsRunning, false);
  // Parameter 3 is the dryer — confirmed live on a Mera Comfort (RS30) where it
  // flipped 0 -> 1 on command 2 and back on Stop. It used to be reported as null.
  assert.equal(state.dryerIsRunning, true);
  assert.equal(state.descalingState, 2);
  assert.equal(state.descalingDurationMinutes, 14);
  assert.equal(state.lastErrorCode, 0);
  assert.equal(state.parameters[7], 99);
  assert.equal(state.odourExtractionIsRunning, null);

  assert.ok(protocol.frames.length > 0);
  assert.equal(protocol.messages.length, 9);
  assert.equal(mock.responseAcknowledgements.length, 9);
});

test('decodeSystemParameters reports the dryer from parameter 3', () => {
  // Five bytes per parameter: one tag byte then a uint32 little-endian value.
  const encode = (ids, values) => {
    const data = Buffer.alloc(1 + (ids.length * 5));
    ids.forEach((id, index) => {
      const offset = 1 + (index * 5);
      data[offset] = id;
      data.writeUInt32LE(values[index], offset + 1);
    });
    return data;
  };

  const ids = [0, 1, 2, 3];
  const idle = decodeSystemParameters(encode(ids, [1, 0, 0, 0]), ids);
  assert.equal(idle.dryerIsRunning, false);

  const drying = decodeSystemParameters(encode(ids, [1, 0, 0, 1]), ids);
  assert.equal(drying.dryerIsRunning, true);

  // Absent from the requested list means unknown, not "off".
  const withoutDryer = decodeSystemParameters(encode([0, 1], [1, 0]), [0, 1]);
  assert.equal(withoutDryer.dryerIsRunning, null);
});

test('control command uses SetCommand procedure with the confirmed one-byte code', async () => {
  const mock = new MockAquaClean();
  const protocol = new AquaCleanProtocol({
    writePrimary: frame => mock.writePrimary(frame),
    writeContinuation: frame => mock.writeContinuation(frame),
    responseTimeoutMs: 1000,
    ackTimeoutMs: 1000
  });
  mock.protocol = protocol;

  await protocol.initializeSession();
  const response = await protocol.executeCommand(AQUACLEAN_COMMANDS.TOGGLE_LID);

  const request = mock.receivedProcedures.at(-1);
  assert.equal(request.context, 0x01);
  assert.equal(request.procedure, 0x09);
  assert.deepEqual(request.args, Buffer.from([10]));
  assert.equal(response.status, 0);
  assert.equal(response.result.length, 0);
});

test('control command rejects values outside the one-byte command range', async () => {
  const protocol = new AquaCleanProtocol({
    writePrimary: async () => {},
    writeContinuation: async () => {}
  });

  await assert.rejects(() => protocol.executeCommand(-1), RangeError);
  await assert.rejects(() => protocol.executeCommand(256), RangeError);
  await assert.rejects(() => protocol.executeCommand(1.5), RangeError);
});

test('a stalled BLE write times out so polling can reconnect', async () => {
  const protocol = new AquaCleanProtocol({
    writePrimary: () => new Promise(() => {}),
    writeContinuation: async () => {},
    responseTimeoutMs: 1000,
    writeTimeoutMs: 20
  });

  await assert.rejects(
    () => protocol.getSystemState([0, 1, 2, 3]),
    error => error.code === 'AQUACLEAN_TIMEOUT'
      && /write timed out/.test(error.message),
  );
});

test('system-state decoding is positional because echoed IDs are unreliable', () => {
  const result = Buffer.alloc(1 + (4 * 5));
  result[0] = 4;
  result[1] = 0;
  result.writeUInt32LE(7, 2);
  result[6] = 0;
  result.writeUInt32LE(8, 7);
  result[11] = 0;
  result.writeUInt32LE(9, 12);
  result[16] = 0;
  result.writeUInt32LE(0, 17);

  const state = decodeSystemParameters(result, [0, 1, 2, 3]);
  assert.deepEqual(state.parameters, { 0: 7, 1: 8, 2: 9, 3: 0 });
  assert.equal(state.userIsSitting, true);
  assert.equal(state.ladyShowerIsRunning, true);
  assert.equal(state.analShowerIsRunning, true);
});

test('single-parameter user poll leaves unrequested states unknown', () => {
  const result = Buffer.alloc(6);
  result[0] = 1;
  result[1] = 0;
  result.writeUInt32LE(1, 2);

  const state = decodeSystemParameters(result, [0]);
  assert.equal(state.userIsSitting, true);
  assert.equal(state.analShowerIsRunning, null);
  assert.equal(state.ladyShowerIsRunning, null);
  assert.equal(state.odourExtractionIsRunning, null);
});

test('duplicate and late continuation notifications are idempotent', async () => {
  const writes = [];
  const protocol = new AquaCleanProtocol({
    writePrimary: async frame => writes.push(Buffer.from(frame)),
    writeContinuation: async () => {},
    responseTimeoutMs: 1000
  });
  const responsePromise = protocol.request({
    context: 0x01,
    procedure: 0x11,
    args: Buffer.from([0x04, 0x01, 0x03, 0x04, 0x05])
  });
  const frames = buildResponseFrames({
    context: 0x01,
    procedure: 0x11,
    result: Buffer.alloc(53, 0x5a)
  });

  for (let index = 0; index < frames.length; index += 1) {
    await protocol.queueNotification(NOTIFY_UUIDS[index], frames[index]);
    await protocol.queueNotification(NOTIFY_UUIDS[index], frames[index]);
  }

  const response = await responsePromise;
  assert.equal(response.procedure, 0x11);
  assert.equal(response.result.length, 53);
  assert.equal(writes.length, 2);
});

// Parameter 7 was requested and then dropped by the decoder, so the app could
// not tell that a calibration had left the toilet in service mode.
test('the decoder exposes the service state', () => {
  const ids = [0, 7];
  // One header byte, then five bytes per parameter: a tag and a uint32.
  const data = Buffer.alloc(1 + (ids.length * 5));
  data.writeUInt32LE(0, 2);
  data.writeUInt32LE(3, 7);

  const decoded = decodeSystemParameters(data, ids);
  assert.equal(decoded.serviceState, 3, 'service state must survive decoding');
  assert.equal(decoded.userIsSitting, false);
});

// The failure this guards against cannot be undone from software: the toilet
// answers the oversized request, then refuses GetFilterStatus until its mains
// power is cycled. jens62/geberit-aquaclean#44 hit it on this same firmware.
test('a system parameter request may not cross the BLE frame boundary', () => {
  const {
    buildSystemParameterPayload,
    MAX_SYSTEM_PARAMETERS_PER_REQUEST,
    SYSTEM_PARAMETER_IDS
  } = require('../lib/aquaclean-protocol');

  assert.equal(MAX_SYSTEM_PARAMETERS_PER_REQUEST, 8);
  assert.ok(SYSTEM_PARAMETER_IDS.length <= MAX_SYSTEM_PARAMETERS_PER_REQUEST,
    'the full read this app performs must stay inside the limit');

  // Eight is the largest request that stays in the first frame.
  const payload = buildSystemParameterPayload([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(payload[0], 8);
  assert.equal(payload.length, 13);

  // The exact request from the upstream report must be refused.
  assert.throws(
    () => buildSystemParameterPayload([0, 1, 2, 3, 4, 5, 6, 7, 12, 13]),
    /power-cycled/,
  );
  assert.throws(() => buildSystemParameterPayload([0, 1, 2, 3, 4, 5, 6, 7, 8]), RangeError);

  // Indices above 7 are still readable -- one separate request at a time.
  assert.equal(buildSystemParameterPayload([12, 13])[0], 2);
});
