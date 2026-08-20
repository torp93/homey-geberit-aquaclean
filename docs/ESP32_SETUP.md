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

## Step 1: Install ESPHome

ESPHome is the tool that compiles the configuration and flashes it onto the
board. This configuration bakes your WiFi details in when it is compiled, so
this step has to happen once no matter which operating system you use, and no
matter how you flash later. Pick the section for your computer.

### Windows

1. Install **Python** from [python.org](https://www.python.org/downloads/). On
   the first screen of the installer, tick **"Add python.exe to PATH"** before
   clicking Install. This one checkbox is what lets the next command work.
2. Open **PowerShell** (Start menu, type "PowerShell") and run:

   ```powershell
   pip install esphome
   ```

3. You will also need a USB driver so the board shows up. Most generic ESP32-C3
   boards use a **CH340** chip; some use **CP210x**. Search for the exact name
   plus "driver", install it, and reboot if asked. If you are not sure which
   one, install CH340 first, it is the more common of the two.

### macOS

The cleanest path uses [Homebrew](https://brew.sh):

```bash
brew install esphome
```

If you do not have Homebrew, install it with the one-line command on that
page first, or use `pip3 install esphome` with the Python that ships with
macOS.

Modern macOS recognises most boards with no driver at all. If a board with a
**CH340** chip is not detected on an older macOS, install the CH340 driver for
Mac; **CP210x** boards may need Silicon Labs' driver.

### Prefer not to install anything?

You can skip installing ESPHome on your own machine two ways:

- **Docker:** `docker run` the official `esphome/esphome` image, mounting the
  folder with the configuration. Works the same on Windows and Mac.
- **Someone else compiles for you:** ESPHome produces a single firmware file
  (`.factory.bin`). Anyone running ESPHome can build it from the configuration
  plus your `secrets.yaml` and send you that file, which you then flash from a
  browser (see [Step 3](#step-3-flash-the-board-first-time-over-usb)). You
  still choose your own WiFi details; they just do the compile.

---

## Step 2: Get the configuration and your secrets

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

## Step 3: Flash the board (first time, over USB)

The first flash always goes over the USB cable. After that the board updates
itself wirelessly, and the cable is never needed again. There are two ways to
do the first flash; both start by plugging the board in.

### Option A: The command line (Windows PowerShell or macOS Terminal)

From the folder with `geberit-aquaclean-proxy.yaml` and `secrets.yaml`:

```bash
esphome run geberit-aquaclean-proxy.yaml
```

ESPHome compiles the firmware (the first build takes a few minutes) and then
asks where to install it. Choose the **serial / USB port**, not "Over the
Air". There is nothing on the board yet to update wirelessly.

- On **Windows** the port looks like `COM5`.
- On **macOS** it looks like `/dev/cu.usbserial-...` or `/dev/cu.wchusbserial-...`.

Watch the log. When it connects to WiFi and prints an IP address, the proxy is
running. Stop the log with `Ctrl+C`; the board keeps running on its own. Next
time you run `esphome run`, pick the OTA option and leave the cable out.

### Option B: The browser (Chrome or Edge, Windows or Mac)

Good if you would rather click than type. It needs the compiled firmware file
first, so do this once on the command line (or have someone send you the file):

```bash
esphome compile geberit-aquaclean-proxy.yaml
```

ESPHome prints the path to a file ending in `.factory.bin`. Then:

1. Open **[web.esphome.io](https://web.esphome.io)** in **Chrome or Edge**
   (Safari and Firefox cannot talk to USB serial devices, so they will not
   work here).
2. Plug in the board, click **Connect**, and pick the port.
3. Choose **Install** and select the `.factory.bin` file.

The browser only does the first USB flash; the WiFi details and every future
update come from the configuration you compiled, not from the browser.

---

## Step 4: Find the proxy's IP address and enter it in Homey

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
