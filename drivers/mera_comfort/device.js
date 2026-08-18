'use strict';

const Homey = require('homey');
const { translate } = require('../../lib/i18n');
const { formatErrorCode } = require('../../lib/aquaclean-error-codes');
const {
  AQUACLEAN_COMMANDS,
  AquaCleanProtocol,
  COMMON_SETTINGS,
  PROFILE_SETTINGS,
  SYSTEM_PARAMETER_IDS
} = require('../../lib/aquaclean-protocol');

const AQUACLEAN_SERVICE_UUID = '00003ea000001000800000805f9b34fb';
const GEBERIT_GATT_SERVICE_UUID = '3334429d90f34c41a02d5cb3a03e0000';
const WRITE_CHARACTERISTIC_UUIDS = [
  '3334429d90f34c41a02d5cb3a13e0000',
  '3334429d90f34c41a02d5cb3a23e0000',
  '3334429d90f34c41a02d5cb3a33e0000',
  '3334429d90f34c41a02d5cb3a43e0000'
];
const READ_CHARACTERISTIC_UUIDS = [
  '3334429d90f34c41a02d5cb3a53e0000',
  '3334429d90f34c41a02d5cb3a63e0000',
  '3334429d90f34c41a02d5cb3a73e0000',
  '3334429d90f34c41a02d5cb3a83e0000'
];

const ACTIVE_STATUS_POLL_INTERVAL_MS = 2500;
// The toilet accepts one central at a time, and the physical remote is dead
// while anyone holds the connection — Geberit documents this for their own app.
// At 30 s the toilet is occupied for under two seconds per cycle, which is the
// interval jens62's bridge settled on for the same reason.
const IDLE_STATUS_POLL_INTERVAL_MS = 30 * 1000;
// The scheduler only checks whether a poll is due, so it may tick faster than
// the shortest interval a user can configure. Anything cheaper would put a
// floor under the active setting.
const POLL_SCHEDULER_INTERVAL_MS = 1000;
const IDLE_POLL_SETTING = 'status_poll_idle_seconds';
const ACTIVE_POLL_SETTING = 'status_poll_active_seconds';
const POLL_INTERVAL_MAX_MS = 10 * 60 * 1000;
const STATUS_HEARTBEAT_INTERVAL_MS = 15 * 1000;
// Just enough for the unsolicited INFO frames to land after the CCCD writes;
// measured, they arrive within about 400 ms of the subscription.
const INFO_FRAME_SETTLE_MS = 400;
const COMMAND_STATE_SETTLE_MS = 300;
const CONNECT_ATTEMPTS = 3;
const PROTOCOL_SESSION_ATTEMPTS = 2;
const DISCOVERY_BUSY_ATTEMPTS = 5;
const ADVERTISEMENT_SCAN_ATTEMPTS = 3;
const ADVERTISEMENT_RETRY_DELAY_MS = 1500;
const OPERATION_HANDOFF_TIMEOUT_MS = 45 * 1000;

const RECONNECT_DELAY_MIN_MS = 10 * 1000;
const RECONNECT_DELAY_MAX_MS = 2 * 60 * 1000;
const DISCONNECT_RECONNECT_DELAY_MS = 2 * 1000;
const BLE_CLEANUP_TIMEOUT_MS = 5 * 1000;
const BLE_SCAN_TIMEOUT_MS = 20 * 1000;
const BLE_CONNECT_TIMEOUT_MS = 25 * 1000;
const BLE_CONNECT_TIMEOUT_COOLDOWN_MS = 5 * 1000;
const BLE_DISCOVERY_TIMEOUT_MS = 10 * 1000;
const BLE_SUBSCRIBE_TIMEOUT_MS = 8 * 1000;
// How long a session survives after you last did something. Reconnecting costs
// about six seconds of handshake, so a short window makes every interaction
// feel slow. Held too long, the toilet stays occupied and the Geberit Home app
// on your phone cannot reach it — it accepts one central at a time.
const KEEP_WARM_SETTING = 'ble_keep_warm_seconds';
const KEEP_WARM_DEFAULT_MS = 30 * 1000;
const KEEP_WARM_MAX_MS = 15 * 60 * 1000;
const REFRESH_PREEMPTED_ERROR_CODE = 'AQUACLEAN_REFRESH_PREEMPTED';
const OPTIMISTIC_FUNCTION_STATE_HOLD_MS = 12 * 1000;
// A press repeated inside this window is one press the interface counted twice.
// Anything slower is a person pressing again, and must be sent.
const DUPLICATE_COMMAND_WINDOW_MS = 750;
const DEFAULT_ODOUR_RUN_ON_SECONDS = 120;
const INSIGHTS_OPTIONS_VERSION = 9;

const CONTROL_CAPABILITY_COMMANDS = Object.freeze({
  aquaclean_button_anal_shower: {
    code: AQUACLEAN_COMMANDS.TOGGLE_ANAL_SHOWER,
    label: 'toggle anal shower'
  },
  aquaclean_button_lady_shower: {
    code: AQUACLEAN_COMMANDS.TOGGLE_LADY_SHOWER,
    label: 'toggle lady shower'
  },
  aquaclean_button_dryer: {
    code: AQUACLEAN_COMMANDS.TOGGLE_DRYER,
    label: 'toggle dryer'
  },
  aquaclean_button_stop: {
    code: AQUACLEAN_COMMANDS.STOP,
    label: 'stop'
  },
  aquaclean_button_lid: {
    code: AQUACLEAN_COMMANDS.TOGGLE_LID,
    label: 'toggle lid'
  },
  aquaclean_button_odour_extraction: {
    code: AQUACLEAN_COMMANDS.TOGGLE_ODOUR_EXTRACTION,
    label: 'toggle odour extraction'
  },
  aquaclean_button_odour_run_on: {
    code: AQUACLEAN_COMMANDS.ODOUR_EXTRACTION_RUN_ON,
    label: 'odour extraction run-on'
  }
});
// aquaclean_button_reset_filter moved into the device settings, where a rarely
// used and irreversible action belongs rather than on the main page.
// Stored profile settings the device page can change. Every entry writes with
// procedure 0x54 to the profile below; the ranges were probed against the
// toilet, and the device rejects anything outside them with status 0x80.
// Which of the toilet's five profiles the sliders read and write. This is not
// the profile the toilet is using — no procedure to change that is known.
const EDIT_PROFILE_SETTING = 'edit_profile';

// Measured, not assumed: with the remote on its profile 1, changing the seat
// heat on the remote altered profile 0 on the wire and nothing else. The
// remote's numbering is one higher than the protocol's, so its four buttons
// are profiles 0-3 here. Profile 0 is therefore the most important one of all
// — it was briefly removed from the list on the assumption that it was a
// system default, which made the active profile the one you could not edit.
const EDITABLE_PROFILE_IDS = Object.freeze([0, 1, 2, 3, 4]);

// A slider that snaps back tells you nothing about whether the toilet took the
// value. This line is the receipt: what was written, to which profile, when.
const LAST_WRITE_CAPABILITY = 'aquaclean_last_setting_write';
// User-facing runtime text lives in locales/en.json and locales/no.json and is
// resolved with homey.__(), so a Norwegian Homey shows Norwegian throughout.
// Setting labels reuse the same keys as their ids: setting.<settingId>.

const MAINTENANCE_CAPABILITIES = Object.freeze([
  'aquaclean_days_until_descaling',
  'aquaclean_days_until_filter'
]);

// Read-only labels behind the device's gear icon. Filled from the toilet.
const RESET_FILTER_SETTING = 'reset_filter_counter';
const REFRESH_INFORMATION_SETTING = 'refresh_device_information';
const DEBUG_FRAME_LOGGING_SETTING = 'debug_frame_logging';

// How many consecutive connection failures before the app considers itself
// genuinely cut off (Flow trigger fires) and before it starts pressing the
// proxy's own recovery buttons.
const CONNECTION_LOST_AFTER_FAILURES = 3;
const CIRCUIT_BREAKER_FAILURES = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30 * 60 * 1000;

// Buttons on the ESP32 proxy itself. They do nothing for a weak signal — that
// is physics — but they recover a proxy whose Bluetooth stack has wedged.
// Matched loosely by name because ESPHome may rename entities between versions.
const PROXY_BUTTON_SETTINGS = Object.freeze({
  restart_ble_proxy: { pattern: 'restart', label: 'restart the Bluetooth proxy' },
  clear_ble_cache: { pattern: 'clear', label: 'clear the proxy Bluetooth cache' }
});

// The four steps of the lid position calibration, in the order the repair view
// walks the user through them.
const LID_CALIBRATION_STEPS = Object.freeze({
  start: AQUACLEAN_COMMANDS.START_LID_CALIBRATION,
  up: AQUACLEAN_COMMANDS.LID_OFFSET_INCREMENT,
  down: AQUACLEAN_COMMANDS.LID_OFFSET_DECREMENT,
  save: AQUACLEAN_COMMANDS.LID_OFFSET_SAVE
});

// Device-wide settings that are editable from the device settings page.
// `kind` says how Homey hands the value over: a dropdown gives a string, a
// checkbox a boolean, a number the number itself. The device wants 0-N either way.
const CONFIG_SETTINGS = Object.freeze({
  light_mode: { setting: COMMON_SETTINGS.ORIENTATION_LIGHT_MODE, kind: 'dropdown' },
  light_colour: { setting: COMMON_SETTINGS.ORIENTATION_LIGHT_COLOUR, kind: 'dropdown' },
  light_brightness: { setting: COMMON_SETTINGS.ORIENTATION_LIGHT_BRIGHTNESS, kind: 'number' },
  lid_auto_open: { setting: COMMON_SETTINGS.LID_AUTO_OPEN, kind: 'checkbox' },
  lid_auto_close: { setting: COMMON_SETTINGS.LID_AUTO_CLOSE, kind: 'checkbox' },
  lid_sensor_range: { setting: COMMON_SETTINGS.LID_SENSOR_RANGE, kind: 'number' }
});

// Settings on the same page that belong to a single profile rather than the
// whole toilet, so they read and write against the profile being edited.
const PROFILE_CONFIG_SETTINGS = Object.freeze({
  profile_oscillation: { setting: PROFILE_SETTINGS.OSCILLATOR_STATE, kind: 'checkbox' },
  profile_odour_extraction: { setting: PROFILE_SETTINGS.ODOUR_EXTRACTION, kind: 'checkbox' },
  profile_system_flush: { setting: PROFILE_SETTINGS.SYSTEM_FLUSH, kind: 'checkbox' },
  profile_dryer_state: { setting: PROFILE_SETTINGS.DRYER_STATE, kind: 'checkbox' },
  profile_seat_heat: { setting: PROFILE_SETTINGS.WC_SEAT_HEAT, kind: 'number' },
  profile_water_temperature: { setting: PROFILE_SETTINGS.WATER_TEMPERATURE, kind: 'number' },
  profile_dryer_temperature: { setting: PROFILE_SETTINGS.DRYER_TEMPERATURE, kind: 'number' },
  profile_dryer_fan_power: { setting: PROFILE_SETTINGS.DRYER_FAN_POWER, kind: 'number' },
  profile_anal_pressure: { setting: PROFILE_SETTINGS.ANAL_SHOWER_PRESSURE, kind: 'number' },
  profile_anal_position: { setting: PROFILE_SETTINGS.ANAL_SHOWER_POSITION, kind: 'number' },
  profile_lady_pressure: { setting: PROFILE_SETTINGS.LADY_SHOWER_PRESSURE, kind: 'number' },
  profile_lady_position: { setting: PROFILE_SETTINGS.LADY_SHOWER_POSITION, kind: 'number' }
});

const configEntryFor = settingId => CONFIG_SETTINGS[settingId] || PROFILE_CONFIG_SETTINGS[settingId];

const toWireConfigValue = (kind, value) => {
  if (kind === 'checkbox') return value ? 1 : 0;
  return Math.round(Number(value));
};

const fromWireConfigValue = (kind, value) => {
  if (kind === 'checkbox') return value !== 0;
  if (kind === 'dropdown') return String(value);
  return value;
};

// Settings and maintenance counters change rarely, so they are read on a slow
// cadence of their own rather than on every status poll.
const SETTINGS_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
// After a FAILED settings read: how long before the next try. Without this an
// unreachable toilet was retried back-to-back — a 21-round-trip read looping
// forever, holding _busy and starving the status poll entirely.
const SETTINGS_RETRY_INTERVAL_MS = 5 * 60 * 1000;

const STATUS_REFRESH_CAPABILITY = 'aquaclean_button_refresh_status';

// The AquaClean protocol only offers TOGGLE commands, which makes a Flow card
// that "toggles" non-deterministic: run it twice and you undo yourself. For
// every function whose state the toilet actually reports, the app can read
// first and only send the toggle when the state differs — turning the same
// card into "make it so".
//
// The lid is deliberately absent: its position is not exposed anywhere in the
// protocol (verified by exhausting the system parameters and context 0x00), so
// an "open the lid" card could not know whether it had succeeded. It stays a
// toggle, and its hint says why.
const DETERMINISTIC_FUNCTIONS = Object.freeze({
  anal_shower: {
    button: 'aquaclean_button_anal_shower',
    status: 'aquaclean_anal_shower_running',
    reported: true
  },
  lady_shower: {
    button: 'aquaclean_button_lady_shower',
    status: 'aquaclean_lady_shower_running',
    reported: true
  },
  dryer: {
    button: 'aquaclean_button_dryer',
    status: 'aquaclean_dryer_running',
    reported: true
  },
  // The toilet never reports odour extraction, so the app's own tracked state
  // is the only thing to compare against. Still deterministic from Homey's
  // point of view, which is what a Flow needs.
  odour_extraction: {
    button: 'aquaclean_button_odour_extraction',
    status: 'aquaclean_odour_extraction_running',
    reported: false
  }
});
// The toilet reports whether someone is sitting, never for how long. The
// duration is measured here from the transitions, so it is only as precise
// as the poll interval -- 2.5 s while a status is active.
const SITTING_DURATION_CAPABILITY = 'measure_aquaclean_sitting_duration';
const STATUS_CAPABILITIES = Object.freeze([
  'measure_signal_strength',
  'aquaclean_connection_state',
  'aquaclean_connection_error',
  'aquaclean_last_status_update',
  'aquaclean_user_sitting',
  'aquaclean_anal_shower_running',
  'aquaclean_lady_shower_running',
  'aquaclean_odour_extraction_running',
  'measure_aquaclean_user_sitting',
  'measure_aquaclean_anal_shower',
  'measure_aquaclean_lady_shower',
  'measure_aquaclean_odour_extraction',
  'aquaclean_descaling_state',
  'aquaclean_error_code',
  'aquaclean_error_text',
  'aquaclean_raw_status',
  'aquaclean_dryer_running',
  'measure_aquaclean_dryer',
  SITTING_DURATION_CAPABILITY
]);
const STATUS_INSIGHTS_CAPABILITY_IDS = Object.freeze({
  aquaclean_user_sitting: 'measure_aquaclean_user_sitting',
  aquaclean_anal_shower_running: 'measure_aquaclean_anal_shower',
  aquaclean_lady_shower_running: 'measure_aquaclean_lady_shower',
  aquaclean_odour_extraction_running: 'measure_aquaclean_odour_extraction',
  aquaclean_dryer_running: 'measure_aquaclean_dryer'
});
// Only capabilities the toilet actually reports may raise the poll rate.
// Odour extraction is deliberately absent: the toilet never reports it, so the
// value is the app's own inference and nothing can ever contradict it. Toggling
// it on sets it true with no off-timer, and with odour_auto_tracking disabled
// nothing clears it — which used to pin the poll to the 2.5 s active interval
// for good. Past the keep-warm window that is a cold connect and teardown every
// 2.5 s forever, and the toilet's own remote is dead while anyone is connected.
const ACTIVE_STATUS_CAPABILITY_IDS = Object.freeze([
  'aquaclean_user_sitting',
  'aquaclean_anal_shower_running',
  'aquaclean_lady_shower_running'
]);
const DESCALING_STATES = Object.freeze({
  0: 'idle',
  1: 'preparing',
  2: 'waiting',
  3: 'running'
});
const BOOLEAN_STATUS_TRIGGER_IDS = Object.freeze({
  aquaclean_dryer_running: {
    true: 'aquaclean_dryer_running_true',
    false: 'aquaclean_dryer_running_false'
  },
  aquaclean_odour_extraction_running: {
    true: 'aquaclean_odour_extraction_running_true',
    false: 'aquaclean_odour_extraction_running_false'
  },
  aquaclean_user_sitting: {
    true: 'aquaclean_user_sitting_true',
    false: 'aquaclean_user_sitting_false'
  },
  aquaclean_anal_shower_running: {
    true: 'aquaclean_anal_shower_running_true',
    false: 'aquaclean_anal_shower_running_false'
  },
  aquaclean_lady_shower_running: {
    true: 'aquaclean_lady_shower_running_true',
    false: 'aquaclean_lady_shower_running_false'
  }
});
const VALUE_STATUS_TRIGGER_IDS = Object.freeze({
  aquaclean_descaling_state: 'aquaclean_descaling_state_changed',
  aquaclean_error_code: 'aquaclean_error_code_changed'
});
const INSIGHTS_CAPABILITY_OPTIONS = Object.freeze({
  aquaclean_user_sitting: {
    insights: true,
    insightsTitleTrue: {
      en: 'User sitting',
      no: 'Bruker sitter'
    },
    insightsTitleFalse: {
      en: 'Seat vacant',
      no: 'Ingen bruker'
    }
  },
  aquaclean_anal_shower_running: {
    insights: true,
    insightsTitleTrue: {
      en: 'Anal shower running',
      no: 'Analdusj pågår'
    },
    insightsTitleFalse: {
      en: 'Anal shower off',
      no: 'Analdusj av'
    }
  },
  aquaclean_lady_shower_running: {
    insights: true,
    insightsTitleTrue: {
      en: 'Lady shower running',
      no: 'Ladydusj pågår'
    },
    insightsTitleFalse: {
      en: 'Lady shower off',
      no: 'Ladydusj av'
    }
  },
  aquaclean_odour_extraction_running: {
    insights: true,
    insightsTitleTrue: {
      en: 'Odour extraction running',
      no: 'Luktavsug pågår'
    },
    insightsTitleFalse: {
      en: 'Odour extraction off',
      no: 'Luktavsug av'
    }
  },
  aquaclean_dryer_running: {
    insights: true,
    insightsTitleTrue: {
      en: 'Dryer running',
      no: 'Tørker pågår'
    },
    insightsTitleFalse: {
      en: 'Dryer off',
      no: 'Tørker av'
    }
  },
  // Every other numeric history capability had insights in its definition from
  // the start; the error code did not, so Homey never created a log for it —
  // a fault could come and go without leaving a timestamp anywhere. The
  // definition in app.json now carries insights too; this entry pushes the
  // same options onto devices paired before the fix, without re-pairing.
  aquaclean_error_code: {
    insights: true,
    chartType: 'stepLine'
  }
});

const normalizeUuid = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-f0-9]/g, '');

const wait = (homey, milliseconds) =>
  new Promise(resolve => homey.setTimeout(resolve, milliseconds));

const withTimeout = (homey, operation, milliseconds, label) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = homey.setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(`${label} timed out after ${milliseconds} ms.`);
      error.code = 'AQUACLEAN_TIMEOUT';
      reject(error);
    }, milliseconds);

    Promise.resolve()
      .then(operation)
      .then(value => {
        if (settled) return;
        settled = true;
        homey.clearTimeout(timer);
        resolve(value);
      }, error => {
        if (settled) return;
        settled = true;
        homey.clearTimeout(timer);
        reject(error);
      });
  });

const isAquaCleanAdvertisement = advertisement => {
  const name = String(advertisement.localName || '').toLowerCase();
  return name.includes('geberit')
    || name.includes('aquaclean')
    || name.includes('ac pro')
    || (advertisement.serviceUuids || [])
      .some(uuid => normalizeUuid(uuid) === AQUACLEAN_SERVICE_UUID);
};

const isBleInProgressError = error =>
  /in progress|sync of devices/i.test(String(error && error.message ? error.message : error));

const isStaleBleObjectError = error =>
  /org\.freedesktop\.DBus|UnknownObject|signature "ss"|doesn't exist/i
    .test(String(error && error.message ? error.message : error));

const makeRefreshPreemptedError = () => {
  const error = new Error('Background status refresh yielded to a control command.');
  error.code = REFRESH_PREEMPTED_ERROR_CODE;
  return error;
};

const isRefreshPreemptedError = error =>
  error && error.code === REFRESH_PREEMPTED_ERROR_CODE;

class MeraComfortDevice extends Homey.Device {
  async onInit() {
    this._busy = false;
    this._activeOperation = null;
    this._activeCommandCode = null;
    this._activeCommandStartedAt = 0;
    this._idleWaiters = [];
    this._timeZone = null;
    this._language = 'en';
    this._connectionLossNotified = false;
    this._controlRequestsWaiting = 0;
    this._refreshPreemptRequested = false;
    this._optimisticStateUntil = new Map();
    this._odourRunOnTimer = null;
    this._deleted = false;
    this._session = null;
    this._reconnectFailures = 0;
    this._nextReconnectAt = 0;
    this._forceFreshScan = false;
    this._lastStatusHeartbeatAt = 0;
    this._lastBackgroundPollFinishedAt = 0;
    this._lastSettingsRefreshAt = 0;
    this._lastSettingsAttemptAt = 0;
    this._lastLoggedStateFingerprint = null;
    this._breakerStage = 0;
    this._lastBreakerActionAt = 0;
    this.log('AquaClean device initialized', this.getName());

    await this.loadHomeyTimezone();
    await this.ensureCapabilities();
    await this.ensureInsightsCapabilityOptions();
    await this.syncAllStatusInsightsCapabilities();
    if (this.hasCapability('aquaclean_connection_state')) {
      await this.setCapabilityValue('aquaclean_connection_state', 'reconnecting');
    }
    this.registerControlCapabilityListeners();
    this.registerStatusRefreshListener();

    await this.refreshStatus().catch(async error => {
      if (!isRefreshPreemptedError(error)) {
        await this.handleRefreshFailure('Initial AquaClean connection failed', error);
      }
    });
    this._lastBackgroundPollFinishedAt = Date.now();
    if (this._deleted) return;

    // Settings and maintenance counters are fetched once at startup so the
    // device page is populated, then only every few hours. Startup is not a
    // user action, so it does not hold the toilet warm afterwards.
    this.refreshSettingsAndMaintenance({ keepWarm: false }).catch(error => {
      this.error('Initial AquaClean settings read failed', error);
    });

    this._interval = this.homey.setInterval(() => {
      this.closeExpiredKeepWarmSession().catch(error => {
        this.error('AquaClean keep-warm expiry check failed', error);
      });
      this.pollStatus().catch(error => {
        this.error('AquaClean background polling failed', error);
      });
      this.pollSettingsAndMaintenance().catch(error => {
        this.error('AquaClean settings polling failed', error);
      });
    }, POLL_SCHEDULER_INTERVAL_MS);
  }

  // addCapability always appends, so a capability introduced after pairing
  // keeps the position it was added in, not the one the manifest gives it.
  // There is no reorder API.
  //
  // Rebuilding only the diverging tail was tried first and did nothing: the
  // array changed, the device page did not. The LINAK app hit the same wall
  // and the answer there was to remove EVERY capability and add them all back
  // in order — a partial rebuild is not enough. Same approach here.
  //
  // Expensive and not atomic, so it runs only when the order is actually
  // wrong, and only once per target order.
  async alignCapabilityOrderToManifest() {
    if (typeof this.removeCapability !== 'function') return;

    const manifest = this.driver && this.driver.manifest;
    const declared = manifest && manifest.capabilities;
    if (!Array.isArray(declared)) return;

    const current = this.getCapabilities();
    const wanted = declared.filter(capabilityId => current.includes(capabilityId));
    // ensureCapabilities has already reconciled membership; if the two still
    // disagree on content, reordering is not the problem to solve here.
    if (wanted.length !== current.length) return;
    if (wanted.join('|') === current.join('|')) return;

    // A rebuild that does not take is worth one attempt, not one per restart.
    const signature = wanted.join(',');
    if (this.getStoreValue('capabilityOrderAttempt') === signature) {
      this.log('AquaClean capability order still differs from the manifest; not retrying');
      return;
    }
    await this.setStoreValue('capabilityOrderAttempt', signature);

    this.log('Rebuilding the AquaClean capability order', { capabilities: wanted });
    for (const capabilityId of current) {
      await this.removeCapability(capabilityId).catch(error => {
        this.error('Could not remove a capability while reordering', {
          capabilityId,
          message: error.message
        });
      });
    }
    for (const capabilityId of wanted) {
      await this.addCapability(capabilityId).catch(error => {
        this.error('Could not re-add a capability while reordering', {
          capabilityId,
          message: error.message
        });
      });
    }
  }

  // Everything the user can see is localized. The raw error keeps flowing to
  // the app log, where it is worth having; the UI gets something actionable.
  getUserErrorMessage(error) {
    if (isBleInProgressError(error)) return this.homey.__('error.busy_homey');
    // Checked before the timeout case, which it usually arrives as. The toggle
    // byte was written and the link dropped before the answer came back, so the
    // toilet has very likely already acted. "Could not reach the AquaClean"
    // invites a second press — and a second press on a toggle undoes the first.
    // This is the one error where the user needs to look at the toilet rather
    // than at Homey.
    if (error && error.aquacleanCommandAttempted) {
      return this.homey.__('error.command_uncertain');
    }
    if (error && error.code === 'AQUACLEAN_BUSY') return this.homey.__('error.busy_device');
    if (error && error.code === 'AQUACLEAN_TIMEOUT') return this.homey.__('error.timeout');
    return this.homey.__('error.unreachable');
  }

  async ensureCapabilities() {
    const capabilityIds = [
      ...Object.keys(CONTROL_CAPABILITY_COMMANDS),
      STATUS_REFRESH_CAPABILITY,
      ...STATUS_CAPABILITIES,
      ...MAINTENANCE_CAPABILITIES,
      LAST_WRITE_CAPABILITY
    ];

    for (const capabilityId of capabilityIds) {
      if (!this.hasCapability(capabilityId)) {
        this.log('Adding AquaClean capability', capabilityId);
        await this.addCapability(capabilityId);
      }
    }

    // The manifest sweep below replaces what used to be two hand-maintained
    // removal lists (legacy button.* aliases and per-version retired ids):
    // anything the manifest no longer declares is removed, whatever it was.
    await this.removeCapabilitiesMissingFromManifest();

    await this.alignCapabilityOrderToManifest();

    // The order below is the device's own, not the manifest's. Homey fixes it
    // when a capability is added and never reshuffles it, so this is the only
    // way to see what the page will actually look like.
    const manifest = this.driver && this.driver.manifest;
    this.log('AquaClean capability order', {
      device: this.getCapabilities(),
      manifest: manifest ? manifest.capabilities : null
    });
  }

  // Homey fixes a device's capability list when the device is created and never
  // prunes it, so anything dropped from the manifest in an earlier version stays
  // on the device with no code behind it. Pressing one of those answers
  // "missing capability listener". The manifest is the authority: whatever is
  // not in it cannot be served, so it should not be shown either.
  async removeCapabilitiesMissingFromManifest() {
    const manifest = this.driver && this.driver.manifest;
    const declared = manifest && Array.isArray(manifest.capabilities)
      ? new Set(manifest.capabilities)
      : null;
    // Without a manifest to compare against, removing anything would be a guess.
    if (!declared || declared.size === 0) return;

    for (const capabilityId of this.getCapabilities()) {
      if (declared.has(capabilityId)) continue;
      this.log('Removing AquaClean capability that is no longer in the manifest', capabilityId);
      await this.removeCapability(capabilityId).catch(error => {
        this.error('Could not remove stale AquaClean capability', {
          capabilityId,
          message: error.message
        });
      });
    }
  }

  async ensureInsightsCapabilityOptions() {
    if (typeof this.setCapabilityOptions !== 'function') return;
    if (this.getStoreValue('insightsOptionsVersion') === INSIGHTS_OPTIONS_VERSION) return;

    for (const [capabilityId, insightsOptions] of
      Object.entries(INSIGHTS_CAPABILITY_OPTIONS)) {
      if (!this.hasCapability(capabilityId)) continue;
      // getCapabilityOptions throws for a capability that has no options yet —
      // true for aquaclean_error_code, which ships without manifest options.
      // The four boolean statuses never hit this because theirs exist.
      let currentOptions = {};
      if (typeof this.getCapabilityOptions === 'function') {
        try {
          currentOptions = this.getCapabilityOptions(capabilityId) || {};
        } catch (error) {
          currentOptions = {};
        }
      }
      await this.setCapabilityOptions(capabilityId, {
        ...currentOptions,
        ...insightsOptions
      });

    }

    await this.setStoreValue('insightsOptionsVersion', INSIGHTS_OPTIONS_VERSION);
  }

  async syncAllStatusInsightsCapabilities() {
    for (const statusCapabilityId of Object.keys(STATUS_INSIGHTS_CAPABILITY_IDS)) {
      await this.syncStatusInsightsCapability(
        statusCapabilityId,
        this.getCapabilityValue(statusCapabilityId),
      );
    }
  }

  async syncStatusInsightsCapability(statusCapabilityId, value) {
    const insightsCapabilityId =
      STATUS_INSIGHTS_CAPABILITY_IDS[statusCapabilityId];
    if (
      !insightsCapabilityId
      || typeof value !== 'boolean'
      || typeof this.hasCapability !== 'function'
      || !this.hasCapability(insightsCapabilityId)
    ) {
      return;
    }

    const insightsValue = value ? 1 : 0;
    if (this.getCapabilityValue(insightsCapabilityId) === insightsValue) return;
    await this.setCapabilityValue(insightsCapabilityId, insightsValue);
  }

  registerControlCapabilityListeners() {
    for (const capabilityId of Object.keys(CONTROL_CAPABILITY_COMMANDS)) {
      this.registerCapabilityListener(capabilityId, async () => {
        await this.executeControlCapability(capabilityId);
      });
    }
  }

  registerStatusRefreshListener() {
    this.registerCapabilityListener(STATUS_REFRESH_CAPABILITY, async () => {
      await this.executeStatusRefresh();
    });
  }

  // Deterministic Flow actions: "start the dryer" must leave the dryer running
  // whether it ran before or not, and must be a no-op the second time.
  async setFunctionState(functionKey, desired) {
    const fn = DETERMINISTIC_FUNCTIONS[functionKey];
    if (!fn) throw new Error(this.homey.__('error.unsupported_control'));

    // A stale reading would make the decision wrong, so the reported functions
    // are re-read first. The unreported one has nothing fresher to consult.
    if (fn.reported) {
      await this.refreshStatus({ keepWarm: true }).catch(error => {
        this.error('Could not refresh AquaClean state before a Flow action', error);
      });
    }

    const current = Boolean(this.getCapabilityValue(fn.status));
    if (current === desired) {
      this.log('AquaClean already in the requested state', {
        function: functionKey,
        desired
      });
      return;
    }
    await this.executeControlCapability(fn.button);
  }

  async executeControlCapability(capabilityId) {
    const command = CONTROL_CAPABILITY_COMMANDS[capabilityId];
    if (!command) {
      throw new Error(`Unsupported AquaClean control: ${capabilityId}`);
    }

    this.log('AquaClean control requested', {
      capabilityId,
      command: command.label,
      code: command.code
    });

    this._controlRequestsWaiting += 1;
    try {
      if (this._busy && this._activeOperation === 'refresh') {
        this._refreshPreemptRequested = true;
        const disconnectPromise = this.preemptActiveRefresh(command);
        await this.waitForIdle();
        await disconnectPromise;
        this._refreshPreemptRequested = false;
      }
      await this.runProtocolOperation({ command });
    } catch (error) {
      this.error(`AquaClean control failed: ${command.label}`, error);
      throw new Error(this.getUserErrorMessage(error));
    } finally {
      this._controlRequestsWaiting = Math.max(0, this._controlRequestsWaiting - 1);
      if (this._controlRequestsWaiting === 0) {
        this._refreshPreemptRequested = false;
      }
    }
  }

  getKeepWarmMilliseconds() {
    const seconds = Number(this.getSetting(KEEP_WARM_SETTING));
    if (!Number.isFinite(seconds) || seconds < 0) return KEEP_WARM_DEFAULT_MS;
    return Math.min(seconds * 1000, KEEP_WARM_MAX_MS);
  }

  getEditProfileId() {
    const stored = Number(this.getSetting(EDIT_PROFILE_SETTING));
    // Fall back to profile 0 — Grunninnstillinger, measured to be what the
    // toilet actually uses, and the default the settings page already shows.
    // The protocol library's DEFAULT_PROFILE_ID of 1 predates that discovery.
    return EDITABLE_PROFILE_IDS.includes(stored) ? stored : 0;
  }

  // Apps run in UTC on Homey. Without the user's timezone every timestamp the
  // device page shows is off by the local offset — two hours behind in summer.
  async loadHomeyTimezone() {
    try {
      if (this.homey.i18n && typeof this.homey.i18n.getLanguage === 'function') {
        this._language = this.homey.i18n.getLanguage() === 'no' ? 'no' : 'en';
      }
    } catch (error) {
      this.error('Could not read the Homey language', error.message);
    }
    try {
      if (!this.homey.clock || typeof this.homey.clock.getTimezone !== 'function') return;
      const result = await this.homey.clock.getTimezone();
      this._timeZone = typeof result === 'string' ? result : (result && result.timezone) || null;
      this.log('AquaClean timestamps use timezone', {
        timeZone: this._timeZone,
        language: this._language
      });
    } catch (error) {
      this.error('Could not read the Homey timezone', error.message);
    }
  }

  formatLocalTime(date, options) {
    const settings = { ...options };
    if (this._timeZone) settings.timeZone = this._timeZone;
    try {
      return date.toLocaleString('nb-NO', settings);
    } catch (error) {
      // An unknown timezone name must not cost us the timestamp entirely.
      return date.toLocaleString('nb-NO', options);
    }
  }

  async noteSettingSaved(settingId, value, profileId = null) {
    if (!this.hasCapability(LAST_WRITE_CAPABILITY)) return;

    const label = this.homey.__(`setting.${settingId}`) || settingId;
    const shown = typeof value === 'boolean'
      ? this.homey.__(value ? 'state.on' : 'state.off')
      : value;
    const where = profileId === null
      ? ''
      : ` (${this.homey.__('state.profile')} ${profileId})`;
    const time = this.formatLocalTime(new Date(), { hour: '2-digit', minute: '2-digit' });

    await this.setCapabilityValue(
      LAST_WRITE_CAPABILITY,
      `${label}: ${shown}${where}, ${this.homey.__('state.saved')} ${time}`
    ).catch(error => {
      this.error('Could not store the AquaClean save receipt', error.message);
    });
  }

  async pressProxyButton(settingId) {
    const { pattern, label } = PROXY_BUTTON_SETTINGS[settingId];
    this.log(`Asking the ESPHome proxy to ${label}`);

    // A restart takes the BLE link down with it, so let go of the session
    // rather than leaving a half-open one to time out later.
    await this.closeProtocolSession().catch(() => {});
    const pressed = await this.bleManager().pressProxyButton(pattern);
    this.log('Proxy button pressed', { button: pressed });
  }

  async executeFilterReset() {
    this.log('Resetting the AquaClean ceramic filter counter');
    await this.runProtocolOperation({
      command: {
        code: AQUACLEAN_COMMANDS.RESET_FILTER_COUNTER,
        label: 'reset filter counter'
      }
    });
    // The counter jumps back to a full year, so re-read it straight away.
    await this.refreshSettingsAndMaintenance().catch(error => {
      this.error('Filter status read after reset failed', error);
    });
  }

  // The lid calibration behind the toilet's own service menu, driven from the
  // repair view. Sent as a task rather than a command so the raw acknowledgement
  // comes back to the caller: these four codes come from the reference
  // implementation and have never been observed on the wire here, so the repair
  // view shows what the toilet actually answered instead of claiming success.
  //
  // Deliberately not a Flow card and not a capability. A saved lid offset is
  // not something an automation should be able to change by accident.
  async runLidCalibrationStep(step) {
    const code = LID_CALIBRATION_STEPS[step];
    if (code === undefined) throw new Error(`Unknown lid calibration step "${step}".`);

    this.log('AquaClean lid calibration step', { step, code });
    const result = await this.runProtocolOperation({
      // System parameter 7 is the service state, so the routine can be watched
      // rather than assumed: it says whether the toilet actually entered the
      // mode on start, and whether saving actually got it out again.
      task: async protocol => {
        const response = await protocol.executeCommand(code);
        let serviceState = null;
        try {
          ({ state: { serviceState = null } = {} } = await protocol.getSystemState([7]));
        } catch (error) {
          this.error('Service-state read after a calibration step failed', error);
        }
        return { response, serviceState };
      },
      taskLabel: `lid calibration ${step}`
    });

    const { response = null, serviceState = null } = result || {};
    this.log('AquaClean lid calibration acknowledged', { step, code, response, serviceState });
    return { step, code, response, serviceState };
  }

  async pollSettingsAndMaintenance() {
    if (this._deleted || this._busy) return;
    if (Date.now() - this._lastSettingsRefreshAt < SETTINGS_REFRESH_INTERVAL_MS) return;
    // A failed attempt waits its turn instead of retrying back-to-back, and an
    // unreachable toilet is left alone on the same backoff as the status poll.
    // User-triggered refreshes bypass this method entirely, so they are never
    // held back by either gate.
    if (Date.now() - this._lastSettingsAttemptAt < SETTINGS_RETRY_INTERVAL_MS) return;
    if (!this.isSessionReady() && Date.now() < this._nextReconnectAt) return;
    this._lastSettingsAttemptAt = Date.now();
    await this.refreshSettingsAndMaintenance({ keepWarm: false });
  }

  // keepWarm: false on the background path so a routine refresh does not hold
  // the toilet occupied afterwards. forceInformation re-reads the immutable
  // device information (identification, firmware, SOC) that is otherwise
  // served from the store — four round trips saved on every routine refresh.
  async refreshSettingsAndMaintenance({ keepWarm = true, forceInformation = false } = {}) {
    const cachedInformation = forceInformation
      ? null
      : this.getStoreValue('deviceInformation');

    const result = await this.runProtocolOperation({
      keepWarm,
      taskLabel: 'read settings, maintenance and device information',
      task: async protocol => {
        const profileId = this.getEditProfileId();
        const config = {};
        for (const [settingId, { setting }] of Object.entries(CONFIG_SETTINGS)) {
          config[settingId] = await protocol.getCommonSetting(setting.id);
        }
        for (const [settingId, { setting }] of Object.entries(PROFILE_CONFIG_SETTINGS)) {
          config[settingId] = await protocol.getProfileSetting(setting.id, profileId);
        }

        const descale = await protocol.getStatisticsDescale();
        const filter = await protocol.getFilterStatus();

        if (cachedInformation) {
          return { config, descale, filter, information: cachedInformation, informationFromCache: true };
        }

        // Identification never changes and firmware only after an update, so a
        // failure here must not lose the settings that were already read.
        const information = {};
        for (const [key, read] of [
          ['identification', () => protocol.getDeviceIdentification()],
          ['initialOperationDate', () => protocol.getInitialOperationDate()],
          ['socVersions', () => protocol.getSocVersions()],
          ['firmware', () => protocol.getFirmwareVersions()]
        ]) {
          try {
            information[key] = await read();
          } catch (error) {
            this.error('AquaClean device information read failed', {
              part: key,
              message: error.message
            });
          }
        }

        return { config, descale, filter, information, informationFromCache: false };
      }
    });

    if (!result) return null;
    this._lastSettingsRefreshAt = Date.now();

    // Cache only a complete read: caching a partial one would freeze the
    // missing fields as em-dashes forever.
    if (
      !result.informationFromCache
      && ['identification', 'initialOperationDate', 'socVersions', 'firmware']
        .every(key => result.information[key] !== undefined)
    ) {
      await this.setStoreValue('deviceInformation', result.information).catch(error => {
        this.error('Could not cache AquaClean device information', error.message);
      });
    }
    await this.noteProfileValuesRead(this.getEditProfileId(), true);
    await this.applyConfigSettings(result.config);
    await this.applyMaintenance(result.descale, result.filter);
    await this.applyDeviceInformation(result);
    this.log('AquaClean settings and maintenance read', {
      daysUntilDescaling: result.descale.daysUntilNextDescale,
      daysUntilFilter: result.filter.daysUntilFilterChange,
      firmware: result.information.firmware ? result.information.firmware.main : null
    });
    return result;
  }

  // Reflects what the toilet actually holds, so the settings page never shows
  // a value the device disagrees with.
  async applyConfigSettings(config) {
    if (typeof this.setSettings !== 'function' || !config) return;

    const updates = {};
    for (const [settingId, wireValue] of Object.entries(config)) {
      if (wireValue === null || wireValue === undefined) continue;
      const { kind } = configEntryFor(settingId);
      const value = fromWireConfigValue(kind, wireValue);
      if (this.getSetting(settingId) === value) continue;
      updates[settingId] = value;
    }

    if (!Object.keys(updates).length) return;
    // setSettings() from code does not fire onSettings, so this cannot loop.
    await this.setSettings(updates).catch(error => {
      this.error('Could not store AquaClean configuration', error.message);
    });
    this.log('AquaClean configuration read from device', updates);
  }

  // profileIdOverride matters when the profile is switched in the same save as
  // the setting: getSetting() still reports the profile being left behind, so
  // the value would land there instead of in the one just chosen.
  async writeConfigSetting(settingId, value, profileIdOverride = null) {
    const entry = configEntryFor(settingId);
    if (!entry) throw new Error(this.homey.__('error.unknown_setting'));

    const wireValue = toWireConfigValue(entry.kind, value);
    if (
      !Number.isInteger(wireValue)
      || wireValue < entry.setting.min
      || wireValue > entry.setting.max
    ) {
      throw new Error(translate(this.homey, 'error.out_of_range', {
        setting: this.homey.__(`setting.${settingId}`) || settingId,
        min: entry.setting.min,
        max: entry.setting.max,
        value
      }));
    }

    // A profile setting is stored per profile, so it goes to the one the page
    // is editing rather than to the toilet as a whole.
    const profileId = settingId in PROFILE_CONFIG_SETTINGS
      ? (profileIdOverride === null ? this.getEditProfileId() : profileIdOverride)
      : null;
    this.log('Writing AquaClean configuration', { settingId, value: wireValue, profileId });
    await this.runProtocolOperation({
      taskLabel: settingId,
      task: async protocol => {
        if (profileId !== null) {
          await protocol.setProfileSetting(entry.setting.id, wireValue, profileId);
          const kept = await protocol.getProfileSetting(entry.setting.id, profileId);
          if (kept !== wireValue) {
            throw new Error(translate(this.homey, 'error.not_kept_profile', {
              stored: kept, profile: profileId, value: wireValue
            }));
          }
          return kept;
        }

        // setCommonSetting writes the live value and the stored one, then
        // reads back — a silent no-op would otherwise look like success.
        const stored = await protocol.setCommonSetting(entry.setting.id, wireValue);
        if (stored !== wireValue) {
          throw new Error(translate(this.homey, 'error.not_kept', {
            stored, value: wireValue
          }));
        }
        return stored;
      }
    });

    await this.noteSettingSaved(
      settingId,
      entry.kind === 'checkbox' ? Boolean(wireValue) : wireValue,
      profileId
    );
  }

  // The device page stays uncluttered; this lives behind the gear icon.
  async applyDeviceInformation({ descale, filter, information }) {
    if (typeof this.setSettings !== 'function') return;

    const identification = information.identification || {};
    const firmware = information.firmware || {};
    const asDate = seconds => (seconds
      ? this.formatLocalTime(new Date(seconds * 1000), {
        day: '2-digit', month: '2-digit', year: 'numeric'
      })
      : '—');
    const text = value => (value === null || value === undefined || value === ''
      ? '—'
      : String(value));

    const labels = {
      info_model: text(identification.description),
      info_serial_number: text(identification.serialNumber),
      info_sap_number: text(identification.sapNumber),
      info_production_date: text(identification.productionDate),
      info_initial_operation_date: text(information.initialOperationDate),
      info_firmware: text(firmware.main),
      info_soc_versions: text(information.socVersions),
      info_last_descale: asDate(descale && descale.lastDescaleAt),
      info_descale_cycles: text(descale && descale.numberOfDescaleCycles),
      info_last_filter_change: asDate(filter && filter.lastFilterChangeAt),
      info_filter_changes: text(filter && filter.filterChangeCount)
    };

    // Only write what changed. info_read_at would differ every time, so it is
    // excluded from the comparison and refreshed only when something real did
    // change — most routine refreshes now write no settings at all.
    const updates = {};
    for (const [key, value] of Object.entries(labels)) {
      if (typeof this.getSetting === 'function' && this.getSetting(key) === value) continue;
      updates[key] = value;
    }
    if (!Object.keys(updates).length) return;
    updates.info_read_at = this.formatLocalTime(new Date());

    await this.setSettings(updates).catch(error => {
      this.error('Could not store AquaClean device information', error.message);
    });
  }

  // The sliders are only trustworthy once they have been re-read from the
  // profile now selected. Until then they still show the previous profile's
  // values, and there is nothing on screen to say so.
  async noteProfileValuesRead(profileId, ok) {
    if (typeof this.setSettings !== 'function') return;
    const time = this.formatLocalTime(new Date(), { hour: '2-digit', minute: '2-digit' });
    const label = profileId === 0
      ? this.homey.__('state.base_settings')
      : translate(this.homey, 'state.profile_n', { n: profileId });
    await this.setSettings({
      profile_values_read: ok
        ? `${label} — ${this.homey.__('state.read')} ${time}`
        : `${label} — ${this.homey.__('state.read_failed')} ${time}, ${this.homey.__('state.do_not_trust')}`
    }).catch(error => {
      this.error('Could not store which profile the sliders show', error.message);
    });
  }

  async applyMaintenance(descale, filter) {
    const values = {
      aquaclean_days_until_descaling: descale ? descale.daysUntilNextDescale : null,
      aquaclean_days_until_filter: filter ? filter.daysUntilFilterChange : null
    };
    const triggerIds = {
      aquaclean_days_until_descaling: 'aquaclean_days_until_descaling_below',
      aquaclean_days_until_filter: 'aquaclean_days_until_filter_below'
    };

    for (const [capabilityId, value] of Object.entries(values)) {
      if (!this.hasCapability(capabilityId)) continue;
      if (!Number.isFinite(value)) continue;
      const previous = this.getCapabilityValue(capabilityId);
      if (previous === value) continue;
      await this.setCapabilityValue(capabilityId, value).catch(error => {
        this.error('Could not store AquaClean maintenance value', {
          capabilityId,
          message: error.message
        });
      });

      // The card's run listener decides per flow whether the user's threshold
      // was crossed on the way DOWN — previous and current travel as state. A
      // fresh install (previous null) fires nothing: no crossing was seen.
      if (!Number.isFinite(previous) || value >= previous) continue;
      try {
        await this.homey.flow.getDeviceTriggerCard(triggerIds[capabilityId])
          .trigger(this, { days: value }, { previous, current: value });
      } catch (error) {
        this.error('AquaClean maintenance trigger failed', {
          capabilityId,
          message: error.message
        });
      }
    }
  }

  // What the repair screen shows: the current fault, read fresh where possible.
  // A failed read is reported as such rather than silently downgraded to the
  // cached value — "no error" and "could not ask" are different answers, and
  // only one of them means the toilet is fine.
  async getErrorStatus({ refresh = true } = {}) {
    let stale = false;
    if (refresh) {
      try {
        if (this._busy) await this.waitForIdle();
        await this.refreshStatus({ keepWarm: true });
      } catch (error) {
        stale = true;
        this.error('Could not refresh the AquaClean status for the repair view', error.message);
      }
    }

    const raw = this.hasCapability('aquaclean_error_code')
      ? this.getCapabilityValue('aquaclean_error_code')
      : null;
    const described = formatErrorCode(raw, this._language);

    return {
      known: described !== null,
      stale,
      code: described ? Number(raw) : null,
      hex: described ? described.hex : null,
      description: described ? described.description : null,
      updatedAt: this.hasCapability('aquaclean_last_status_update')
        ? this.getCapabilityValue('aquaclean_last_status_update')
        : null
    };
  }

  async executeStatusRefresh() {
    this.log('Manual AquaClean status refresh requested');
    try {
      if (this._busy) await this.waitForIdle();
      await this.refreshStatus({ keepWarm: true });
    } catch (error) {
      this.error('Manual AquaClean status refresh failed', error);
      throw new Error(this.getUserErrorMessage(error));
    }
  }

  async pollStatus() {
    if (this._busy || this._deleted || this._controlRequestsWaiting > 0) return;
    const pollInterval = this.getStatusPollIntervalMilliseconds();
    if (
      Date.now() - this._lastBackgroundPollFinishedAt
      < pollInterval
    ) {
      return;
    }
    if (!this.isSessionReady() && Date.now() < this._nextReconnectAt) return;

    try {
      await this.refreshLiveStatus();
    } catch (error) {
      if (!isRefreshPreemptedError(error)) {
        await this.handleRefreshFailure('AquaClean status poll failed', error);
      }
    } finally {
      this._lastBackgroundPollFinishedAt = Date.now();
    }
  }

  getStatusPollIntervalMilliseconds() {
    const activityIsKnown = ACTIVE_STATUS_CAPABILITY_IDS.some(capabilityId =>
      Boolean(this.getCapabilityValue(capabilityId)));
    return activityIsKnown
      ? this.getPollIntervalSetting(ACTIVE_POLL_SETTING, ACTIVE_STATUS_POLL_INTERVAL_MS)
      : this.getPollIntervalSetting(IDLE_POLL_SETTING, IDLE_STATUS_POLL_INTERVAL_MS);
  }

  getPollIntervalSetting(settingId, fallbackMs) {
    const seconds = Number(this.getSetting(settingId));
    if (!Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
    const milliseconds = seconds * 1000;
    if (milliseconds < POLL_SCHEDULER_INTERVAL_MS) return POLL_SCHEDULER_INTERVAL_MS;
    return Math.min(milliseconds, POLL_INTERVAL_MAX_MS);
  }

  async refreshStatus({ keepWarm = false } = {}) {
    return this.runProtocolOperation({
      parameterIds: SYSTEM_PARAMETER_IDS,
      stateScope: 'full',
      keepWarm
    });
  }

  async refreshLiveStatus() {
    return this.runProtocolOperation({
      parameterIds: [0, 1, 2, 3],
      stateScope: 'live',
      skipIfBusy: true
    });
  }

  // task lets a caller run arbitrary protocol work inside the same session
  // machinery the commands and status reads already use — retries, keep-warm
  // and cleanup all behave identically. Used for settings and maintenance.
  async runProtocolOperation({
    command = null,
    task = null,
    taskLabel = 'settings',
    parameterIds = SYSTEM_PARAMETER_IDS,
    stateScope = 'full',
    // Anything you triggered yourself holds the session open afterwards.
    // Background polls ride along on a warm session but never extend it, so
    // the toilet is released once you stop touching it.
    keepWarm = Boolean(command || task),
    skipIfBusy = false
  } = {}) {
    if (this._deleted) {
      throw new Error(this.homey.__('error.deleted'));
    }

    if (this._busy) {
      if (command && this._activeOperation === 'refresh') {
        this._refreshPreemptRequested = true;
        const disconnectPromise = this.preemptActiveRefresh(command);
        await this.waitForIdle();
        await disconnectPromise;
        this._refreshPreemptRequested = false;
        return this.runProtocolOperation({ command });
      }

      if (command && this._activeOperation === 'control') {
        // Most of these commands toggle, so pressing the same button again is
        // a deliberate second flip — turning odour extraction off and then on
        // is exactly that. Only a repeat arriving within a few hundred
        // milliseconds is treated as one press counted twice.
        const isImmediateRepeat = command.code === this._activeCommandCode
          && Date.now() - this._activeCommandStartedAt < DUPLICATE_COMMAND_WINDOW_MS;

        if (isImmediateRepeat) {
          this.log('Ignoring an immediate repeat of the same AquaClean command', {
            command: command.label
          });
          return null;
        }

        this.log('AquaClean control queued behind another in-flight command', {
          command: command.label
        });
        await this.waitForIdle();
        return this.runProtocolOperation({ command });
      }

      // A button pressed while a slider write or the maintenance read is in
      // flight used to fall straight through to the error below. Settings work
      // is short now that the handshake is gone, so the command waits it out
      // rather than failing in the user's face.
      if (command && this._activeOperation === 'settings') {
        this.log('AquaClean control queued behind settings work', { command: command.label });
        await this.waitForIdle();
        return this.runProtocolOperation({ command });
      }

      if (task) {
        this.log('AquaClean settings work queued behind another request', { taskLabel });
        await this.waitForIdle();
        return this.runProtocolOperation({ task, taskLabel });
      }

      // A background poll that arrives mid-operation has nothing to add: the
      // operation under way reads the state anyway. Reporting it as a Bluetooth
      // failure would put a bogus error on the device page.
      if (skipIfBusy) return null;

      const error = new Error('The AquaClean is already handling another Bluetooth request.');
      error.code = 'AQUACLEAN_BUSY';
      throw error;
    }

    this._busy = true;
    this._activeOperation = command ? 'control' : task ? 'settings' : 'refresh';
    this._activeCommandCode = command ? command.code : null;
    this._activeCommandStartedAt = Date.now();
    const startedAt = Date.now();
    let lastError;
    let commandAttempted = false;
    let operationSucceeded = false;
    let taskResult;

    try {
      for (
        let sessionAttempt = 1;
        sessionAttempt <= PROTOCOL_SESSION_ATTEMPTS;
        sessionAttempt += 1
      ) {
        let session = null;
        try {
          session = await this.ensureProtocolSession();
          let commandResponse = null;
          let state = null;

          if (command) {
            commandAttempted = true;
            commandResponse = await session.protocol.executeCommand(command.code);
            try {
              await wait(this.homey, COMMAND_STATE_SETTLE_MS);
              ({ state } = await session.protocol.getSystemState([0, 1, 2, 3]));
              state = this.mapConfiguredShowerState(state);
              stateScope = 'live';
            } catch (statusError) {
              // The command was already acknowledged. Do not report it as
              // failed if Mera resets BLE before the follow-up state read.
              this.error('Post-command AquaClean live-status read failed', statusError);
              state = null;
            }
          } else if (task) {
            taskResult = await task(session.protocol);
            // A settings write only lands in the device's stored profile, so
            // the live state is read afterwards to keep the page consistent.
            try {
              ({ state } = await session.protocol.getSystemState([0, 1, 2, 3]));
              state = this.mapConfiguredShowerState(state);
              stateScope = 'live';
            } catch (statusError) {
              this.error('Post-settings AquaClean live-status read failed', statusError);
              state = null;
            }
          } else {
            ({ state } = await session.protocol.getSystemState(parameterIds));
            state = this.mapConfiguredShowerState(state);
          }

          await this.storeOperationResult({
            session,
            command,
            commandResponse,
            state,
            stateScope,
            startedAt
          });
          if (
            command
            && (
              !state
              || command.code === AQUACLEAN_COMMANDS.TOGGLE_ODOUR_EXTRACTION
              || command.code === AQUACLEAN_COMMANDS.ODOUR_EXTRACTION_RUN_ON
            )
          ) {
            await this.applyOptimisticCommandState(command);
          }
          this._reconnectFailures = 0;
          this._nextReconnectAt = 0;
          this._breakerStage = 0;
          await this.setConnectionState('connected');
          await this.setConnectionError(null);
          await this.setAvailable();
          operationSucceeded = true;
          return taskResult;
        } catch (error) {
          lastError = error;
          if (isRefreshPreemptedError(error)) {
            this.log('AquaClean status refresh stopped for a waiting control');
            break;
          }
          if (commandAttempted) {
            error.aquacleanCommandAttempted = true;
          }
          this.error(
            `AquaClean operation attempt ${sessionAttempt}/${PROTOCOL_SESSION_ATTEMPTS} failed`,
            error,
          );

          if (commandAttempted || sessionAttempt === PROTOCOL_SESSION_ATTEMPTS) {
            break;
          }
          await wait(this.homey, sessionAttempt * 1000);
        } finally {
          if (
            session
            && (this._session === session || session.ready)
          ) {
            const sessionIsKeptWarm = session.ready
              && typeof session.keepWarmUntil === 'number'
              && Date.now() < session.keepWarmUntil;
            const keepWarmMs = this.getKeepWarmMilliseconds();
            if (
              keepWarm
              && keepWarmMs > 0
              && operationSucceeded
              && session.ready
              && !this._deleted
            ) {
              session.keepWarmUntil = Date.now() + keepWarmMs;
            } else if (!(operationSucceeded && sessionIsKeptWarm)) {
              await this.closeProtocolSession(session).catch(error => {
                this.error('On-demand AquaClean BLE cleanup failed', error);
              });
              if (operationSucceeded && !this._deleted) {
                await this.setConnectionState('ready').catch(error => {
                  this.error('Could not mark on-demand Bluetooth as ready', error);
                });
              }
            }
          }
        }
      }

      throw lastError;
    } finally {
      this._busy = false;
      this._activeOperation = null;
      for (const waiter of this._idleWaiters.splice(0)) {
        this.homey.clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
  }

  async ensureProtocolSession() {
    if (this.isSessionReady()) return this._session;
    if (this._session) await this.closeProtocolSession();
    if (this.getCapabilityValue('aquaclean_connection_state') !== 'connected') {
      await this.setConnectionState('reconnecting');
    }

    let peripheralUuid = this.getStoreValue('peripheralUuid') || this.getData().id;
    const advertisement = await this.findFreshAdvertisement(
      peripheralUuid,
      { forceScan: this._forceFreshScan },
    );
    this._forceFreshScan = false;
    peripheralUuid = advertisement.uuid;

    if (typeof advertisement.rssi === 'number' && this.hasCapability('measure_signal_strength')) {
      await this.setCapabilityValue('measure_signal_strength', advertisement.rssi);
    }

    const peripheral = await this.connectWithRetry(advertisement, peripheralUuid);
    await this.setStoreValue('peripheralUuid', peripheralUuid);

    try {
      const services = await this.discoverProtocolGatt(peripheral);
      return await this.openProtocolSession(peripheral, services);
    } catch (error) {
      if (isStaleBleObjectError(error)) {
        this._forceFreshScan = true;
      }
      await withTimeout(
        this.homey,
        () => peripheral.disconnect(),
        BLE_CLEANUP_TIMEOUT_MS,
        'BLE disconnect after setup failure',
      ).catch(disconnectError => {
        this.error('BLE disconnect after setup failure failed', disconnectError);
      });
      throw error;
    }
  }

  async discoverProtocolGatt(peripheral) {
    const startedAt = Date.now();
    const discoveredServices = await withTimeout(
      this.homey,
      () => peripheral.discoverServices([GEBERIT_GATT_SERVICE_UUID]),
      BLE_DISCOVERY_TIMEOUT_MS,
      'AquaClean GATT service discovery',
    );
    const service = discoveredServices.find(candidate =>
      normalizeUuid(candidate.uuid) === GEBERIT_GATT_SERVICE_UUID);
    if (!service) {
      throw new Error(this.homey.__('error.service_missing'));
    }

    this.log('AquaClean GATT service discovered', {
      milliseconds: Date.now() - startedAt
    });

    const requiredCharacteristicUuids = [
      ...WRITE_CHARACTERISTIC_UUIDS,
      ...READ_CHARACTERISTIC_UUIDS
    ];
    const characteristics = await withTimeout(
      this.homey,
      () => service.discoverCharacteristics(requiredCharacteristicUuids),
      BLE_DISCOVERY_TIMEOUT_MS,
      'AquaClean GATT characteristic discovery',
    );

    this.log('AquaClean GATT characteristics discovered', {
      milliseconds: Date.now() - startedAt,
      count: characteristics.length
    });

    return [{
      uuid: service.uuid,
      characteristics
    }];
  }

  async openProtocolSession(peripheral, services) {
    const service = services.find(candidate =>
      normalizeUuid(candidate.uuid) === GEBERIT_GATT_SERVICE_UUID);
    if (!service) {
      throw new Error(this.homey.__('error.service_missing'));
    }

    const characteristics = new Map(
      (service.characteristics || []).map(characteristic => [
        normalizeUuid(characteristic.uuid),
        characteristic
      ]),
    );
    const missing = [...WRITE_CHARACTERISTIC_UUIDS, ...READ_CHARACTERISTIC_UUIDS]
      .filter(uuid => !characteristics.has(uuid));
    if (missing.length > 0) {
      throw new Error(translate(this.homey, 'error.gatt_incomplete', { missing: missing.join(', ') }));
    }

    const writeCharacteristics = WRITE_CHARACTERISTIC_UUIDS
      .map(uuid => characteristics.get(uuid));
    const readCharacteristics = READ_CHARACTERISTIC_UUIDS
      .map(uuid => characteristics.get(uuid));
    const protocol = new AquaCleanProtocol({
      writePrimary: data => writeCharacteristics[0].write(data),
      writeContinuation: (data, index) => writeCharacteristics[index].write(data),
      // Every BLE frame in both directions used to be logged unconditionally —
      // 6-10 lines per poll, forever. Frame-level logging is now opt-in.
      log: (direction, value) => {
        if (this.getSetting(DEBUG_FRAME_LOGGING_SETTING)) {
          this.log(`AquaClean ${direction}`, value);
        }
      }
    });
    const session = {
      peripheral,
      protocol,
      readCharacteristics,
      ready: false,
      openedAt: new Date().toISOString()
    };
    this._session = session;

    peripheral.once('disconnect', () => {
      this.handlePeripheralDisconnect(session);
    });

    try {
      if (this._refreshPreemptRequested && this._activeOperation === 'refresh') {
        throw makeRefreshPreemptedError();
      }

      for (const characteristic of readCharacteristics) {
        const uuid = normalizeUuid(characteristic.uuid);
        await withTimeout(
          this.homey,
          () => characteristic.subscribeToNotifications(data => {
            protocol.queueNotification(uuid, data).catch(error => {
              this.error('AquaClean notification processing failed', error);
            });
          }),
          BLE_SUBSCRIBE_TIMEOUT_MS,
          `AquaClean notification subscribe (${uuid})`,
        );
      }

      // initializeSession() subscribes to parameter changes with 0x11/0x13 and
      // costs about 4.3 seconds. Those subscriptions only pay off on a session
      // that stays open to receive pushes — this one is torn down again, and
      // the app polls regardless. Measured against the toilet: status reads,
      // profile and common settings, statistics, filter status and commands
      // all work without it. Dropping it took a request from 6.3 s to 1.9 s,
      // which is what frees the physical remote between polls.
      await wait(this.homey, INFO_FRAME_SETTLE_MS);
      session.ready = true;
      this.log('On-demand AquaClean protocol session ready');
      return session;
    } catch (error) {
      await this.closeProtocolSession(session);
      throw error;
    }
  }

  isSessionReady() {
    const session = this._session;
    if (!session || !session.ready || !session.peripheral) return false;

    try {
      return Boolean(session.peripheral.isConnected);
    } catch (error) {
      session.ready = false;
      session.protocol.close(error);
      this._session = null;
      this._forceFreshScan = true;
      this.error('AquaClean BLE object became stale; forcing rediscovery', error);
      return false;
    }
  }

  handlePeripheralDisconnect(session) {
    if (this._session !== session) return;

    session.ready = false;
    session.protocol.close(new Error('The AquaClean BLE connection was lost.'));
    this._session = null;
    this._forceFreshScan = true;
    this._nextReconnectAt = Date.now() + DISCONNECT_RECONNECT_DELAY_MS;
    this.setConnectionState('reconnecting').catch(error => this.error(error));
    this.log('AquaClean disconnected; reconnect will be attempted automatically');
  }

  preemptActiveRefresh(command) {
    this.log(`Giving BLE priority to ${command.label}`);
    const session = this._session;
    if (!session || this._activeOperation !== 'refresh') {
      return Promise.resolve();
    }

    if (this._session === session) this._session = null;
    session.ready = false;
    session.protocol.close(makeRefreshPreemptedError());
    this._forceFreshScan = true;
    this._nextReconnectAt = 0;

    try {
      return withTimeout(
        this.homey,
        () => session.peripheral.disconnect(),
        BLE_CLEANUP_TIMEOUT_MS,
        'BLE disconnect while prioritizing control',
      ).catch(error => {
        this.error('BLE disconnect while prioritizing control failed', error);
      });
    } catch (error) {
      this.error('BLE disconnect while prioritizing control failed', error);
      return Promise.resolve();
    }
  }

  async closeExpiredKeepWarmSession() {
    const session = this._session;
    if (
      !session
      || this._busy
      || typeof session.keepWarmUntil !== 'number'
      || Date.now() < session.keepWarmUntil
    ) {
      return;
    }
    await this.closeProtocolSession(session).catch(error => {
      this.error('Keep-warm AquaClean BLE cleanup failed', error);
    });
    if (!this._deleted) {
      await this.setConnectionState('ready').catch(error => {
        this.error('Could not mark on-demand Bluetooth as ready', error);
      });
    }
  }

  async closeProtocolSession(targetSession = this._session) {
    if (!targetSession) return;
    if (this._session === targetSession) this._session = null;

    targetSession.ready = false;
    targetSession.protocol.close();

    if (targetSession.peripheral) {
      for (const characteristic of targetSession.readCharacteristics || []) {
        await withTimeout(
          this.homey,
          () => characteristic.unsubscribeFromNotifications(),
          BLE_CLEANUP_TIMEOUT_MS,
          `BLE notification unsubscribe ${normalizeUuid(characteristic.uuid)}`,
        ).catch(error => {
          this.error('BLE notification unsubscribe failed', {
            characteristicUuid: normalizeUuid(characteristic.uuid),
            message: error.message
          });
        });
      }
      await withTimeout(
        this.homey,
        () => targetSession.peripheral.disconnect(),
        BLE_CLEANUP_TIMEOUT_MS,
        'BLE disconnect',
      ).catch(error => {
        this.error('BLE disconnect failed', error);
      });
    }
  }

  async storeOperationResult({
    session,
    command,
    commandResponse,
    state,
    stateScope,
    startedAt
  }) {
    // A 20-25 KB `lastProtocolCapture` snapshot used to be persisted here on
    // every operation — every 2.5 s during activity — and was never read back.
    // On a Homey already under memory pressure that was the app's single
    // largest recurring cost. Only the two state snapshots that are actually
    // consumed elsewhere survive.
    const capturedAt = new Date().toISOString();
    if (state && stateScope === 'full') {
      await this.setStoreValue('lastSystemState', state);
      await this.applySystemState(state);
    } else if (state && stateScope === 'live') {
      await this.setStoreValue('lastLiveState', state);
      await this.applyLiveState(state);
    }
    if (state) await this.updateLastStatusHeartbeat(capturedAt);

    // Routine polls that saw nothing new stay quiet: at 30 s cadence the old
    // unconditional line was ~3 000 identical log entries a day. Commands and
    // changed state always log; the debug switch restores the full stream.
    const stateFingerprint = state ? JSON.stringify(state.parameters) : null;
    const stateChanged = stateFingerprint !== this._lastLoggedStateFingerprint;
    if (command || stateChanged || this.getSetting(DEBUG_FRAME_LOGGING_SETTING)) {
      this._lastLoggedStateFingerprint = stateFingerprint;
      this.log('AquaClean operation complete', {
        command: command ? command.label : null,
        commandStatus: commandResponse ? commandResponse.status : undefined,
        durationMilliseconds: Date.now() - startedAt,
        stateScope,
        systemState: state
      });
    }
  }

  getAnalStatusParameterId() {
    const configuredValue = typeof this.getSetting === 'function'
      ? String(this.getSetting('anal_status_parameter') || '1')
      : '1';
    return configuredValue === '3' ? 3 : 1;
  }

  mapConfiguredShowerState(state) {
    if (!state || !state.parameters) return state;

    const analStatusParameterId = this.getAnalStatusParameterId();
    const analStatusValue = state.parameters[analStatusParameterId];
    const ladyStatusValue = state.parameters[2];

    return {
      ...state,
      analShowerIsRunning: analStatusValue === undefined
        ? state.analShowerIsRunning
        : analStatusValue !== 0,
      ladyShowerIsRunning: ladyStatusValue === undefined
        ? state.ladyShowerIsRunning
        : ladyStatusValue !== 0
    };
  }

  formatRawLiveStatus(state) {
    const parameters = state && state.parameters ? state.parameters : {};
    const storedState = typeof this.getStoreValue === 'function'
      ? this.getStoreValue('lastSystemState')
      : null;
    const storedParameters = storedState && storedState.parameters
      ? storedState.parameters
      : {};
    return [0, 1, 2, 3, 4, 5, 6, 7]
      .map(parameterId => {
        const value = parameters[parameterId] === undefined
          ? storedParameters[parameterId]
          : parameters[parameterId];
        return `P${parameterId}=${value === undefined ? '?' : value}`;
      })
      .join(' ');
  }

  async applyRawLiveStatus(state) {
    const capabilityId = 'aquaclean_raw_status';
    if (!this.hasCapability(capabilityId)) return;
    await this.setStatusCapabilityValue(
      capabilityId,
      this.formatRawLiveStatus(state),
    );
  }

  async applyLiveState(state) {
    await this.applyRawLiveStatus(state);
    const previousUserSitting = this.getCapabilityValue('aquaclean_user_sitting');
    const values = {
      aquaclean_user_sitting: state.userIsSitting,
      aquaclean_anal_shower_running: state.analShowerIsRunning,
      aquaclean_lady_shower_running: state.ladyShowerIsRunning,
      aquaclean_dryer_running: state.dryerIsRunning
    };

    for (const [capabilityId, value] of Object.entries(values)) {
      if (
        value !== null
        && value !== undefined
        && this.hasCapability(capabilityId)
      ) {
        const normalizedValue = Boolean(value);
        const optimisticUntil = this._optimisticStateUntil.get(capabilityId) || 0;
        const currentValue = Boolean(this.getCapabilityValue(capabilityId));

        if (optimisticUntil > Date.now() && normalizedValue !== currentValue) {
          this.log('Ignoring stale function state during command transition', {
            capabilityId,
            normalizedValue,
            optimisticUntil
          });
          continue;
        }

        if (normalizedValue === currentValue) {
          this._optimisticStateUntil.delete(capabilityId);
        }
        await this.setStatusCapabilityValue(capabilityId, normalizedValue);
      }
    }
    await this.applyAutomaticOdourState(
      state.userIsSitting,
      previousUserSitting,
    );
  }

  isAutomaticOdourTrackingEnabled() {
    if (typeof this.getSetting !== 'function') return true;
    return this.getSetting('odour_auto_tracking') !== false;
  }

  getOdourRunOnMilliseconds() {
    if (typeof this.getSetting !== 'function') {
      return DEFAULT_ODOUR_RUN_ON_SECONDS * 1000;
    }
    const configuredValue = this.getSetting('odour_run_on_seconds');
    if (configuredValue === null || configuredValue === undefined) {
      return DEFAULT_ODOUR_RUN_ON_SECONDS * 1000;
    }
    const seconds = Number(configuredValue);
    return Number.isFinite(seconds)
      ? Math.max(0, seconds) * 1000
      : DEFAULT_ODOUR_RUN_ON_SECONDS * 1000;
  }

  clearOdourRunOnTimer() {
    if (!this._odourRunOnTimer) return;
    this.homey.clearTimeout(this._odourRunOnTimer);
    this._odourRunOnTimer = null;
  }

  async scheduleOdourExtractionOff(delayMilliseconds) {
    this.clearOdourRunOnTimer();
    if (delayMilliseconds <= 0) {
      if (this.hasCapability('aquaclean_odour_extraction_running')) {
        await this.setStatusCapabilityValue(
          'aquaclean_odour_extraction_running',
          false,
        );
      }
      return;
    }

    this._odourRunOnTimer = this.homey.setTimeout(() => {
      this._odourRunOnTimer = null;
      if (
        this._deleted
        || Boolean(this.getCapabilityValue('aquaclean_user_sitting'))
        || !this.hasCapability('aquaclean_odour_extraction_running')
      ) {
        return;
      }
      this.setStatusCapabilityValue(
        'aquaclean_odour_extraction_running',
        false,
      ).catch(error => {
        this.error('Could not finish AquaClean odour run-on status', error);
      });
    }, delayMilliseconds);
  }

  async applyAutomaticOdourState(userIsSitting, previousUserIsSitting) {
    if (
      !this.isAutomaticOdourTrackingEnabled()
      || userIsSitting === null
      || userIsSitting === undefined
      || !this.hasCapability('aquaclean_odour_extraction_running')
    ) {
      return;
    }

    const isSitting = Boolean(userIsSitting);
    if (isSitting && previousUserIsSitting !== true) {
      this.clearOdourRunOnTimer();
      await this.setStatusCapabilityValue(
        'aquaclean_odour_extraction_running',
        true,
      );
      return;
    }

    if (!isSitting && previousUserIsSitting === true) {
      await this.scheduleOdourExtractionOff(this.getOdourRunOnMilliseconds());
      return;
    }

    if (
      !isSitting
      && this.getCapabilityValue('aquaclean_odour_extraction_running') === null
    ) {
      await this.setStatusCapabilityValue(
        'aquaclean_odour_extraction_running',
        false,
      );
    }
  }

  async applyOptimisticCommandState(command) {
    const toggleCapabilities = new Map([
      [AQUACLEAN_COMMANDS.TOGGLE_ANAL_SHOWER, 'aquaclean_anal_shower_running'],
      [AQUACLEAN_COMMANDS.TOGGLE_LADY_SHOWER, 'aquaclean_lady_shower_running'],
      [
        AQUACLEAN_COMMANDS.TOGGLE_ODOUR_EXTRACTION,
        'aquaclean_odour_extraction_running'
      ]
    ]);
    const capabilityId = toggleCapabilities.get(command.code);

    if (capabilityId && this.hasCapability(capabilityId)) {
      if (capabilityId === 'aquaclean_odour_extraction_running') {
        this.clearOdourRunOnTimer();
      }
      const currentValue = Boolean(this.getCapabilityValue(capabilityId));
      this._optimisticStateUntil.set(
        capabilityId,
        Date.now() + OPTIMISTIC_FUNCTION_STATE_HOLD_MS,
      );
      await this.setStatusCapabilityValue(capabilityId, !currentValue);
    }

    if (
      command.code === AQUACLEAN_COMMANDS.ODOUR_EXTRACTION_RUN_ON
      && this.hasCapability('aquaclean_odour_extraction_running')
    ) {
      await this.setStatusCapabilityValue(
        'aquaclean_odour_extraction_running',
        true,
      );
      await this.scheduleOdourExtractionOff(this.getOdourRunOnMilliseconds());
    }

    if (command.code === AQUACLEAN_COMMANDS.STOP) {
      for (const functionCapability of [
        'aquaclean_anal_shower_running',
        'aquaclean_lady_shower_running',
        'aquaclean_odour_extraction_running'
      ]) {
        if (this.hasCapability(functionCapability)) {
          this._optimisticStateUntil.delete(functionCapability);
          await this.setStatusCapabilityValue(functionCapability, false);
        }
      }
    }
  }

  async applySystemState(state) {
    await this.applyRawLiveStatus(state);
    const previousUserSitting = this.getCapabilityValue('aquaclean_user_sitting');
    const values = {
      aquaclean_user_sitting: Boolean(state.userIsSitting),
      aquaclean_anal_shower_running: Boolean(state.analShowerIsRunning),
      aquaclean_lady_shower_running: Boolean(state.ladyShowerIsRunning),
      // SPL parameter 3, confirmed live: it flips on Toggle dryer and back on Stop.
      ...(state.dryerIsRunning === null
        ? {}
        : { aquaclean_dryer_running: Boolean(state.dryerIsRunning) }),
      aquaclean_descaling_state: DESCALING_STATES[state.descalingState] || 'unknown',
      // SPL parameter 6, AC_STATUS_LAST_ERROR. Only a read that actually
      // carried the parameter may change this value: coercing a missing read
      // to 0 used to fabricate an "error cleared" transition out of thin air,
      // wiping the one clue a failing lid leaves behind. The Insights history
      // built on this capability is only as truthful as this guard.
      ...(Number.isFinite(state.lastErrorCode)
        ? {
          aquaclean_error_code: state.lastErrorCode,
          // The manual's own notation (040B) plus its description of what is
          // wrong, in the user's language. Same guard as the number: only a
          // read that carried the parameter may change it.
          aquaclean_error_text: formatErrorCode(state.lastErrorCode, this._language).text
        }
        : {})
    };

    for (const [capabilityId, value] of Object.entries(values)) {
      if (this.hasCapability(capabilityId)) {
        await this.setStatusCapabilityValue(capabilityId, value);
      }
    }
    await this.applyAutomaticOdourState(
      state.userIsSitting,
      previousUserSitting,
    );
  }

  async updateLastStatusHeartbeat(capturedAt = new Date().toISOString()) {
    const capabilityId = 'aquaclean_last_status_update';
    if (!this.hasCapability(capabilityId)) return;

    const capturedDate = new Date(capturedAt);
    const capturedMilliseconds = capturedDate.getTime();
    if (!Number.isFinite(capturedMilliseconds)) return;
    if (
      this._lastStatusHeartbeatAt
      && capturedMilliseconds - this._lastStatusHeartbeatAt
        < STATUS_HEARTBEAT_INTERVAL_MS
    ) {
      return;
    }
    this._lastStatusHeartbeatAt = capturedMilliseconds;

    // The timezone was resolved once at init; asking Homey again on every
    // heartbeat (an awaited IPC call plus a fresh Intl.DateTimeFormat) was
    // pure overhead on a code path that runs at least every 15 seconds.
    // No seconds: the full string was too wide for the sensor tile in the
    // mobile app and got truncated. The heartbeat is throttled to 15 s
    // anyway, so the second was never meaningful precision.
    const formatted = this.formatLocalTime(capturedDate, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    await this.setCapabilityValue(capabilityId, formatted);
  }

  // Only a complete visit is recorded: a session already running when the app
  // started has no start timestamp, and a guessed one would read as a real
  // measurement. Nothing is written in that case.
  async trackSittingDuration(previousValue, value) {
    if (value === true) {
      this._sittingSince = Date.now();
      return;
    }
    if (value !== false || previousValue !== true || !this._sittingSince) return;
    const seconds = Math.round((Date.now() - this._sittingSince) / 1000);
    this._sittingSince = null;
    if (!this.hasCapability(SITTING_DURATION_CAPABILITY)) return;
    await this.setCapabilityValue(SITTING_DURATION_CAPABILITY, seconds)
      .catch(error => this.error('Could not record the visit duration', error.message));
  }

  async setStatusCapabilityValue(capabilityId, value) {
    await this.syncStatusInsightsCapability(capabilityId, value);
    const previousValue = this.getCapabilityValue(capabilityId);
    if (previousValue === value) return;

    await this.setCapabilityValue(capabilityId, value);
    if (capabilityId === 'aquaclean_user_sitting') {
      await this.trackSittingDuration(previousValue, value);
    }
    if (previousValue === null || previousValue === undefined) return;

    // An error appearing and an error clearing are the two moments worth a
    // Flow; the raw code changing from one fault to another is not.
    if (capabilityId === 'aquaclean_error_code') {
      const had = Number(previousValue) > 0;
      const has = Number(value) > 0;
      if (had !== has) {
        const id = has ? 'aquaclean_error_occurred' : 'aquaclean_error_cleared';
        // "Cleared" describes the error that just went away, not the zero that
        // replaced it — that is the code worth putting in a notification.
        const described = formatErrorCode(has ? Number(value) : Number(previousValue), this._language);
        await this.homey.flow.getDeviceTriggerCard(id)
          .trigger(this, {
            code: Number(value) || 0,
            hex: described ? described.hex : '0000',
            description: described ? described.description : ''
          }, {})
          .catch(error => this.error('AquaClean error trigger failed', error.message));
      }
    }

    let triggerId = VALUE_STATUS_TRIGGER_IDS[capabilityId];
    const booleanTriggers = BOOLEAN_STATUS_TRIGGER_IDS[capabilityId];
    if (booleanTriggers) triggerId = booleanTriggers[String(Boolean(value))];
    if (!triggerId) return;

    try {
      await this.homey.flow.getDeviceTriggerCard(triggerId).trigger(this, {}, {});
      this.log('AquaClean Flow trigger fired', {
        triggerId,
        capabilityId,
        previousValue,
        value
      });
    } catch (error) {
      this.error(`AquaClean Flow trigger failed: ${triggerId}`, error);
    }
  }

  async handleRefreshFailure(label, error) {
    this.error(label, error);
    this._reconnectFailures += 1;
    const reconnectDelay = Math.min(
      RECONNECT_DELAY_MIN_MS * (2 ** (this._reconnectFailures - 1)),
      RECONNECT_DELAY_MAX_MS,
    );
    this._nextReconnectAt = Date.now() + reconnectDelay;

    // The first couple of failures are ordinary: the remote or the phone app
    // may simply be holding the toilet. 'disconnected' — the state whose
    // transition fires the "connection lost" Flow trigger — is reserved for
    // the point where the app has genuinely given up getting through, which
    // is what the trigger's hint has promised all along.
    if (this._reconnectFailures >= CONNECTION_LOST_AFTER_FAILURES) {
      await this.setConnectionState('disconnected');
      // Homey's own availability, so the device is visibly greyed out rather
      // than silently showing values from an hour ago. Deliberately not on the
      // first failure: the remote or the phone app holding the toilet for a
      // moment is normal, and the existing backoff handles it.
      await this.setUnavailable(this.homey.__('unavailable.no_contact')).catch(err => {
        this.error('Could not mark the AquaClean unavailable', err.message);
      });
    } else {
      await this.setConnectionState('reconnecting');
    }
    await this.setConnectionError(error);

    // The physical remote can reset Mera's single BLE connection. Keep Homey's
    // controls and last confirmed states visible while the background poll
    // reconnects instead of presenting the whole device as unavailable.
    this.log('AquaClean connection recovery scheduled', {
      reconnectDelay,
      reconnectFailures: this._reconnectFailures
    });

    await this.runCircuitBreaker();
  }

  // The proxy can wedge in a state where the toilet advertises but every
  // connection is refused — seen live: nine orphaned diagnostic sessions left
  // the ESP32's single slot hanging, and only its restart button cleared it.
  // After enough consecutive failures the app now presses those buttons
  // itself: first the cheap cache clear, then a full restart if failures
  // continue. A cooldown keeps it from flapping, and none of it helps against
  // weak signal — that is placement, and the log says so.
  async runCircuitBreaker() {
    if (this._reconnectFailures < CIRCUIT_BREAKER_FAILURES) return;
    if (Date.now() - this._lastBreakerActionAt < CIRCUIT_BREAKER_COOLDOWN_MS) return;

    const stage = this._breakerStage;
    this._lastBreakerActionAt = Date.now();
    this._breakerStage = (stage + 1) % 3;
    this._reconnectFailures = 0;
    this._nextReconnectAt = Date.now() + RECONNECT_DELAY_MIN_MS;

    if (stage >= 2) {
      // The app-restart equivalent, done from the inside: a manual restart
      // once fixed a stuck app, and everything it actually did — dropping the
      // backoff, the session and the proxy TCP client — is reproduced here
      // without risking Homey flagging the app unstable over deliberate exits.
      await this.resetTransport();
      return;
    }

    const settingId = stage === 0 ? 'clear_ble_cache' : 'restart_ble_proxy';
    this.log('AquaClean circuit breaker engaged', {
      action: settingId,
      note: 'helps a wedged proxy, not a weak signal'
    });
    await this.pressProxyButton(settingId).catch(error => {
      this.error('AquaClean circuit breaker failed', {
        action: settingId,
        message: error.message
      });
    });
  }

  async resetTransport() {
    this.log('AquaClean circuit breaker: full transport reset (the app-restart equivalent)');
    await this.closeProtocolSession().catch(() => {});
    this._forceFreshScan = true;
    this._reconnectFailures = 0;
    this._nextReconnectAt = 0;
    const app = this.homey.app;
    if (app && typeof app.resetBle === 'function') app.resetBle();
  }

  async setConnectionState(state) {
    if (!this.hasCapability('aquaclean_connection_state')) return;
    const previous = this.getCapabilityValue('aquaclean_connection_state');
    if (previous === state) return;
    await this.setCapabilityValue('aquaclean_connection_state', state);

    // 'reconnecting' comes and goes on every hiccup and 'ready'/'connected'
    // alternate constantly during normal use. One outage is one notification:
    // the flag stays raised through every disconnected->reconnecting->
    // disconnected retry cycle, so 'lost' cannot fire again until the
    // connection has actually come back.
    const lost = state === 'disconnected' && !this._connectionLossNotified;
    const restored = this._connectionLossNotified
      && (state === 'ready' || state === 'connected');
    if (!lost && !restored) return;
    this._connectionLossNotified = lost;

    const triggerId = lost ? 'aquaclean_connection_lost' : 'aquaclean_connection_restored';
    try {
      await this.homey.flow.getDeviceTriggerCard(triggerId).trigger(this, {}, {});
      this.log('AquaClean Flow trigger fired', { triggerId, previous, state });
    } catch (error) {
      this.error(`AquaClean Flow trigger failed: ${triggerId}`, error);
    }
  }

  async setConnectionError(error) {
    const capabilityId = 'aquaclean_connection_error';
    if (!this.hasCapability(capabilityId)) return;
    const value = error
      ? String(error.message || error)
      : '—';
    if (this.getCapabilityValue(capabilityId) === value) return;
    await this.setCapabilityValue(capabilityId, value);
  }

  async waitForIdle() {
    if (!this._busy) return;

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: null
      };
      waiter.timer = this.homey.setTimeout(() => {
        const index = this._idleWaiters.indexOf(waiter);
        if (index >= 0) this._idleWaiters.splice(index, 1);
        const error = new Error(
          'The AquaClean Bluetooth operation did not finish in time. Try again shortly.',
        );
        error.code = 'AQUACLEAN_BUSY';
        reject(error);
      }, OPERATION_HANDOFF_TIMEOUT_MS);
      this._idleWaiters.push(waiter);
    });
  }

  // BLE går via ESPHome-proxyen, ikke Homeys radio. Flaten er den samme som
  // homey.ble, så all logikken under er uendret fra BLE-versjonen av appen.
  bleManager() {
    return this.homey.app.getBle();
  }

  async findFreshAdvertisement(peripheralUuid, { forceScan = false } = {}) {
    if (!forceScan && peripheralUuid) {
      try {
        const cached = await this.bleManager().find(peripheralUuid);
        if (cached && typeof cached.rssi === 'number' && cached.rssi < 0) {
          this.log('Found cached AquaClean advertisement', {
            uuid: cached.uuid,
            rssi: cached.rssi
          });
          return cached;
        }
        if (cached) {
          this.log('Ignoring stale cached AquaClean advertisement', {
            uuid: cached.uuid,
            rssi: cached.rssi
          });
        }
      } catch (error) {
        if (!isBleInProgressError(error)) {
          this.error('Cached AquaClean advertisement lookup failed', error);
        }
      }
    }

    let lastCandidates = [];
    let lastScanError = null;
    for (
      let scanAttempt = 1;
      scanAttempt <= ADVERTISEMENT_SCAN_ATTEMPTS;
      scanAttempt += 1
    ) {
      this.log(
        `Scanning for a fresh AquaClean advertisement `
        + `${scanAttempt}/${ADVERTISEMENT_SCAN_ATTEMPTS}`,
      );
      try {
        const advertisements = await this.discoverWithBusyRetry(peripheralUuid);
        lastScanError = null;
        const hasFreshSignal = candidate =>
          typeof candidate.rssi === 'number' && candidate.rssi < 0;
        const exact = advertisements.find(candidate =>
          candidate.uuid === peripheralUuid && hasFreshSignal(candidate));
        lastCandidates = advertisements.filter(candidate =>
          hasFreshSignal(candidate) && isAquaCleanAdvertisement(candidate));
        const advertisement =
          exact || (lastCandidates.length === 1 ? lastCandidates[0] : null);

        if (advertisement) {
          this.log('Fresh AquaClean advertisement found', {
            uuid: advertisement.uuid,
            rssi: advertisement.rssi,
            connectable: advertisement.connectable
          });
          return advertisement;
        }
      } catch (error) {
        lastScanError = error;
        this.error(`AquaClean scan ${scanAttempt} failed`, error);
      }

      if (scanAttempt < ADVERTISEMENT_SCAN_ATTEMPTS) {
        await wait(this.homey, ADVERTISEMENT_RETRY_DELAY_MS * scanAttempt);
      }
    }

    if (lastScanError && lastCandidates.length === 0) throw lastScanError;
    if (lastCandidates.length > 1) {
      throw new Error(this.homey.__('error.multiple_found'));
    }
    throw new Error(this.homey.__('error.not_found'));
  }

  async discoverWithBusyRetry(targetUuid = null) {
    let lastError;

    for (let attempt = 1; attempt <= DISCOVERY_BUSY_ATTEMPTS; attempt += 1) {
      try {
        return await withTimeout(
          this.homey,
          // The scan ends as soon as the paired toilet is seen instead of
          // burning the full window — several seconds off every cold connect.
          () => this.bleManager().discover({ targetUuid }),
          BLE_SCAN_TIMEOUT_MS,
          'AquaClean BLE scan',
        );
      } catch (error) {
        lastError = error;
        if (!isBleInProgressError(error) || attempt === DISCOVERY_BUSY_ATTEMPTS) {
          throw error;
        }

        this.log(
          `Homey BLE manager is busy; retrying scan ${attempt}/${DISCOVERY_BUSY_ATTEMPTS}`,
        );
        await wait(this.homey, attempt * 1000);
      }
    }

    throw lastError;
  }

  async connectWithRetry(initialAdvertisement, peripheralUuid) {
    let advertisement = initialAdvertisement;
    let lastError;

    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
      try {
        this.log(`BLE connection attempt ${attempt}/${CONNECT_ATTEMPTS}`, {
          rssi: advertisement.rssi
        });
        return await withTimeout(
          this.homey,
          () => advertisement.connect(),
          BLE_CONNECT_TIMEOUT_MS,
          'AquaClean BLE connect',
        );
      } catch (error) {
        lastError = error;
        this.error(`BLE connection attempt ${attempt}/${CONNECT_ATTEMPTS} failed`, error);

        if (attempt < CONNECT_ATTEMPTS) {
          // A timed-out connect is still pending inside Homey/BlueZ: the wait was
          // abandoned, the operation was not. Scanning immediately afterwards races
          // that pending connect and reports the peripheral as missing. Give the
          // adapter time to release it before asking for a fresh advertisement.
          const isTimeout = error && error.code === 'AQUACLEAN_TIMEOUT';
          await wait(
            this.homey,
            isTimeout ? BLE_CONNECT_TIMEOUT_COOLDOWN_MS : attempt * 750,
          );
          advertisement = await this.findFreshAdvertisement(
            peripheralUuid,
            { forceScan: true },
          );
        }
      }
    }

    throw lastError;
  }

  async cleanup() {
    if (this._deleted) return;
    this._deleted = true;
    if (this._interval) this.homey.clearInterval(this._interval);
    this.clearOdourRunOnTimer();
    await this.closeProtocolSession();

    for (const waiter of this._idleWaiters.splice(0)) {
      this.homey.clearTimeout(waiter.timer);
      waiter.reject(new Error('The AquaClean device has been deleted.'));
    }
  }

  async onUninit() {
    await this.cleanup();
  }

  async onSettings({ changedKeys = [], newSettings = {} } = {}) {
    if (changedKeys.includes('anal_status_parameter')) {
      const storedState = this.getStoreValue('lastLiveState')
        || this.getStoreValue('lastSystemState');
      if (storedState) {
        await this.applyLiveState(this.mapConfiguredShowerState(storedState));
      }

      this.log('AquaClean anal shower status mapping changed', {
        parameterId: this.getAnalStatusParameterId()
      });
    }

    if (
      changedKeys.includes('odour_auto_tracking')
      || changedKeys.includes('odour_run_on_seconds')
    ) {
      this.clearOdourRunOnTimer();
      const userIsSitting = Boolean(
        this.getCapabilityValue('aquaclean_user_sitting'),
      );
      if (this.isAutomaticOdourTrackingEnabled() && userIsSitting) {
        await this.setStatusCapabilityValue(
          'aquaclean_odour_extraction_running',
          true,
        );
      }
      this.log('AquaClean odour status tracking settings changed', {
        automatic: this.isAutomaticOdourTrackingEnabled(),
        runOnMilliseconds: this.getOdourRunOnMilliseconds()
      });
    }

    // Light and lid configuration is written straight to the toilet. A failed
    // write throws, which Homey shows to the user and which rolls the setting
    // back — better than a page that claims a value the device never took.
    // Switching profile and changing a value in the same save must write to the
    // profile just chosen, not the one being left.
    const switchedProfile = changedKeys.includes(EDIT_PROFILE_SETTING);
    const targetProfileId = switchedProfile
      ? Number(newSettings[EDIT_PROFILE_SETTING])
      : null;

    const configChanges = changedKeys.filter(key => configEntryFor(key));
    try {
      for (const settingId of configChanges) {
        await this.writeConfigSetting(settingId, newSettings[settingId], targetProfileId);
      }
    } catch (error) {
      // Homey rolls the whole page back when this throws, but the writes that
      // already reached the toilet stand. Re-read now so the page stops
      // disagreeing with the device, rather than waiting six hours for it.
      if (configChanges.length > 1) {
        this.homey.setTimeout(() => {
          this._lastSettingsRefreshAt = 0;
          this.refreshSettingsAndMaintenance().catch(refreshError => {
            this.error('Re-reading AquaClean settings after a failed write failed', refreshError);
          });
        }, 0);
      }
      throw error;
    }

    // Switching profile changes what every slider means, so the values are
    // re-read from the newly selected profile before the page is trusted.
    if (changedKeys.includes(EDIT_PROFILE_SETTING)) {
      this.log('AquaClean edit profile changed', { profileId: newSettings[EDIT_PROFILE_SETTING] });
      const chosenProfileId = Number(newSettings[EDIT_PROFILE_SETTING]);
      this.homey.setTimeout(() => {
        this._lastSettingsRefreshAt = 0;
        // Say up front that the sliders still show the profile being left, so
        // a value dragged before the read lands is not mistaken for this one.
        this.setSettings({ profile_values_read: this.homey.__('state.reading') }).catch(() => {});
        this.refreshSettingsAndMaintenance().catch(error => {
          this.error('Reading the newly selected AquaClean profile failed', error);
          this.noteProfileValuesRead(chosenProfileId, false).catch(() => {});
        });
      }, 0);
    }

    // Both checkboxes act as buttons: they run once and clear themselves, so
    // the box never sits ticked describing something that already happened.
    // Homey rejects setSettings() from inside onSettings, hence the deferral.
    // The tick has to be read from newSettings — getSetting() still returns the
    // pre-save value here, which is exactly the false we are trying to leave.
    if (changedKeys.includes(RESET_FILTER_SETTING)
      && newSettings[RESET_FILTER_SETTING]) {
      this.homey.setTimeout(() => {
        this.executeFilterReset()
          .catch(error => this.error('AquaClean filter reset failed', error))
          .finally(() => {
            this.setSettings({ [RESET_FILTER_SETTING]: false }).catch(() => {});
          });
      }, 0);
    }

    for (const settingId of Object.keys(PROXY_BUTTON_SETTINGS)) {
      if (!changedKeys.includes(settingId) || !newSettings[settingId]) continue;
      this.homey.setTimeout(() => {
        this.pressProxyButton(settingId)
          .catch(error => this.error('AquaClean proxy button failed', {
            settingId,
            message: error.message
          }))
          .finally(() => {
            this.setSettings({ [settingId]: false }).catch(() => {});
          });
      }, 0);
    }

    if (changedKeys.includes(REFRESH_INFORMATION_SETTING)
      && newSettings[REFRESH_INFORMATION_SETTING]) {
      this.homey.setTimeout(() => {
        // The one path that bypasses the device-information cache: the user
        // asked for a fresh read, e.g. after a firmware update.
        this.refreshSettingsAndMaintenance({ forceInformation: true })
          .catch(error => this.error('AquaClean information refresh failed', error))
          .finally(() => {
            this.setSettings({ [REFRESH_INFORMATION_SETTING]: false }).catch(() => {});
          });
      }, 0);
    }
  }

  async onDeleted() {
    await this.cleanup();
  }
}

module.exports = MeraComfortDevice;
