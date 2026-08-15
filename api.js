'use strict';

const { EsphomeApiClient } = require('./lib/esphome-api');
const { isValidHost, isValidPort, DEFAULT_PORT } = require('./lib/proxy-config');

module.exports = {
  // Brukes av innstillingssiden for å bekrefte at proxyen svarer før lagring.
  async testProxy({ homey, query }) {
    const host = String(query.host || '').trim();
    const port = Number(query.port || DEFAULT_PORT);

    if (!isValidHost(host)) throw new Error('invalid_host');
    if (!isValidPort(port)) throw new Error('invalid_port');

    const client = new EsphomeApiClient({
      host,
      port,
      clientInfo: 'homey-aquaclean-settings',
      log: (...args) => homey.app.log('[proxy-test]', ...args),
    });
    client.on('error', () => {});

    try {
      const hello = await client.connect({ timeoutMs: 8000 });
      const info = await client.deviceInfo(8000);
      return {
        name: info.name || hello.name,
        esphomeVersion: info.esphomeVersion,
        model: info.model,
        macAddress: info.macAddress,
        bluetoothProxy: Number(info.bluetoothProxyFeatureFlags) > 0,
      };
    } finally {
      await client.close().catch(() => {});
    }
  },
};
