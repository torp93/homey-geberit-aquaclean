'use strict';

// Hvor ESPHome BLE-proxyen finnes.
//
// env.json leveres ikke på Homey Pro (kommer stille tomt via `app run --remote`),
// så verdien kommer fra appinnstillingene med en fallback her i lib/.

const SETTING_HOST = 'proxyHost';
const SETTING_PORT = 'proxyPort';

// Ingen standard-vert: hver installasjon har sin egen proxy, og en tilfeldig
// annen brukers nettverk skal aldri kontaktes ved et uhell. Før brukeren har
// lagret en adresse i appinnstillingene er appen bevisst ukonfigurert.
const DEFAULT_HOST = null;
const DEFAULT_PORT = 6053;

const isValidHost = (value) => {
  if (typeof value !== 'string') return false;
  const host = value.trim();
  if (!host || host.length > 253) return false;
  // IPv4 eller vertsnavn — ingen skjema, sti eller port.
  return /^[a-zA-Z0-9._-]+$/.test(host);
};

const isValidPort = (value) => Number.isInteger(value) && value > 0 && value <= 65535;

// settings er en Homey ManagerSettings eller et hvilket som helst objekt med get().
function resolveProxyConfig(settings) {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let source = 'unconfigured';

  if (settings && typeof settings.get === 'function') {
    const storedHost = settings.get(SETTING_HOST);
    if (isValidHost(storedHost)) {
      host = storedHost.trim();
      source = 'settings';
    }

    const storedPort = Number(settings.get(SETTING_PORT));
    if (isValidPort(storedPort)) port = storedPort;
  }

  return { host, port, source };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  SETTING_HOST,
  SETTING_PORT,
  isValidHost,
  isValidPort,
  resolveProxyConfig,
};
