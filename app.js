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
        throw new Error(
          'No ESPHome proxy configured. Open the app settings and enter '
          + 'the address of your ESP32 Bluetooth proxy.',
        );
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
      aquaclean_condition_lady_shower: 'aquaclean_lady_shower_running'
    };

    for (const [cardId, capabilityId] of Object.entries(booleanConditions)) {
      this.homey.flow.getConditionCard(cardId).registerRunListener(({ device }) =>
        Boolean(device.getCapabilityValue(capabilityId)));
    }

    this.homey.flow
      .getConditionCard('aquaclean_condition_descaling')
      .registerRunListener(({ device }) =>
        device.getCapabilityValue('aquaclean_descaling_state') !== 'idle');

    this.homey.flow
      .getConditionCard('aquaclean_condition_error')
      .registerRunListener(({ device }) =>
        Number(device.getCapabilityValue('aquaclean_error_code')) > 0);

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

    this.homey.flow
      .getActionCard('aquaclean_action_refresh_status')
      .registerRunListener(({ device }) => device.executeStatusRefresh());

    // Flush has no button capability on the device page (deliberately retired),
    // so its card runs the command directly.
    this.homey.flow
      .getActionCard('aquaclean_action_flush')
      .registerRunListener(({ device }) => device.executeFlush());

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
  }
}

module.exports = GeberitAquaCleanApp;
