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
