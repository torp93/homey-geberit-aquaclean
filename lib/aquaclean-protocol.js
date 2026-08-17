'use strict';

const BLE_FRAME_LENGTH = 20;
const LEGACY_PAYLOAD_LENGTH = 19;
const RESPONSE_TIMEOUT_MS = 8000;
const ACK_TIMEOUT_MS = 3000;
const WRITE_TIMEOUT_MS = 5000;
const MAX_CAPTURED_FRAMES = 500;
const MAX_CAPTURED_MESSAGES = 100;

const FRAME_TYPE_SINGLE = 0;
const FRAME_TYPE_FIRST = 1;
const FRAME_TYPE_CONS = 2;
const FRAME_TYPE_CONTROL = 3;
const FRAME_TYPE_INFO = 4;

const MESSAGE_ID_REQUEST = 4;
const MESSAGE_ID_RESPONSE = 5;
const MESSAGE_ID_NOTIFICATION = 6;

const PRE_SUBSCRIPTION_PAYLOADS = [
  Buffer.from([0x04, 0x01, 0x03, 0x04, 0x05]),
  Buffer.from([0x04, 0x06, 0x07, 0x08, 0x09]),
  Buffer.from([0x04, 0x0a, 0x0b, 0x0c, 0x0e]),
  Buffer.from([0x01, 0x0f, 0x00, 0x00, 0x00])
];

const SUBSCRIPTION_PAYLOADS = [
  Buffer.from([0x04, 0x01, 0x03, 0x04, 0x05]),
  Buffer.from([0x04, 0x06, 0x07, 0x08, 0x09]),
  Buffer.from([0x04, 0x0a, 0x0b, 0x0c, 0x0e]),
  Buffer.from([0x02, 0x0f, 0x0d, 0x00, 0x00])
];

const SYSTEM_PARAMETER_IDS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);

const AQUACLEAN_COMMANDS = Object.freeze({
  TOGGLE_ANAL_SHOWER: 0,
  TOGGLE_LADY_SHOWER: 1,
  TOGGLE_DRYER: 2,
  STOP: 3,
  TOGGLE_LID: 10,
  TOGGLE_ODOUR_EXTRACTION: 12,
  ODOUR_EXTRACTION_RUN_ON: 13,
  // The lid position calibration that sits behind the service menu on the
  // toilet itself: START opens the routine, INCREMENT/DECREMENT nudge the
  // position while you watch the lid, SAVE commits the offset. Names come from
  // the reference implementation's Commands enum; the app exposes them only
  // through the repair flow, never as Flow cards, because a saved offset is
  // not trivially undone.
  START_LID_CALIBRATION: 33,
  LID_OFFSET_SAVE: 34,
  LID_OFFSET_INCREMENT: 35,
  LID_OFFSET_DECREMENT: 36,
  // Sent twice to a Mera Comfort — empty seat and occupied seat — and
  // acknowledged with status 0 both times, with no audible or visible effect
  // and no change in any of the eight system parameters. That is consistent
  // with the name rather than against it: the Mera has no bowl flush of its
  // own to trigger, since that is the wall plate and the wall plate is not on
  // this BLE service.
  TRIGGER_FLUSH: 37,
  // Sets the ceramic filter counter back to 365 days, stamps the reset date
  // and increments the reset count — all in one atomic device-side step.
  RESET_FILTER_COUNTER: 47
});

const makeTimeoutError = (kind, timeoutMs) => {
  const error = new Error(`AquaClean ${kind} timed out after ${timeoutMs} ms.`);
  error.code = 'AQUACLEAN_TIMEOUT';
  return error;
};

const crc16 = data => {
  let crc = 0x1234;

  for (const byte of data) {
    crc = (((crc << 8) & 0xff00) | ((crc >> 8) & 0x00ff)) ^ byte;
    crc = (crc ^ ((crc & 0xff) >> 4)) & 0xffff;
    crc = (crc ^ ((crc << 8) << 4)) & 0xffff;
    crc = (crc ^ (((crc & 0xff) << 4) << 1)) & 0xffff;
  }

  return crc;
};

const buildCrcMessage = (messageId, segments, body) => {
  const message = Buffer.alloc(6 + body.length);
  const checksum = crc16(body);

  message[0] = messageId;
  message[1] = segments;
  message.writeUInt16BE(body.length, 2);
  message.writeUInt16BE(checksum, 4);
  body.copy(message, 6);
  return message;
};

const buildRequestMessage = ({ node = 0x01, context, procedure, args = Buffer.alloc(0) }) => {
  const payload = Buffer.from(args);
  if (payload.length > 255) {
    throw new RangeError('AquaClean request arguments cannot exceed 255 bytes.');
  }

  const body = Buffer.alloc(4 + payload.length);
  body[0] = node;
  body[1] = context;
  body[2] = procedure;
  body[3] = payload.length;
  payload.copy(body, 4);
  return buildCrcMessage(MESSAGE_ID_REQUEST, 0xff, body);
};

const buildLegacyFrames = message => {
  const frameCount = Math.ceil(message.length / LEGACY_PAYLOAD_LENGTH);
  if (frameCount < 1 || frameCount > 4) {
    throw new RangeError('Legacy AquaClean requests must fit in one to four BLE frames.');
  }

  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const frame = Buffer.alloc(BLE_FRAME_LENGTH);
    frame[0] = index === 0
      ? 0x11 | ((frameCount - 1) << 1)
      : 0x10 | (index << 1);
    message.copy(
      frame,
      1,
      index * LEGACY_PAYLOAD_LENGTH,
      (index + 1) * LEGACY_PAYLOAD_LENGTH,
    );
    frames.push(frame);
  }

  return frames;
};

const buildControlFrame = bitmap => {
  const frame = Buffer.alloc(BLE_FRAME_LENGTH);
  frame[0] = 0x70;
  frame[2] = 8;
  Buffer.from(bitmap).copy(frame, 4, 0, 8);
  return frame;
};

const parseCrcMessage = data => {
  const message = Buffer.from(data);
  if (message.length < 6) {
    throw new Error('AquaClean message is shorter than its six-byte CRC header.');
  }

  const bodyLength = message.readUInt16BE(2);
  if (message.length < 6 + bodyLength) {
    throw new Error(
      `AquaClean message declares ${bodyLength} body bytes, `
      + `but only ${message.length - 6} were received.`,
    );
  }

  const body = message.subarray(6, 6 + bodyLength);
  const expectedCrc = message.readUInt16BE(4);
  const actualCrc = crc16(body);
  if (actualCrc !== expectedCrc) {
    throw new Error(
      `AquaClean CRC mismatch: expected 0x${expectedCrc.toString(16).padStart(4, '0')}, `
      + `calculated 0x${actualCrc.toString(16).padStart(4, '0')}.`,
    );
  }

  const parsed = {
    messageId: message[0],
    segments: message[1],
    body
  };

  if ([MESSAGE_ID_RESPONSE, MESSAGE_ID_NOTIFICATION].includes(parsed.messageId)) {
    if (body.length < 5) {
      throw new Error('AquaClean response is shorter than its five-byte body header.');
    }

    const resultLength = body[4];
    if (body.length < 5 + resultLength) {
      throw new Error(
        `AquaClean response declares ${resultLength} result bytes, `
        + `but only ${body.length - 5} were received.`,
      );
    }

    Object.assign(parsed, {
      status: body[0],
      node: body[1],
      context: body[2],
      procedure: body[3],
      result: Buffer.from(body.subarray(5, 5 + resultLength))
    });
  }

  return parsed;
};

const buildSystemParameterPayload = parameterIds => {
  const ids = Array.from(parameterIds);
  if (ids.length > 12) {
    throw new RangeError('AquaClean supports at most 12 system parameters per request.');
  }

  const payload = Buffer.alloc(13);
  payload[0] = ids.length;
  ids.forEach((id, index) => {
    payload[index + 1] = id;
  });
  return payload;
};

const decodeSystemParameters = (result, parameterIds) => {
  const data = Buffer.from(result);
  const ids = Array.from(parameterIds);
  const requiredLength = 1 + (ids.length * 5);
  if (data.length < requiredLength) {
    throw new Error(
      `AquaClean returned ${data.length} system-state bytes; `
      + `${requiredLength} are required for ${ids.length} parameters.`,
    );
  }

  const parameters = {};
  ids.forEach((id, index) => {
    const offset = 1 + (index * 5);
    parameters[id] = data.readUInt32LE(offset + 1);
  });

  return {
    parameters,
    userIsSitting: parameters[0] === undefined ? null : parameters[0] !== 0,
    analShowerIsRunning: parameters[1] === undefined ? null : parameters[1] !== 0,
    ladyShowerIsRunning: parameters[2] === undefined ? null : parameters[2] !== 0,
    // Parameter 3 is the dryer, confirmed live on a Mera Comfort (RS30) on
    // 2026-08-09: it flipped 0 -> 1 when the dryer was started via command 2
    // and back to 0 on Stop. This contradicts the "label corrections" note in
    // the jens62 reference, which claims index 3 tracks the anal shower.
    dryerIsRunning: parameters[3] === undefined ? null : parameters[3] !== 0,
    descalingState: parameters[4],
    descalingDurationMinutes: parameters[5],
    lastErrorCode: parameters[6],
    odourExtractionIsRunning: null
  };
};

// Stored profile settings, procedures 0x53 (read) and 0x54 (write).
//
// The payload starts with the PROFILE id, not an argument count — the device
// keeps several user profiles and reads and writes are per profile. Ranges were
// probed against a real Mera Comfort: 0x54 answers status 0x80 for a value
// outside the allowed range, so writing upwards until it refuses gives the max.
const PROFILE_SETTINGS = Object.freeze({
  ODOUR_EXTRACTION: { id: 0, min: 0, max: 1 },
  OSCILLATOR_STATE: { id: 1, min: 0, max: 1 },
  ANAL_SHOWER_PRESSURE: { id: 2, min: 0, max: 4 },
  LADY_SHOWER_PRESSURE: { id: 3, min: 0, max: 4 },
  ANAL_SHOWER_POSITION: { id: 4, min: 0, max: 4 },
  LADY_SHOWER_POSITION: { id: 5, min: 0, max: 4 },
  WATER_TEMPERATURE: { id: 6, min: 0, max: 5 },
  WC_SEAT_HEAT: { id: 7, min: 0, max: 5 },
  DRYER_TEMPERATURE: { id: 8, min: 0, max: 5 },
  DRYER_STATE: { id: 9, min: 0, max: 1 },
  SYSTEM_FLUSH: { id: 10, min: 0, max: 1 },
  DRYER_FAN_POWER: { id: 13, min: 0, max: 4 }
});

const DEFAULT_PROFILE_ID = 1;
// The device holds five user profiles. Ids 5 and up answer with status 0x80.
const PROFILE_IDS = Object.freeze([0, 1, 2, 3, 4]);

// Device-wide settings, procedures 0x51/0x0A to read and 0x52/0x0B to write.
// Ranges probed against a real Mera Comfort: writing past the maximum comes
// back as status 0x80.
const COMMON_SETTINGS = Object.freeze({
  ORIENTATION_LIGHT_BRIGHTNESS: { id: 1, min: 0, max: 4 },
  ORIENTATION_LIGHT_COLOUR: { id: 2, min: 0, max: 6 },
  ORIENTATION_LIGHT_MODE: { id: 3, min: 0, max: 2 },
  LID_SENSOR_RANGE: { id: 4, min: 0, max: 4 },
  LID_AUTO_OPEN: { id: 6, min: 0, max: 1 },
  LID_AUTO_CLOSE: { id: 7, min: 0, max: 1 }
});

const buildCommonSettingWritePayload = (settingId, value) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError('AquaClean common setting values are 16-bit unsigned integers.');
  }
  return Buffer.from([settingId, value & 0xff, (value >> 8) & 0xff]);
};

const buildProfileSettingPayload = (profileId, settingId) =>
  Buffer.from([profileId, settingId]);

const buildProfileSettingWritePayload = (profileId, settingId, value) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError('AquaClean profile setting values are 16-bit unsigned integers.');
  }
  return Buffer.from([profileId, settingId, value & 0xff, (value >> 8) & 0xff]);
};

// GetFilterStatus takes a fixed 13-byte list: a count followed by record ids,
// zero-padded. Eight ids is the set the device answers reliably; the twelve the
// iOS app sends make it time out.
const FILTER_STATUS_PAYLOAD = Buffer.from([
  0x08,
  0x00, 0x01, 0x02, 0x03, 0x07, 0x08, 0x09, 0x0a,
  0x00, 0x00, 0x00, 0x00
]);

const decodeStatisticsDescale = result => {
  const data = Buffer.from(result);
  if (data.length < 16) {
    throw new Error(
      `AquaClean descale statistics need 16 bytes; received ${data.length}.`,
    );
  }

  return {
    unpostedShowerCycles: data.readUInt8(0),
    daysUntilNextDescale: data.readUInt16LE(1),
    daysUntilShowerRestricted: data.readUInt16LE(3),
    showerCyclesUntilConfirmation: data.readUInt8(5),
    lastDescaleAt: data.readUInt32LE(6) || null,
    lastDescalePromptAt: data.readUInt32LE(10) || null,
    numberOfDescaleCycles: data.readUInt16LE(14)
  };
};

// Response is a count byte followed by five-byte records: id, then a
// little-endian uint32.
const decodeFilterStatus = result => {
  const data = Buffer.from(result);
  const records = {};
  if (data.length >= 1) {
    const count = data[0];
    let offset = 1;
    while (offset + 4 < data.length && Object.keys(records).length < count) {
      records[data[offset]] = data.readUInt32LE(offset + 1);
      offset += 5;
    }
  }

  return {
    daysUntilFilterChange: records[7] === undefined ? null : records[7],
    lastFilterChangeAt: records[8] || null,
    nextFilterChangeAt: records[9] || null,
    filterChangeCount: records[10] === undefined ? null : records[10],
    records
  };
};

// Device identification, procedure 0x82 — note it runs in context 0x00, not
// the 0x01 the settings and state procedures use. Four fixed-width UTF-8
// fields, null padded.
const DEVICE_IDENTIFICATION_FIELDS = Object.freeze([
  ['sapNumber', 12],
  ['serialNumber', 20],
  ['productionDate', 10],
  ['description', 40]
]);

const readFixedString = (data, offset, length) =>
  data.subarray(offset, offset + length)
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();

const decodeDeviceIdentification = result => {
  const data = Buffer.from(result);
  const identification = {};
  let offset = 0;

  for (const [field, length] of DEVICE_IDENTIFICATION_FIELDS) {
    identification[field] = offset < data.length
      ? readFixedString(data, offset, length)
      : '';
    offset += length;
  }
  return identification;
};

// Four bytes: two ASCII characters for the RS version, then the TS build as a
// 16-bit little-endian number. 31 30 12 00 reads as "RS10.0 TS18".
const decodeSocVersions = result => {
  const data = Buffer.from(result);
  if (data.length < 3) return '';

  const rs = readFixedString(data, 0, 2);
  const ts = data.length >= 4 ? data.readUInt16LE(2) : data[2];
  return `RS${rs}.0 TS${ts}`;
};

// Component ids the iOS app asks for. Component 1 is the main firmware; the
// rest are the individual nodes.
const FIRMWARE_COMPONENT_IDS = Object.freeze([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);
const MAIN_FIRMWARE_COMPONENT_ID = 1;

const buildFirmwareVersionPayload = (componentIds = FIRMWARE_COMPONENT_IDS) =>
  Buffer.from([componentIds.length, ...componentIds]);

// Count byte, then five-byte records: component id, two ASCII characters for
// the RS version, and the TS build as a 16-bit little-endian number.
// 01 33 30 ce 00 reads as component 1, "RS30.0 TS206".
const decodeFirmwareVersions = result => {
  const data = Buffer.from(result);
  const components = {};
  if (data.length >= 1) {
    const count = data[0];
    let offset = 1;
    while (offset + 4 < data.length && Object.keys(components).length < count) {
      const rs = readFixedString(data, offset + 1, 2);
      const ts = data.readUInt16LE(offset + 3);
      components[data[offset]] = `RS${rs}.0 TS${ts}`;
      offset += 5;
    }
  }

  return {
    main: components[MAIN_FIRMWARE_COMPONENT_ID] || '',
    components
  };
};

class AquaCleanProtocol {
  constructor({
    writePrimary,
    writeContinuation,
    log = () => {},
    responseTimeoutMs = RESPONSE_TIMEOUT_MS,
    ackTimeoutMs = ACK_TIMEOUT_MS,
    writeTimeoutMs = WRITE_TIMEOUT_MS
  }) {
    if (typeof writePrimary !== 'function' || typeof writeContinuation !== 'function') {
      throw new TypeError('AquaCleanProtocol requires primary and continuation writers.');
    }

    this._writePrimary = writePrimary;
    this._writeContinuation = writeContinuation;
    this._log = log;
    this._responseTimeoutMs = responseTimeoutMs;
    this._ackTimeoutMs = ackTimeoutMs;
    this._writeTimeoutMs = writeTimeoutMs;

    this._pendingResponse = null;
    this._incoming = null;
    this._outgoingAckMask = 0;
    this._ackWaiters = [];
    this._notificationQueue = Promise.resolve();
    this.frames = [];
    this.messages = [];
  }

  queueNotification(characteristicUuid, data) {
    const frame = Buffer.from(data);
    const processing = this._notificationQueue
      .then(() => this.handleNotification(characteristicUuid, frame));
    this._notificationQueue = processing.catch(error => {
        this._rejectPendingResponse(error);
      });
    return processing;
  }

  async handleNotification(characteristicUuid, data) {
    const frame = Buffer.from(data);
    if (frame.length !== BLE_FRAME_LENGTH) {
      throw new Error(
        `AquaClean notification must contain ${BLE_FRAME_LENGTH} bytes; `
        + `received ${frame.length}.`,
      );
    }

    const record = {
      timestamp: new Date().toISOString(),
      characteristicUuid,
      hex: frame.toString('hex')
    };
    this.frames.push(record);
    if (this.frames.length > MAX_CAPTURED_FRAMES) {
      this.frames.splice(0, this.frames.length - MAX_CAPTURED_FRAMES);
    }
    this._log('RX', record);

    const frameType = (frame[0] >> 5) & 0x07;
    if (frameType === FRAME_TYPE_INFO) return;

    if (frameType === FRAME_TYPE_CONTROL) {
      this._handleControlFrame(frame);
      return;
    }

    if (frameType === FRAME_TYPE_SINGLE) {
      await this._handleLegacyDataFrame(frame);
      return;
    }

    if ([FRAME_TYPE_FIRST, FRAME_TYPE_CONS].includes(frameType)) {
      await this._handleExtendedDataFrame(frameType, frame);
    }
  }

  async initializeSession() {
    const responses = [];

    for (const args of PRE_SUBSCRIPTION_PAYLOADS) {
      responses.push(await this.request({
        context: 0x01,
        procedure: 0x11,
        args
      }));
    }

    for (const args of SUBSCRIPTION_PAYLOADS) {
      responses.push(await this.request({
        context: 0x01,
        procedure: 0x13,
        args
      }));
    }

    return responses;
  }

  async getSystemState(parameterIds = SYSTEM_PARAMETER_IDS) {
    const ids = Array.from(parameterIds);
    const response = await this.request({
      context: 0x01,
      procedure: 0x0d,
      args: buildSystemParameterPayload(ids)
    });

    return {
      response,
      state: decodeSystemParameters(response.result, ids)
    };
  }

  async getProfileSetting(settingId, profileId = DEFAULT_PROFILE_ID) {
    const response = await this.request({
      context: 0x01,
      procedure: 0x53,
      args: buildProfileSettingPayload(profileId, settingId)
    });

    if (response.result.length < 2) {
      throw new Error(
        `AquaClean profile setting ${settingId} returned ${response.result.length} bytes.`,
      );
    }
    return response.result.readUInt16LE(0);
  }

  // Writing outside the allowed range comes back as procedure status 0x80,
  // which request() already surfaces as an AQUACLEAN_PROCEDURE error.
  async setProfileSetting(settingId, value, profileId = DEFAULT_PROFILE_ID) {
    return this.request({
      context: 0x01,
      procedure: 0x54,
      args: buildProfileSettingWritePayload(profileId, settingId, value)
    });
  }

  async getCommonSetting(settingId) {
    const response = await this.request({
      context: 0x01,
      procedure: 0x51,
      args: Buffer.from([settingId])
    });

    if (response.result.length < 2) {
      throw new Error(
        `AquaClean common setting ${settingId} returned ${response.result.length} bytes.`,
      );
    }
    return response.result.readUInt16LE(0);
  }

  async getDeviceIdentification() {
    const response = await this.request({
      context: 0x00,
      procedure: 0x82,
      args: Buffer.alloc(0)
    });
    return decodeDeviceIdentification(response.result);
  }

  async getInitialOperationDate() {
    const response = await this.request({
      context: 0x00,
      procedure: 0x86,
      args: Buffer.alloc(0)
    });
    return response.result.toString('utf8').replace(/\0/g, '').trim();
  }

  async getSocVersions() {
    const response = await this.request({
      context: 0x01,
      procedure: 0x81,
      args: Buffer.alloc(0)
    });
    return decodeSocVersions(response.result);
  }

  // The argument list needs 13 bytes, which does not fit in one 20-byte frame,
  // so this request goes out as FIRST + CONS frames.
  async getFirmwareVersions(componentIds = FIRMWARE_COMPONENT_IDS) {
    const response = await this.request({
      context: 0x01,
      procedure: 0x0e,
      args: buildFirmwareVersionPayload(componentIds)
    });
    return decodeFirmwareVersions(response.result);
  }

  async getActiveCommonSetting(settingId) {
    const response = await this.request({
      context: 0x01,
      procedure: 0x0a,
      args: Buffer.from([settingId])
    });

    if (response.result.length < 2) {
      throw new Error(
        `AquaClean active common setting ${settingId} returned ${response.result.length} bytes.`,
      );
    }
    return response.result.readUInt16LE(0);
  }

  // 0x0B applies at once but is forgotten on power loss; 0x52 writes the
  // stored value. Writing both leaves the setting correct either way.
  async setCommonSetting(settingId, value) {
    await this.request({
      context: 0x01,
      procedure: 0x0b,
      args: buildCommonSettingWritePayload(settingId, value)
    });
    await this.request({
      context: 0x01,
      procedure: 0x52,
      args: buildCommonSettingWritePayload(settingId, value)
    });
    return this.getCommonSetting(settingId);
  }

  async getStatisticsDescale() {
    const response = await this.request({
      context: 0x01,
      procedure: 0x45,
      args: Buffer.alloc(0)
    });
    return decodeStatisticsDescale(response.result);
  }

  async getFilterStatus() {
    const response = await this.request({
      context: 0x01,
      procedure: 0x59,
      args: FILTER_STATUS_PAYLOAD
    });
    return decodeFilterStatus(response.result);
  }

  async executeCommand(command) {
    if (!Number.isInteger(command) || command < 0 || command > 255) {
      throw new RangeError('AquaClean command must be an integer from 0 to 255.');
    }

    return this.request({
      context: 0x01,
      procedure: 0x09,
      args: Buffer.from([command])
    });
  }

  async request({ node = 0x01, context, procedure, args = Buffer.alloc(0) }) {
    if (this._pendingResponse) {
      throw new Error('AquaClean protocol only supports one request at a time.');
    }

    const message = buildRequestMessage({ node, context, procedure, args });
    const frames = buildLegacyFrames(message);
    const responsePromise = this._waitForResponse(context, procedure);
    // Notification callbacks can reject this promise while a slow BLE write is
    // still being awaited below. Attach a handler immediately so Node does not
    // report a transient unhandled rejection before request() returns it.
    responsePromise.catch(() => {});
    this._outgoingAckMask = 0;

    try {
      await this._writeFrame(this._writePrimary, frames[0], 'TX primary');

      for (let index = 1; index < frames.length; index += 1) {
        await this._waitForOutgoingAck((1 << index) - 1);
        await this._writeFrame(
          frame => this._writeContinuation(frame, index),
          frames[index],
          `TX continuation ${index}`,
        );
      }
    } catch (error) {
      this._rejectPendingResponse(error);
    }

    return responsePromise;
  }

  close(error = new Error('AquaClean protocol transport closed.')) {
    this._rejectPendingResponse(error);
    for (const waiter of this._ackWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  async _writeFrame(writer, frame, label) {
    this._log(label, frame.toString('hex'));
    let timer;
    const writePromise = Promise.resolve().then(() => writer(Buffer.from(frame)));
    const timeoutPromise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(makeTimeoutError(`${label} write`, this._writeTimeoutMs));
      }, this._writeTimeoutMs);
    });

    try {
      await Promise.race([writePromise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  _handleControlFrame(frame) {
    const errorCode = frame[1];
    if (errorCode !== 0) {
      const error = new Error(
        `AquaClean rejected the request with flow-control error `
        + `0x${errorCode.toString(16).padStart(2, '0')}.`,
      );
      error.code = 'AQUACLEAN_FLOW_CONTROL';
      this._rejectPendingResponse(error);
      return;
    }

    let mask = 0;
    for (let index = 0; index < 4; index += 1) {
      mask |= frame[4 + index] << (index * 8);
    }
    this._outgoingAckMask |= mask;

    const pending = this._ackWaiters.splice(0);
    for (const waiter of pending) {
      if ((this._outgoingAckMask & waiter.mask) === waiter.mask) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      } else {
        this._ackWaiters.push(waiter);
      }
    }
  }

  async _handleLegacyDataFrame(frame) {
    const isFirst = (frame[0] & 0x01) !== 0;
    const countOrIndex = (frame[0] >> 1) & 0x03;
    const payload = Buffer.from(frame.subarray(1));

    if (isFirst) {
      const duplicateFirst = this._incoming
        && this._incoming.expectedFrames === countOrIndex + 1
        && this._incoming.chunks.get(0)
        && this._incoming.chunks.get(0).equals(payload);
      if (duplicateFirst) return;

      this._incoming = {
        expectedFrames: countOrIndex + 1,
        chunks: new Map(),
        bitmap: Buffer.alloc(8)
      };
      this._incoming.chunks.set(0, payload);
      this._incoming.bitmap[0] |= 0x01;
    } else {
      if (!this._incoming) {
        // Weak links can deliver a retransmitted final frame after the complete
        // response has already been acknowledged. It carries no new data.
        this._log('RX late continuation ignored', frame.toString('hex'));
        return;
      }
      const existing = this._incoming.chunks.get(countOrIndex);
      if (existing && existing.equals(payload)) return;

      this._incoming.chunks.set(countOrIndex, payload);
      this._incoming.bitmap[0] |= 1 << countOrIndex;
    }

    if (this._incoming.chunks.size === this._incoming.expectedFrames) {
      await this._completeIncomingMessage();
    }
  }

  async _handleExtendedDataFrame(frameType, frame) {
    if (frameType === FRAME_TYPE_FIRST) {
      const payload = Buffer.from(frame.subarray(2));
      const duplicateFirst = this._incoming
        && this._incoming.expectedFrames === frame[1]
        && this._incoming.chunks.get(0)
        && this._incoming.chunks.get(0).equals(payload);
      if (duplicateFirst) return;

      this._incoming = {
        expectedFrames: frame[1],
        chunks: new Map([[0, payload]]),
        bitmap: Buffer.alloc(8)
      };
      this._incoming.bitmap[0] |= 0x01;
    } else {
      if (!this._incoming) {
        this._log('RX late extended continuation ignored', frame.toString('hex'));
        return;
      }
      const index = frame[1];
      const payload = Buffer.from(frame.subarray(2));
      const existing = this._incoming.chunks.get(index);
      if (existing && existing.equals(payload)) return;

      this._incoming.chunks.set(index, payload);
      this._incoming.bitmap[Math.floor(index / 8)] |= 1 << (index % 8);
    }

    const complete = this._incoming.chunks.size === this._incoming.expectedFrames;
    if (complete || this._incoming.chunks.size % 4 === 0) {
      await this._writeFrame(
        this._writePrimary,
        buildControlFrame(this._incoming.bitmap),
        'TX response acknowledgement',
      );
    }
    if (complete) await this._completeIncomingMessage({ alreadyAcknowledged: true });
  }

  async _completeIncomingMessage({ alreadyAcknowledged = false } = {}) {
    const transaction = this._incoming;
    this._incoming = null;

    if (!alreadyAcknowledged) {
      await this._writeFrame(
        this._writePrimary,
        buildControlFrame(transaction.bitmap),
        'TX response acknowledgement',
      );
    }

    const chunks = [];
    for (let index = 0; index < transaction.expectedFrames; index += 1) {
      const chunk = transaction.chunks.get(index);
      if (!chunk) {
        throw new Error(`AquaClean response frame ${index} is missing.`);
      }
      chunks.push(chunk);
    }

    const message = parseCrcMessage(Buffer.concat(chunks));
    this.messages.push({
      messageId: message.messageId,
      status: message.status,
      node: message.node,
      context: message.context,
      procedure: message.procedure,
      resultHex: message.result ? message.result.toString('hex') : ''
    });
    if (this.messages.length > MAX_CAPTURED_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_CAPTURED_MESSAGES);
    }

    if (message.messageId === MESSAGE_ID_RESPONSE) {
      if (message.status !== 0) {
        const error = new Error(
          `AquaClean procedure 0x${message.procedure.toString(16).padStart(2, '0')} `
          + `failed with status 0x${message.status.toString(16).padStart(2, '0')}.`,
        );
        error.code = 'AQUACLEAN_PROCEDURE';
        this._rejectPendingResponse(error);
        return;
      }
      this._resolvePendingResponse(message);
    }
  }

  _waitForResponse(context, procedure) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pendingResponse
          && this._pendingResponse.context === context
          && this._pendingResponse.procedure === procedure) {
          this._pendingResponse = null;
          reject(makeTimeoutError(
            `response for procedure 0x${procedure.toString(16).padStart(2, '0')}`,
            this._responseTimeoutMs,
          ));
        }
      }, this._responseTimeoutMs);

      this._pendingResponse = {
        context,
        procedure,
        resolve,
        reject,
        timer
      };
    });
  }

  _resolvePendingResponse(message) {
    const pending = this._pendingResponse;
    if (!pending) return;
    if (pending.context !== message.context || pending.procedure !== message.procedure) return;

    this._pendingResponse = null;
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  _rejectPendingResponse(error) {
    const pending = this._pendingResponse;
    if (!pending) return;

    this._pendingResponse = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  _waitForOutgoingAck(mask) {
    if ((this._outgoingAckMask & mask) === mask) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const waiter = {
        mask,
        resolve,
        reject,
        timer: null
      };
      waiter.timer = setTimeout(() => {
        const index = this._ackWaiters.indexOf(waiter);
        if (index >= 0) this._ackWaiters.splice(index, 1);
        reject(makeTimeoutError(`request acknowledgement 0x${mask.toString(16)}`, this._ackTimeoutMs));
      }, this._ackTimeoutMs);
      this._ackWaiters.push(waiter);
    });
  }
}

module.exports = {
  ACK_TIMEOUT_MS,
  AQUACLEAN_COMMANDS,
  AquaCleanProtocol,
  DEFAULT_PROFILE_ID,
  FILTER_STATUS_PAYLOAD,
  PROFILE_SETTINGS,
  COMMON_SETTINGS,
  DEVICE_IDENTIFICATION_FIELDS,
  PROFILE_IDS,
  FIRMWARE_COMPONENT_IDS,
  buildCommonSettingWritePayload,
  MAIN_FIRMWARE_COMPONENT_ID,
  buildFirmwareVersionPayload,
  buildProfileSettingPayload,
  buildProfileSettingWritePayload,
  decodeDeviceIdentification,
  decodeFilterStatus,
  decodeFirmwareVersions,
  decodeSocVersions,
  decodeStatisticsDescale,
  BLE_FRAME_LENGTH,
  MESSAGE_ID_RESPONSE,
  PRE_SUBSCRIPTION_PAYLOADS,
  RESPONSE_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  SUBSCRIPTION_PAYLOADS,
  SYSTEM_PARAMETER_IDS,
  buildControlFrame,
  buildCrcMessage,
  buildLegacyFrames,
  buildRequestMessage,
  buildSystemParameterPayload,
  crc16,
  decodeSystemParameters,
  parseCrcMessage
};
