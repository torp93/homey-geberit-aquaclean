# Setting up the ESP32 Bluetooth proxy

This app does not use Homey's own Bluetooth radio. It talks to the toilet
through a small ESP32 board running [ESPHome](https://esphome.io) as a
Bluetooth proxy, placed near the toilet. This guide takes you from a bare
board to a working proxy the app can connect to.

If you already run ESPHome, skip to [The short version](#the-short-version).
Everyone else, start at [What you need](#what-you-need).

---

## What you need

- **An ESP32-C3 board.** Any generic one works. The included configuration is
  tuned for the C3; a classic ESP32 works too (see the note at the top of
  [`../esphome/geberit-aquaclean-proxy.yaml`](../esphome/geberit-aquaclean-proxy.yaml)).
- **A USB cable that carries data, not just power.** This is the single most
  common first mistake: many charging cables have no data wires, and the board
  simply never appears on the computer. If nothing shows up, try another cable
  before anything else.
- **A computer** (Windows, macOS or Linux) with a web browser.
- **Your 2.4 GHz WiFi name and password.** The ESP32 does not do 5 GHz.

You do **not** need Home Assistant.

---

## The short version

For people who already have ESPHome:

1. Put `wifi_ssid` and `wifi_password` in your `secrets.yaml`.
2. Change the `ap:` password in the config from `CHANGE-ME`.
3. Flash [`geberit-aquaclean-proxy.yaml`](../esphome/geberit-aquaclean-proxy.yaml)
   over USB the first time, OTA after that.
4. Find the board's IP address and enter it in the Homey app.

Everyone else, follow the steps below.

---

## Step 1 — Install ESPHome

ESPHome is the tool that compiles the configuration and flashes it onto the
board. The simplest way that needs nothing else installed is the Python
package:

```bash
pip install esphome
```

If you would rather not touch Python, ESPHome also ships as a Docker image and
as a Home Assistant add-on. Any of the three works; the commands below assume
the `esphome` command is available.

> **Windows:** if you later plug in the board and it does not appear as a
> serial port, you are missing the USB-to-serial driver for the chip on your
> board. Install **CH340** or **CP210x** drivers (search the exact name plus
> "driver"), unplug and replug, and it will show up.

---

## Step 2 — Get the configuration and your secrets

1. Download [`geberit-aquaclean-proxy.yaml`](../esphome/geberit-aquaclean-proxy.yaml)
   into an empty folder.
2. In the **same folder**, create a file called `secrets.yaml` with your WiFi
   details:

   ```yaml
   wifi_ssid: "Your WiFi name"
   wifi_password: "Your WiFi password"
   ```

3. Open `geberit-aquaclean-proxy.yaml` and change one line, the fallback
   access point password:

   ```yaml
   ap:
     ssid: AquaClean Proxy Fallback
     password: "CHANGE-ME"      # <- change this to anything you like
   ```

   This fallback network is a rescue path: if the WiFi password is ever wrong,
   the board brings up its own network instead of vanishing, and you can still
   reach it. Give it a real password so nobody else can.

That is the only editing required. Everything else in the file is tuned and
commented, and is best left alone.

---

## Step 3 — Flash the board (first time, over USB)

1. Plug the ESP32 into the computer with the data cable.
2. From the folder with the two files, run:

   ```bash
   esphome run geberit-aquaclean-proxy.yaml
   ```

3. ESPHome compiles the firmware (the first build takes a few minutes) and
   then asks where to install it. Choose the **serial / USB port**, not
   "Over the Air" — there is nothing on the board yet to update wirelessly.
4. Watch the log. When it connects to WiFi and prints an IP address, the
   proxy is running. You can stop the log with `Ctrl+C`; the board keeps
   running on its own.

From now on the board updates **wirelessly**: the next time you run
`esphome run`, pick the OTA option and leave the USB cable out of it.

### Prefer the browser? (no command line)

If the command line is not for you, flash from a browser instead:

1. Run `esphome compile geberit-aquaclean-proxy.yaml` once to produce a
   firmware file (ESPHome prints its path, ending in `.factory.bin`), **or**
   ask someone with ESPHome to send you that file.
2. Open **[web.esphome.io](https://web.esphome.io)** in Chrome or Edge, plug
   in the board, click **Connect**, pick the port, and install the
   `.factory.bin`.

The browser installer only does the first USB flash; WiFi and future updates
still come from the configuration above.

---

## Step 4 — Find the proxy's IP address and enter it in Homey

The board needs a fixed address so the app can always find it.

1. **Reserve an IP for it in your router.** In the router's DHCP settings,
   find `geberit-aquaclean-proxy` and give it a permanent (reserved) address.
   This is worth doing: without it the address can change and the app loses
   the proxy.
2. Note that address. If you did not catch it from the flashing log, it is in
   the router's list of connected devices, or via the name
   `geberit-aquaclean-proxy.local` if your network resolves mDNS.
3. In Homey: open the **Geberit AquaClean** app settings and enter the IP
   address. The port is **6053** and does not normally need changing. A test
   button confirms the connection before you save.
4. Add the device. Pairing scans through the proxy and lists any AquaClean it
   sees.

---

## Placement matters more than anything else

Bluetooth range is the most common source of trouble, and the geometry is
unkind: the signal is weakest exactly when someone is sitting on the toilet,
which is when the app is used.

- Place the ESP32 **within a few metres of the toilet, with clear line of
  sight.** A wall, and especially a person, between the board and the toilet
  costs a lot of signal (a human body is worth about 13 dB on its own).
- Aim for a signal (RSSI) **better than −80 dBm**. The app shows this on the
  device page as **Bluetooth signal**. Connections start failing around
  −87 dBm.
- If the signal is marginal, moving the board even half a metre, or raising it
  off the floor, often makes the difference.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The board never appears when flashing over USB | Wrong cable (charge-only), or a missing USB-serial driver on Windows. Try a known data cable first, then install CH340 / CP210x drivers. |
| WiFi will not connect | 5 GHz network (the ESP32 is 2.4 GHz only), or a typo in `secrets.yaml`. The board falls back to its own `AquaClean Proxy Fallback` network so you can still reach it. |
| Homey cannot reach the proxy | Wrong IP, or the address changed. Reserve the IP in the router, and check the port is 6053. |
| The toilet pairs but readings time out | On a C3 this is usually low memory. The device page in ESPHome shows **Proxy Max Free Block**; below about 25 KB, GATT reads fail while the connection itself looks fine. Do not enable `web_server` on a C3 unless that number stays above 40 KB. |
| BLE connects, then disconnects every few seconds | Same low-memory symptom as above, or a stale Bluetooth cache. Press **Clear Bluetooth Cache** (the app does this itself after repeated failures), which wipes the cache a plain restart cannot. |
| It worked, then stopped | The app restarts and clears the proxy on its own after repeated failures, using the two buttons in the config. Keep both buttons in the configuration, or it cannot recover by itself. |

---

## Why two buttons must stay in the config

The configuration defines two buttons, **Restart AquaClean Proxy** and
**Clear Bluetooth Cache**. The Homey app presses these itself when a
connection wedges: first the cache clear, then the restart. This is how the
app heals a stuck proxy without you having to do anything. If you trim the
configuration, leave those two buttons in place.

---

## Sources and credit

The proxy configuration is based on the work in
[jens62/geberit-aquaclean](https://github.com/jens62/geberit-aquaclean)
(`esphome/aquaclean-proxy-c3.yaml`), adapted and re-tuned for this app. The
memory and BLE tuning notes come from testing against a live Mera Comfort; see
the comments in the configuration file and [PROTOCOL.md](PROTOCOL.md) for the
detail.
