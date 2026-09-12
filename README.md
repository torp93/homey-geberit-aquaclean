# Geberit AquaClean for Homey

[![Proxy firmware & install page](https://github.com/torp93/homey-geberit-aquaclean/actions/workflows/build-firmware.yml/badge.svg)](https://github.com/torp93/homey-geberit-aquaclean/actions/workflows/build-firmware.yml)

Control a **Geberit AquaClean** shower toilet from a Homey Pro over Bluetooth
LE, through an **ESP32 running ESPHome**. No cloud, no Geberit account, no
dependency on the Geberit Home app.

Developed and verified against a **Mera Comfort**. Other AquaClean models share
the same Bluetooth protocol and are likely to work, but are untested; reports
are welcome. The protocol work builds on the
[jens62/geberit-aquaclean](https://github.com/jens62/geberit-aquaclean)
project, with corrections from testing against live hardware (see
[What was learned about the protocol](#what-was-learned-about-the-protocol)).

## Screenshots

Click to enlarge.

<p>
  <a href="docs/screenshots/device-controls.jpg"><img src="docs/screenshots/device-controls.jpg" alt="Device controls" width="250"></a>
  <a href="docs/screenshots/device-status.jpg"><img src="docs/screenshots/device-status.jpg" alt="Live status" width="250"></a>
  <a href="docs/screenshots/insights.jpg"><img src="docs/screenshots/insights.jpg" alt="Insights" width="250"></a>
</p>

## Features

- Anal shower, lady shower and dryer: start, stop and toggle
- Lid open and close, odour extraction with a tunable run-on time
- Live status: who is sitting, what is running, descaling state, last error
- Every per-profile setting (shower pressure and arm position, water and dryer
  temperature, seat heat, fan power, oscillation), readable and writable, with
  each write read back from the toilet before it is reported as saved
- Maintenance: days until descaling and filter change, and a filter reset
- Usage counters per function, a count for today and a running total
- Error codes shown with the cause and repair measure from Geberit's manual
- Flow cards for every function, the settings, the maintenance thresholds and a
  long-visit trigger
- A repair screen showing the current fault, signal strength and device details
- Automatic recovery when the Bluetooth link wedges

## Architecture

```
Homey Pro  ──TCP 6053──▶  ESP32 (ESPHome)  ──BLE──▶  Geberit AquaClean
           native API        bluetooth_proxy
```

The app speaks the ESPHome native API directly (plaintext protobuf, no external
dependencies) and does raw GATT through `bluetooth_proxy`. Homey's own Bluetooth
radio is not used, so the toilet only needs to be near the ESP32, not near Homey.

Three behaviours worth knowing:

- **On-demand.** The toilet accepts one BLE central at a time, and its own
  remote is dead while anyone is connected. The app connects briefly (~2 s),
  does its work and disconnects. Poll and keep-warm intervals are configurable.
- **Verified writes.** Every setting is read back before it is reported as saved.
- **Self-healing.** After repeated failures a three-stage circuit breaker works
  through cache clear, restart, then transport reset, and resets on the next
  success.

## Requirements

- Homey Pro (tested on Homey Pro 2023, firmware ≥ 12.2.0)
- An ESP32 running ESPHome with `bluetooth_proxy`, placed near the toilet
- A Geberit AquaClean (developed against a Mera Comfort)

Aim for better than **−80 dBm** between the ESP32 and the toilet. Below that the
link fails in confusing ways: the connection succeeds, then GATT times out. A
person sitting on the toilet costs about 13 dB, and that is exactly when the app
is used, so place the board close with clear line of sight.

## Setup

### 1. Flash the ESP32

Easiest path: **[flash it from your browser](https://torp93.github.io/homey-geberit-aquaclean/)**.
Plug the board in over USB, click Install, pick the serial port and enter your
WiFi on the page. No ESPHome, Python or command line. It needs Chrome or Edge on
a computer, and works with classic ESP32, C3 and S3 boards.

The advanced path builds the config yourself, with WiFi baked in.
[`esphome/geberit-aquaclean-proxy.yaml`](esphome/geberit-aquaclean-proxy.yaml)
is the config this app is developed against: put your `wifi_ssid` and
`wifi_password` in a `secrets.yaml` next to it, then flash. The first flash goes
over USB; later ones go over WiFi on their own.
**[docs/ESP32_SETUP.md](docs/ESP32_SETUP.md)** walks through it step by step,
per operating system, with troubleshooting.

Two details in the config are load-bearing: `connection_slots: 1` with
`active: true` (the toilet needs two-way GATT and grants one slot), and the
**restart** and **clear-cache** buttons (the app presses them to recover a
wedged proxy). On an ESP32-C3, leave `web_server` and `captive_portal` off
unless the *Max Free Block* sensor stays above ~40 KB.

### 2. Connect it in Homey

1. Open the app settings and enter the proxy's address: its IP, or
   `geberit-aquaclean-proxy.local`. Port **6053**. A test button confirms it
   before you save.
2. Add the device. Pairing scans through the proxy and lists any AquaClean it
   sees.
3. Optional: adjust the poll intervals and the Bluetooth keep-warm window per
   device.

Give the board a fixed IP (a DHCP reservation in your router) so the app does
not lose it.

## What was learned about the protocol

Highlights that go beyond the prior art, all verified against a live Mera
Comfort:

- ESPHome's `BluetoothGATTNotifyRequest` does **not** write the CCCD
  descriptor; it only registers the callback locally on the ESP32. Without a
  manual descriptor write the toilet never sends a single notification.
- The 0x11/0x13 session-initialization handshake is unnecessary for request/
  response use: dropping it took a request from 6.3 s to 1.9 s.
- Profile-setting payloads start with the **profile id** (0–4). Profile 0 is
  the toilet's "base settings", used when no user profile is selected, and
  cannot be read as "active profile": no readable field reflects which profile
  is active.
- Stored profile values are read when a function **starts**; writing them
  mid-shower changes nothing. The remote adjusts pressure live through a channel
  that is not exposed over this GATT service.
- Requesting more than eight system parameters in one call crosses a BLE frame
  boundary and leaves the toilet unable to answer `GetFilterStatus` until it is
  power-cycled. The app caps requests at eight.
- Command 37, `TriggerFlushManually`, is acknowledged with status 0 but does
  nothing observable. It actuates the *bowl* flush through the optional interface
  module (`147.039.00.1` / `147.049.00.1`) that wires the toilet to an
  electronic flush plate; without that module there is nothing to actuate, which
  is why it is not exposed in the app.

## Documentation

- [Error codes](docs/ERROR_CODES.md) — every fault code the toilet can report,
  with the cause and the repair measure from Geberit's service manual, plus
  what the app can and cannot see over Bluetooth.
- [The remote's menus](docs/REMOTE_MENU.md) — the everyday menus and the
  service menu behind them: error display, device info, and the seat, lid and
  arm adjustments.
- [What the toilet exposes over Bluetooth](docs/PROTOCOL.md) — the system
  parameter map confirmed by measurement, what is deliberately absent
  (lid position), and the two undocumented procedures resolved as static.

## Credits

This app builds directly on the protocol research of
[jens62/geberit-aquaclean](https://github.com/jens62/geberit-aquaclean):
UUID roles, frame format, CRC behaviour and the procedure map all trace back
to that project, and several capability icons come from its `graphics/`
directory. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full
attribution, including Material Design Icons by Pictogrammers.

[thomas-bingel/geberit-aquaclean](https://github.com/thomas-bingel/geberit-aquaclean)
served as an additional protocol reference.

## Development

```bash
npm test                                # unit tests, no hardware needed
homey app validate --level publish
homey app install                       # deploy to your Homey
```

The `test/` suite covers the frame protocol, the ESPHome API encoding, the
device state machine (queueing, keep-warm, backoff, circuit breaker) and
app.json↔code consistency.

## License

MIT — see [LICENSE](LICENSE). Third-party artwork and references are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

*This is a community project with no affiliation to Geberit AG. Geberit and
AquaClean are trademarks of Geberit AG, used here only to identify the
compatible product.*
