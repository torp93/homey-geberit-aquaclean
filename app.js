'use strict';

const Homey = require('homey');
const { version } = require('./app.json');
const { EsphomeBle } = require('./lib/esphome-ble');
const { resolveProxyConfig, SETTING_HOST, SETTING_PORT } = require('./lib/proxy-config');

class GeberitAquaCleanApp extends Homey.App {
  async onInit() {
    this._ble = null;
    this.registerFlowCards();

    // Endrer brukeren proxy-adressen, rives den gamle klienten ned slik at
    // neste kall bygger en ny mot riktig vert.
    this.homey.settings.on('set', (key) => {
      if (key === SETTING_HOST || key === SETTING_PORT) this.resetBle();
    });

    const { host, port, source } = resolveProxyConfig(this.homey.settings);
    this.log(`Geberit AquaClean v${version} initialized — proxy ${host}:${port} (${source})`);
  }

  // All BLE går gjennom ESPHome-proxyen, ikke Homeys egen radio.
  // Flaten er identisk med homey.ble for det driveren bruker.
  getBle() {
    if (!this._ble) {
      const { host, port } = resolveProxyConfig(this.homey.settings);
      // Fresh installs have no proxy address yet. The device page shows this
      // message as the connection error until the app settings are filled in.
      if (!host) {
        throw new Error(this.homey.__('error.no_proxy'));
      }
      this._ble = new EsphomeBle({
        host,
        port,
        log: (...args) => this.log('[proxy]', ...args),
      });
      this.log(`ESPHome BLE-proxy klient opprettet mot ${host}:${port}`);
    }
    return this._ble;
  }

  resetBle() {
    if (!this._ble) return;
    const previous = this._ble;
    this._ble = null;
    this.log('Proxy-innstilling endret — kobler ned eksisterende klient');
    Promise.resolve(previous.destroy()).catch((error) =>
      this.error('Nedkobling av proxy-klient feilet', error));
  }

  async onUninit() {
    this.resetBle();
  }

  registerFlowCards() {
    const booleanConditions = {
      aquaclean_condition_user_sitting: 'aquaclean_user_sitting',
      aquaclean_condition_anal_shower: 'aquaclean_anal_shower_running',
      aquaclean_condition_lady_shower: 'aquaclean_lady_shower_running',
      aquaclean_condition_dryer: 'aquaclean_dryer_running',
      aquaclean_condition_odour: 'aquaclean_odour_extraction_running'
    };

    // A device that never gained the capability would otherwise answer
    // "undefined is truthy" — false is the honest answer.
    for (const [cardId, capabilityId] of Object.entries(booleanConditions)) {
      this.homey.flow.getConditionCard(cardId).registerRunListener(({ device }) =>
        (device.hasCapability(capabilityId)
          ? Boolean(device.getCapabilityValue(capabilityId))
          : false));
    }

    // "Reachable" means Homey can talk to the toilet, which is a different
    // question from whether the toilet reports a fault.
    this.homey.flow
      .getConditionCard('aquaclean_condition_connected')
      .registerRunListener(({ device }) => {
        const state = device.getCapabilityValue('aquaclean_connection_state');
        return state === 'ready' || state === 'connected';
      });

    this.homey.flow
      .getConditionCard('aquaclean_condition_descaling')
      .registerRunListener(({ device }) =>
        (device.hasCapability('aquaclean_descaling_state')
          ? device.getCapabilityValue('aquaclean_descaling_state') !== 'idle'
          : false));

    this.homey.flow
      .getConditionCard('aquaclean_condition_error')
      .registerRunListener(({ device }) =>
        (device.hasCapability('aquaclean_error_code')
          ? Number(device.getCapabilityValue('aquaclean_error_code')) > 0
          : false));

    const controlActions = {
      aquaclean_action_anal_shower: 'aquaclean_button_anal_shower',
      aquaclean_action_lady_shower: 'aquaclean_button_lady_shower',
      aquaclean_action_dryer: 'aquaclean_button_dryer',
      aquaclean_action_stop: 'aquaclean_button_stop',
      aquaclean_action_lid: 'aquaclean_button_lid',
      aquaclean_action_odour_extraction: 'aquaclean_button_odour_extraction',
      aquaclean_action_odour_run_on: 'aquaclean_button_odour_run_on'
    };

    for (const [cardId, capabilityId] of Object.entries(controlActions)) {
      this.homey.flow.getActionCard(cardId).registerRunListener(({ device }) =>
        device.executeControlCapability(capabilityId));
    }

    // Deterministic actions: each one states the outcome it wants, so running
    // the same Flow twice leaves the toilet in the same place. The toggle cards
    // above stay registered for Flows that already use them.
    const deterministicActions = {
      aquaclean_action_anal_shower_start: ['anal_shower', true],
      aquaclean_action_anal_shower_stop: ['anal_shower', false],
      aquaclean_action_lady_shower_start: ['lady_shower', true],
      aquaclean_action_lady_shower_stop: ['lady_shower', false],
      aquaclean_action_dryer_start: ['dryer', true],
      aquaclean_action_dryer_stop: ['dryer', false],
      aquaclean_action_odour_extraction_on: ['odour_extraction', true],
      aquaclean_action_odour_extraction_off: ['odour_extraction', false]
    };
    for (const [cardId, [fn, desired]] of Object.entries(deterministicActions)) {
      this.homey.flow.getActionCard(cardId).registerRunListener(({ device }) =>
        device.setFunctionState(fn, desired));
    }

    this.homey.flow
      .getActionCard('aquaclean_action_refresh_status')
      .registerRunListener(({ device }) => device.executeStatusRefresh());

    // The device fires these on every drop in the counter; each flow's own
    // threshold decides here whether that drop crossed it. Comparing against
    // the previous value keeps a flow from firing again on every later drop.
    for (const cardId of [
      'aquaclean_days_until_descaling_below',
      'aquaclean_days_until_filter_below'
    ]) {
      this.homey.flow.getDeviceTriggerCard(cardId).registerRunListener(
        (args, state) => state.current < args.days && state.previous >= args.days,
      );
    }

    this.registerSettingFlowCards();
    this.registerThresholdConditions();

    this.homey.flow
      .getDeviceTriggerCard('aquaclean_visit_longer_than')
      .registerRunListener((args, state) => state.seconds > args.minutes * 60);
  }

  // Everything on the settings page was unreachable from a Flow: the toilet
  // could be told to shower on a schedule but not to have the seat warm when
  // you got there. These write through the same path the settings page uses,
  // so range checking, the read-back and the error messages are shared.
  registerSettingFlowCards() {
    // "current" means the profile the settings page is editing, which is the
    // only sensible default: the toilet never says which profile it is using.
    const profileFromArgs = args => (!args.profile || args.profile === 'current'
      ? null
      : Number(args.profile));

    this.homey.flow
      .getActionCard('aquaclean_action_set_profile_level')
      .registerRunListener(({ device, setting, value, ...args }) =>
        device.writeConfigSetting(setting, Number(value), profileFromArgs(args)));

    this.homey.flow
      .getActionCard('aquaclean_action_set_profile_switch')
      .registerRunListener(({ device, setting, state, ...args }) =>
        device.writeConfigSetting(setting, state === 'on', profileFromArgs(args)));

    // Device-wide settings: no profile, so the override stays null. The
    // dropdown ids are the wire values, which writeConfigSetting expects as
    // strings for a dropdown-kind setting.
    const deviceWide = {
      aquaclean_action_set_light_mode: ['light_mode', args => args.mode],
      aquaclean_action_set_light_colour: ['light_colour', args => args.colour],
      aquaclean_action_set_light_brightness: ['light_brightness', args => Number(args.value)],
      aquaclean_action_set_lid_sensor_range: ['lid_sensor_range', args => Number(args.value)]
    };
    for (const [cardId, [settingId, pick]] of Object.entries(deviceWide)) {
      this.homey.flow.getActionCard(cardId).registerRunListener(args =>
        args.device.writeConfigSetting(settingId, pick(args)));
    }

    // Which of the two automatic movements is chosen by the card's own
    // dropdown, whose ids are the setting ids.
    this.homey.flow
      .getActionCard('aquaclean_action_set_lid_auto')
      .registerRunListener(({ device, movement, state }) =>
        device.writeConfigSetting(movement, state === 'on'));

    this.homey.flow
      .getActionCard('aquaclean_action_reset_filter_counter')
      .registerRunListener(({ device }) => device.executeFilterReset());

    this.homey.flow
      .getActionCard('aquaclean_action_restart_proxy')
      .registerRunListener(({ device }) => device.pressProxyButton('restart_ble_proxy'));
  }

  // A capability the device never gained answers null, and null compares as
  // less than every threshold. "Unknown" must not read as "urgent".
  registerThresholdConditions() {
    const belowConditions = {
      aquaclean_condition_days_until_descaling: 'aquaclean_days_until_descaling',
      aquaclean_condition_days_until_filter: 'aquaclean_days_until_filter'
    };
    for (const [cardId, capabilityId] of Object.entries(belowConditions)) {
      this.homey.flow.getConditionCard(cardId).registerRunListener(({ device, days }) => {
        const value = device.hasCapability(capabilityId)
          ? device.getCapabilityValue(capabilityId)
          : null;
        return Number.isFinite(value) && value < days;
      });
    }

    // Weaker means a more negative number: -95 dBm is weaker than -90 dBm.
    this.homey.flow
      .getConditionCard('aquaclean_condition_signal_strength')
      .registerRunListener(({ device, dbm }) => {
        const value = device.hasCapability('aquaclean_signal_strength')
          ? device.getCapabilityValue('aquaclean_signal_strength')
          : null;
        return Number.isFinite(value) && value < dbm;
      });
  }
}

module.exports = GeberitAquaCleanApp;
