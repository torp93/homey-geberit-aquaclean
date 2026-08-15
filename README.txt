Geberit AquaClean

Control a Geberit AquaClean shower toilet from Homey, through an ESP32
running ESPHome as a Bluetooth proxy. No cloud, no Geberit account —
everything stays on your own network.

FEATURES

- Buttons on the device page for anal shower, lady shower, dryer, stop,
  lid, odour extraction, odour run-on and status refresh.
- Live status: user presence, shower and dryer activity, descaling state
  and the last device error code — with 0/1 Insights graphs for each.
  Odour extraction is the one function the toilet does not report, so the
  app tracks it itself; how long it counts as running after you stand up
  is adjustable in the device settings.
- All twelve per-profile settings (shower pressure and position, water and
  dryer temperature, seat heat, fan power, oscillation, odour extraction
  and more) readable and writable from the device settings, per profile.
- Orientation light and lid behaviour (auto open/close, sensor range)
  configurable from the device settings.
- Days until descaling and days until filter change as sensors, with Flow
  triggers that fire once when a chosen threshold is crossed.
- Flow triggers for Bluetooth connection lost/restored.
- A save receipt on the device page showing the last confirmed write: every
  setting is read back from the toilet before it is reported as saved.
- Maintenance tools: filter-change reset, device information readout, and
  buttons to clear the proxy's Bluetooth cache or restart the proxy.
- Self-healing: after repeated connection failures the app works through a
  recovery sequence on its own — clearing the proxy's Bluetooth cache,
  restarting the proxy, and finally resetting its own connection — instead
  of waiting for you to notice.
- Considerate Bluetooth: short on-demand connections and configurable poll
  intervals, so the toilet's physical remote and the Geberit Home phone app
  stay usable alongside Homey. The toilet accepts one connection at a time.

REQUIREMENTS

- A Geberit AquaClean. Developed and tested against a Mera Comfort; other
  models share the same Bluetooth protocol and are likely to work, but are
  untested — feedback from other models is very welcome.
- An ESP32 (a basic ESP32-C3 is enough) running ESPHome with the
  bluetooth_proxy component and one connection slot, placed within a few
  metres of the toilet with clear line of sight. Enter its address in the
  app settings after installation.
- The app does not use Homey's own Bluetooth radio.

GOOD TO KNOW

- Only one Bluetooth connection at a time: while the Geberit Home phone app
  is connected, Homey cannot reach the toilet, and vice versa. The app's
  short connections are designed to make sharing painless.
- The toilet cannot report which user profile is active. Choose which
  profile the settings page edits; "Base settings" (profile 0) is what the
  toilet uses when no user profile has been selected.
- Shower pressure and position are read by the toilet when a shower starts.
  Set them first, then start the shower.

This is a community project with no affiliation to Geberit AG. It builds on
the protocol research of the jens62/geberit-aquaclean project; see the
repository for full third-party notices and the ESPHome configuration.
