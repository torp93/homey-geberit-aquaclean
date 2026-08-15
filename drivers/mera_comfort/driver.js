'use strict';

const Homey = require('homey');

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

    return devices.map(advertisement => ({
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
