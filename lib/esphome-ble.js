'use strict';

// Drop-in-erstatning for Homeys `homey.ble`, men all BLE går gjennom en
// ESPHome bluetooth_proxy i stedet for Homeys egen radio.
//
// Flaten er bevisst identisk med den delen av Homey BLE som device.js bruker:
//   ble.discover() / ble.find()
//   advertisement.{uuid,localName,rssi,connectable,serviceUuids}, .connect()
//   peripheral.{isConnected}, .discoverServices(), .disconnect(), on('disconnect')
//   service.{uuid,characteristics}, .discoverCharacteristics()
//   characteristic.{uuid,properties}, .write(), .subscribeToNotifications(),
//                                     .unsubscribeFromNotifications()
//
// Slik kan drivere skrevet mot Homey BLE gjenbrukes uten endringer i logikken.

const { EventEmitter } = require('node:events');
const { EsphomeApiClient, addressToMac } = require('./esphome-api');

const normalizeUuid = (value) => String(value).toLowerCase().replace(/[^a-f0-9]/g, '');
const uuidToMac = (uuid) => normalizeUuid(uuid).match(/.{2}/g).join(':').toUpperCase();

// Homey oppgir properties som strengarray; ESPHome gir en bitmaske.
function propertiesFromMask(mask) {
  const out = [];
  if (mask & 0x01) out.push('broadcast');
  if (mask & 0x02) out.push('read');
  if (mask & 0x04) out.push('writeWithoutResponse');
  if (mask & 0x08) out.push('write');
  if (mask & 0x10) out.push('notify');
  if (mask & 0x20) out.push('indicate');
  return out;
}

class EsphomeCharacteristic {
  constructor(peripheral, service, descriptor) {
    this._peripheral = peripheral;
    this._service = service;
    this.uuid = descriptor.uuid;
    this.handle = descriptor.handle;
    this.cccdHandle = descriptor.cccdHandle;
    this.properties = propertiesFromMask(descriptor.properties);
    this._propertyMask = descriptor.properties;
    this._notifyListener = null;
  }

  get serviceUuid() { return this._service.uuid; }

  async write(data) {
    this._peripheral._assertConnected();
    // Kanalene har både write og write-no-resp. Vi bruker write-med-svar slik
    // at en avvist skriving faktisk rapporteres i stedet for å forsvinne.
    await this._peripheral._client.gattWrite(this._peripheral.address, this.handle, data);
    return this;
  }

  async read() {
    this._peripheral._assertConnected();
    return this._peripheral._client.gattRead(this._peripheral.address, this.handle);
  }

  async subscribeToNotifications(listener) {
    this._peripheral._assertConnected();
    this._notifyListener = listener;
    this._peripheral._registerNotifyHandler(this.handle, listener);
    // enableNotifications skriver også CCCD — ESPHome gjør det ikke selv.
    await this._peripheral._client.enableNotifications(this._peripheral.address, {
      handle: this.handle,
      cccdHandle: this.cccdHandle,
    });
    return this;
  }

  async unsubscribeFromNotifications() {
    this._notifyListener = null;
    this._peripheral._unregisterNotifyHandler(this.handle);
    if (!this._peripheral.isConnected) return this;
    try {
      await this._peripheral._client.gattWriteDescriptor(
        this._peripheral.address,
        this.cccdHandle ?? this.handle + 1,
        Buffer.from([0x00, 0x00]),
      );
      await this._peripheral._client.gattNotify(this._peripheral.address, this.handle, false);
    } catch {
      // Enheten kan allerede være borte; avmelding er da uansett et no-op.
    }
    return this;
  }
}

class EsphomeService {
  constructor(peripheral, descriptor) {
    this._peripheral = peripheral;
    this.uuid = descriptor.uuid;
    this._raw = descriptor;
    this.characteristics = [];
  }

  async discoverCharacteristics(uuids) {
    const wanted = uuids && uuids.length ? uuids.map(normalizeUuid) : null;
    this.characteristics = this._raw.characteristics
      .filter((c) => !wanted || wanted.includes(normalizeUuid(c.uuid)))
      .map((c) => new EsphomeCharacteristic(this._peripheral, this, c));
    return this.characteristics;
  }
}

class EsphomePeripheral extends EventEmitter {
  constructor(ble, advertisement) {
    super();
    this._ble = ble;
    this._client = ble._client;
    this.address = advertisement.address;
    this.uuid = advertisement.uuid;
    this.isConnected = false;
    this.services = [];
    this._notifyHandlers = new Map();
    this._servicesRaw = null;
  }

  _assertConnected() {
    if (!this.isConnected) {
      const error = new Error('The Bluetooth device is not connected.');
      error.code = 'BLE_NOT_CONNECTED';
      throw error;
    }
  }

  _registerNotifyHandler(handle, listener) { this._notifyHandlers.set(handle, listener); }
  _unregisterNotifyHandler(handle) { this._notifyHandlers.delete(handle); }

  _handleNotify(handle, data) {
    const listener = this._notifyHandlers.get(handle);
    if (listener) listener(data);
  }

  _handleDisconnect(error) {
    if (!this.isConnected) return;
    this.isConnected = false;
    this._notifyHandlers.clear();
    this.emit('disconnect', error);
  }

  async connect() {
    if (this.isConnected) return this;
    // The constructor snapshots ble._client, which is null whenever the TCP
    // link to the proxy is down — and an advertisement is routinely turned into
    // a peripheral in exactly that window during a reconnect. Take the client
    // _ensureClient just produced rather than the stale snapshot, or the first
    // call below throws "Cannot read properties of null".
    this._client = await this._ble._ensureClient();
    await this._client.bleConnect(this.address);
    this.isConnected = true;
    this._ble._attachPeripheral(this);
    return this;
  }

  async discoverServices(uuids) {
    this._assertConnected();
    if (!this._servicesRaw) {
      this._servicesRaw = await this._client.getServices(this.address);
    }
    const wanted = uuids && uuids.length ? uuids.map(normalizeUuid) : null;
    this.services = this._servicesRaw
      .filter((s) => !wanted || wanted.includes(normalizeUuid(s.uuid)))
      .map((s) => new EsphomeService(this, s));
    return this.services;
  }

  async discoverAllServicesAndCharacteristics() {
    const services = await this.discoverServices();
    for (const service of services) await service.discoverCharacteristics();
    return services;
  }

  async disconnect() {
    if (!this.isConnected) return this;
    this.isConnected = false;
    this._notifyHandlers.clear();
    try {
      this._client.bleDisconnect(this.address);
    } catch {
      // Allerede nede — ingenting å gjøre.
    }
    this._ble._detachPeripheral(this);
    this.emit('disconnect');
    return this;
  }
}

class EsphomeAdvertisement {
  constructor(ble, { address, rssi, localName = '', serviceUuids = [] }) {
    this._ble = ble;
    this.address = address;
    this.uuid = normalizeUuid(address);
    this.id = this.uuid;
    this.localName = localName;
    this.rssi = rssi;
    this.connectable = true;
    this.serviceUuids = serviceUuids;
  }

  async connect() {
    const peripheral = new EsphomePeripheral(this._ble, this);
    await peripheral.connect();
    return peripheral;
  }
}

class EsphomeBle {
  constructor({ host, port = 6053, log = () => {} } = {}) {
    if (!host) throw new TypeError('EsphomeBle requires the proxy host');
    this.host = host;
    this.port = port;
    this._log = log;
    this._client = null;
    this._peripherals = new Set();
    this._connecting = null;
  }

  async _ensureClient() {
    if (this._client && this._client.isConnected) return this._client;
    if (this._connecting) return this._connecting;

    this._connecting = (async () => {
      const client = new EsphomeApiClient({
        host: this.host,
        port: this.port,
        clientInfo: 'homey-esphome-ble',
        log: this._log,
      });

      client.on('notify', ({ mac, handle, data }) => {
        for (const peripheral of this._peripherals) {
          if (peripheral.address === mac) peripheral._handleNotify(handle, data);
        }
      });

      client.on('bleDisconnected', ({ mac, error }) => {
        for (const peripheral of [...this._peripherals]) {
          if (peripheral.address === mac) {
            this._peripherals.delete(peripheral);
            peripheral._handleDisconnect(
              error ? new Error(`The Bluetooth connection dropped (error=${error})`) : undefined,
            );
          }
        }
      });

      client.on('close', () => {
        for (const peripheral of [...this._peripherals]) {
          this._peripherals.delete(peripheral);
          peripheral._handleDisconnect(new Error('The connection to the Bluetooth proxy dropped.'));
        }
        this._client = null;
      });

      // Uten en feillytter kaster EventEmitter på 'error'.
      client.on('error', (err) => this._log('esphome-ble', err.message));

      await client.connect();
      client.subscribeAdvertisements();
      this._client = client;
      return client;
    })();

    try {
      return await this._connecting;
    } finally {
      this._connecting = null;
    }
  }

  _attachPeripheral(peripheral) { this._peripherals.add(peripheral); }
  _detachPeripheral(peripheral) { this._peripherals.delete(peripheral); }

  // Samler alt som annonserer seg innenfor tidsvinduet.
  // targetUuid: avslutt straks denne enheten er sett i stedet for å brenne
  // hele timeouten — en gjenoppkobling leter etter ett kjent toalett, ikke
  // etter alt i nærheten. Uten targetUuid (paring) brukes fortsatt full tid.
  async discover({ targetUuid = null, timeout = 10000 } = {}) {
    const client = await this._ensureClient();
    const seen = new Map();
    // Callers pass the peripheral uuid ('94a9a82d77ef'); the scan sees
    // colon-MACs. Compare in the same normalized form as the advertisements.
    const wanted = targetUuid ? normalizeUuid(targetUuid) : null;
    let foundTarget = () => {};

    const off = client._collect((type, fields) => {
      for (const entry of client._addressesFromAdvertisement(type, fields)) {
        const mac = addressToMac(entry.address);
        const existing = seen.get(mac);
        if (existing) {
          // Navn og tjeneste-UUID-er kommer ofte i SCAN_RSP, altså en senere
          // pakke enn ADV_IND — behold det vi har sett så langt.
          existing.rssi = entry.rssi;
          if (entry.localName) existing.localName = entry.localName;
          if (entry.serviceUuids && entry.serviceUuids.length) {
            existing.serviceUuids = [
              ...new Set([...existing.serviceUuids, ...entry.serviceUuids]),
            ];
          }
        } else {
          seen.set(mac, new EsphomeAdvertisement(this, {
            address: mac,
            rssi: entry.rssi,
            localName: entry.localName || '',
            serviceUuids: entry.serviceUuids || [],
          }));
        }
        if (wanted && normalizeUuid(mac) === wanted) foundTarget();
      }
    });

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);
      foundTarget = () => { clearTimeout(timer); resolve(); };
    });
    off();
    return [...seen.values()];
  }

  // Venter til én bestemt enhet annonserer seg. uuid kan være MAC med eller
  // uten kolon — device.js lagrer den normaliserte formen.
  async find(uuid, timeout = 15000) {
    const client = await this._ensureClient();
    const mac = uuidToMac(uuid);
    const seen = await client.waitForDevice(mac, { timeoutMs: timeout });
    return new EsphomeAdvertisement(this, {
      address: mac,
      rssi: seen.rssi,
      localName: seen.localName || '',
      serviceUuids: seen.serviceUuids || [],
    });
  }

  // Trykker en knapp-entitet på selve proxyen, ikke på toalettet. Brukes til
  // omstart og til å tømme Bluetooth-cachen når ESP32-en har satt seg fast.
  // Navnet matches løst, siden ESPHome kan endre visningsnavn mellom versjoner.
  async pressProxyButton(pattern) {
    const client = await this._ensureClient();
    const { buttons } = await client.listEntities();

    const needle = pattern.toLowerCase();
    for (const [name, key] of buttons) {
      if (!name.toLowerCase().includes(needle)) continue;
      this._log(`trykker knapp på proxyen: ${name}`);
      client.pressButton(key);
      return name;
    }

    throw new Error(
      `Fant ingen knapp som matcher "${pattern}" på proxyen. `
      + `Tilgjengelige: ${[...buttons.keys()].join(', ') || 'ingen'}.`,
    );
  }

  async destroy() {
    if (!this._client) return;
    await this._client.close();
    this._client = null;
    this._peripherals.clear();
  }
}

module.exports = { EsphomeBle, EsphomeAdvertisement, EsphomePeripheral, normalizeUuid, uuidToMac };
