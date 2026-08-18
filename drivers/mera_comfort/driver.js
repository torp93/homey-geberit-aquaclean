'use strict';

const Homey = require('homey');
const { translate } = require('../../lib/i18n');
const {
  isValidHost, isValidPort, resolveProxyConfig, SETTING_HOST, SETTING_PORT
} = require('../../lib/proxy-config');
const api = require('../../api');

const AQUACLEAN_SERVICE_UUID = '00003ea000001000800000805f9b34fb';

const normalizeUuid = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-f0-9]/g, '');

const isAquaClean = advertisement => {
  const name = String(advertisement.localName || '').toLowerCase();
  const serviceUuids = advertisement.serviceUuids || [];

  return name.includes('geberit')
    || name.includes('ac pro')
    || name.includes('aquaclean')
    || serviceUuids.some(uuid => normalizeUuid(uuid) === AQUACLEAN_SERVICE_UUID);
};

class MeraComfortDriver extends Homey.Driver {
  // Overriding onPair means the list_devices template no longer finds
  // onPairListDevices by itself — it is wired up explicitly below.
  async onPair(session) {
    session.setHandler('getProxy', async () => {
      const { host, port } = resolveProxyConfig(this.homey.settings);
      return { host: host || '', port };
    });

    session.setHandler('testProxy', async ({ host, port }) =>
      api.testProxy({ homey: this.homey, query: { host, port } }));

    session.setHandler('saveProxy', async ({ host, port }) => {
      const address = String(host || '').trim();
      const number = Number(port);
      if (!isValidHost(address)) throw new Error('invalid_host');
      if (!isValidPort(number)) throw new Error('invalid_port');
      // Writing these two settings makes app.js drop its cached client, so the
      // scan that follows goes to the address just entered.
      await this.homey.settings.set(SETTING_HOST, address);
      await this.homey.settings.set(SETTING_PORT, number);
      this.log('Proxy address set during pairing', { host: address, port: number });
      return true;
    });

    // Called by the proxy step before moving on, so a scan that finds nothing
    // usable is answered on a page that still has the address field and the
    // buttons — rather than in Homey's device list, which offers only "Close".
    session.setHandler('probe', async () => {
      const result = await this.scanForAquaCleans();
      this.log('Pairing probe', { outcome: result.outcome, fresh: result.fresh.length });
      return { outcome: result.outcome, message: result.message };
    });

    session.setHandler('list_devices', () => this.onPairListDevices());
  }

  // Unlike onPair, this one is handed the paired device, so the calibration
  // buttons reach the existing protocol machinery directly. Homey labels the
  // entry point "Repair"; the view sets its own title.
  async onRepair(session, device) {
    // Command 33 opens a service mode on the toilet and there is no command
    // that merely leaves it: while it is open, user detection stops, odour
    // extraction and system flush stop responding, and the toilet's own remote
    // is locked out. Observed on a Mera Comfort after the view was closed
    // without saving; it stayed that way for several minutes and then came
    // back on its own. What ended it is not known — power was never cut, so
    // either the mode times out or something the driver sent cleared it.
    //
    // Homey's close button is always there, so the view cannot prevent someone
    // walking away mid-routine. The session tracks it instead and finishes the
    // routine on the way out.
    let started = false;
    let finished = false;

    // The repair screen opens on the fault status: what is wrong right now,
    // in words, without looking a code up in a table.
    session.setHandler('getErrorStatus', async ({ refresh = true } = {}) =>
      device.getErrorStatus({ refresh }));

    // What a user means by "restart the app": drop the BLE session and the
    // proxy client, clear the backoff, and start over. An app cannot restart
    // itself through the SDK, but this is the part a restart actually fixes —
    // the same reset the circuit breaker reaches for after repeated failures.
    session.setHandler('resetConnection', async () => {
      this.log('Connection reset requested from the repair view');
      await device.resetTransport();
      return device.getErrorStatus({ refresh: true });
    });

    session.setHandler('calibrationStep', async ({ step }) => {
      const result = await device.runLidCalibrationStep(step);
      if (step === 'start') started = true;
      if (step === 'save') finished = true;
      return {
        step: result.step,
        code: result.code,
        response: result.response,
        serviceState: result.serviceState
      };
    });

    session.setHandler('disconnect', async () => {
      if (!started || finished) return;
      // Saving commits the position currently shown on the toilet. If the user
      // never pressed Raise or Lower that is the position it already had, so
      // this writes nothing new — and it is in any case the lesser harm next to
      // leaving the toilet unusable until someone finds the fuse.
      this.log('Repair view closed mid-calibration; closing the routine on the toilet');
      const result = await device.runLidCalibrationStep('save').catch(error => {
        this.error('Could not close the calibration routine; the toilet may stay in service mode', error);
        return null;
      });
      // Whether saving is what ends the mode is still unproven. Parameter 7
      // answers it: a non-zero reading here means the toilet is still in
      // service mode after the routine was closed, and that belongs in the log
      // rather than being discovered by someone reaching for the remote.
      if (result && result.serviceState) {
        this.error('Toilet still reports a service state after closing the calibration',
          { serviceState: result.serviceState });
      }
    });
  }

  // Returns what the scan saw, without deciding what to do about it — probe()
  // reports it inside the pairing step, onPairListDevices() throws.
  async scanForAquaCleans() {
    const advertisements = await this.homey.app.getBle().discover();
    const devices = advertisements.filter(isAquaClean);
    const paired = new Set(this.getDevices().map(device => device.getData().id));
    const fresh = devices.filter(advertisement => !paired.has(advertisement.uuid));

    if (devices.length > 0 && fresh.length === 0) {
      const [first] = devices;
      return {
        outcome: 'already_added',
        message: translate(this.homey, 'pair.result.already_added', {
          name: first.localName || 'Geberit AC PRO'
        }),
        fresh
      };
    }
    if (devices.length === 0) {
      return {
        outcome: advertisements.length === 0 ? 'proxy_silent' : 'none_advertising',
        message: advertisements.length === 0
          ? translate(this.homey, 'pair.result.proxy_silent')
          : translate(this.homey, 'pair.result.none_advertising', { count: advertisements.length }),
        fresh
      };
    }
    return { outcome: 'ok', message: null, fresh };
  }

  async onPairListDevices() {
    const advertisements = await this.homey.app.getBle().discover();
    const devices = advertisements.filter(isAquaClean);

    this.log(
      `BLE scan returned ${advertisements.length} advertisement(s); `
      + `found ${devices.length} AquaClean candidate(s)`,
    );

    devices.forEach(advertisement => {
      this.log('AquaClean candidate', {
        localName: advertisement.localName || null,
        uuid: advertisement.uuid,
        rssi: advertisement.rssi,
        serviceUuids: advertisement.serviceUuids || []
      });
    });

    // Homey silently drops already-paired devices from the list, leaving
    // "no devices found" — which points the user at signal strength and the
    // proxy when the real answer is that the toilet is already added.
    const paired = new Set(this.getDevices().map(device => device.getData().id));
    const fresh = devices.filter(advertisement => !paired.has(advertisement.uuid));

    if (devices.length > 0 && fresh.length === 0) {
      const [first] = devices;
      throw new Error(translate(this.homey, 'pair.result.already_added', {
        name: first.localName || 'Geberit AC PRO'
      }));
    }

    if (devices.length === 0) {
      // Nothing at all means the proxy itself is the suspect; plenty of other
      // devices but no AquaClean means the toilet is asleep or already busy.
      throw new Error(advertisements.length === 0
        ? this.homey.__('pair.result.proxy_silent')
        : translate(this.homey, 'pair.result.none_advertising', { count: advertisements.length }));
    }

    return fresh.map(advertisement => ({
      name: advertisement.localName || 'Geberit AC PRO',
      data: {
        id: advertisement.uuid
      },
      store: {
        peripheralUuid: advertisement.uuid,
        address: advertisement.address || null
      },
      // No capabilities list: Homey then applies the driver manifest in
      // manifest order. A hardcoded list here used to hand out the LEGACY
      // button.* ids, which every fresh pairing immediately migrated away
      // from — and the migration decided the page order, not the manifest.
      settings: {
        advertisedName: advertisement.localName || '',
        serviceUuids: (advertisement.serviceUuids || []).join(', '),
        anal_status_parameter: '1'
      }
    }));
  }
}

module.exports = MeraComfortDriver;
