# Geberit AquaClean Error Diagnostics

What error information an AquaClean Mera Comfort exposes over Bluetooth, what
this app records of it, and the complete fault-code table from Geberit's own
service manual.

**Primary source:** Geberit AquaClean Mera, *Manuel d'entretien*
`967.008.00.0(04)`, 05-2023 — sections "Dépannage en fonction du code erreur".
The manual exists in French; no English edition of the service manual was
found (the English *user* manuals contain no code table). Descriptions below
are translated from the French, with the original terms kept where they are
the clearest identifier.

Claims are marked **CONFIRMED** (verified on this device or in two independent
sources), **PROBABLE** (single credible source), or **UNVERIFIED**.

---

## LAST_ERROR — how the code reaches Homey

**CONFIRMED.** The one error datum the device exposes over BLE is *system
parameter 6* of `GetSystemParameterList` (procedure `0x0D`, context `0x01`),
named `lastErrorCode` in the original C# protocol work and
`AC_STATUS_LAST_ERROR` in the jens62 register enumeration.

It is a single scalar — the most recent error, `0` meaning none. The protocol
carries no timestamp and no history.

**Wire format, verified live 2026-08-18:** the toilet reports the code as a
plain integer while Geberit's own interfaces show it as four hex digits.
Parameter 6 read **1035** at the same moment the Geberit app displayed
**040B**, for one fault: `0x040B = 1035`. The app therefore displays the hex
form, so a code can be compared against the remote control's display, the
Geberit app and this manual without converting anything by hand.

The remote control shows the code under **Care and maintenance → Error
message**; the user manual notes "An error code is displayed only in the event
of an error."

---

## How to read the tables

Every module repeats the same four generic faults. They are listed once here
rather than 14 times below:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `x00` | Factory data — write failed | Faulty read/write operation | Restart the device. If it recurs, replace the functional unit/module. |
| `x01` | Operating data — write failed | Faulty read/write operation | Restart the device. If it recurs, replace the functional unit/module. |
| `x08` | 24 V DC — no voltage | Faulty plug connection · Cable break | Check the wiring. |
| `x09` | 24 V DC — overcurrent | Functional unit/module defective | Replace the functional module. |
| `x0A` | 24 V DC — leakage current | Functional unit/module defective | Replace the functional module. |

Where a module deviates from this pattern it is spelled out in its own table.

**Module overview** (manual Tableau 7 — *"Ne pas remplacer un module
fonctionnel sans une recherche de pannes exhaustive"*: do not replace a module
without exhaustive fault-finding):

| Range | Module | Scope |
|---|---|---|
| 01xx | Main control | Bus communication, remote/app pairing, fault memory, firmware update |
| 03xx | Odour extraction | Fan control |
| 04xx | Shower unit | Spray arm drive, multi-way valve, position monitoring |
| 05xx | Lid lever ¹ | Lid drive and lid position monitoring |
| 06xx | Dryer module | Fan, dryer heating, temperature regulation |
| 07xx | Hot water production | Level control, solenoid valve, pumps, heating, temperature |
| 08xx | Seat heating ¹ | Seat heating temperature regulation |
| 09xx | Lateral control panel | Status LED, key input, interface module link |
| 0Axx | User detection | Weight sensor in the WC seat |
| 0Bxx | Proximity sensor ¹ | Radar proximity detection |
| 0Cxx | Orientation light ¹ | — |
| 0Dxx | Interface module ² | Link to the WC control (flush actuation) |
| 0Exx | Dryer assembly (2020) | Dryer arm drive |
| 0Fxx | Instantaneous water heater | Inlet/outlet temperature |

¹ Marked *"Modèle: Geberit AquaClean Mera Comfort"* — present on this model.

² Marked *"en option"* in the manual, and listed under *"Unités fonctionnelles
en option"*. This is the separately sold interface module that wires the
toilet to an electronic flush plate — article `147.039.00.1` (4.1 V, plates up
to June 2022) or `147.049.00.1` (12 V, from July 2022). Without it the 0Dxx
codes cannot occur, the `Autom. flush actuation` menu item does not appear on
the remote, and command 37 has nothing to actuate.

02xx exists in the overview with no module assigned and no codes.

---

## 01xx — Main control

31 codes. Beyond the generic set:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0108` | Sequence control — no feedback | Shower unit / dryer assembly / hot water production defective | Follow the codes of the module concerned. |
| `0109` | Power supply — current interrupted | Faulty plug connection | Restart (reset). Check the wiring. |
| `010A` | Power supply — leakage current | Faulty plug connection · Cable break | Check the wiring. |
| `010B` | 24 V DC — no voltage | Faulty plug connection · Cable break | Check the wiring. |
| `010C` | 24 V DC — leakage current | Power supply unit defective | Replace the component. |
| `010D` | 230 V AC — no voltage | Control defective | Replace the functional module. |
| `010E` | 230 V AC — leakage current | Control defective | Replace the functional module. |
| `010F` | 230 V AC — continuous overcurrent | Control defective | Replace the functional module. |
| `0110` | 230 V AC — brief overcurrent | Control defective | Switch off. Disconnect the 230 V bus cable from the control and switch on. If it recurs, replace the unit/module. |
| `0111` | 230 V AC — current interrupted | Control defective | As `0110`. |
| `0128`–`0133` | *Controller not found* — odour extraction, shower unit, lid lever, dryer module, hot water, seat heating, lateral panel, user detection, proximity sensor, orientation light, dryer assembly, instantaneous heater | Faulty plug connection · Cable break · Control defective | Check the wiring. Replace the component. |
| `0134`–`0139` | *No feedback* — shower unit, lid lever, hot water, user detection, proximity sensor, dryer assembly | Faulty plug connection · Cable break · Control defective | Check the wiring. Replace the component. |
| `013A` | Descaling process failed | Error during the descaling process | Restart the device. Wait for the rinse. Run descaling again without descaling agent. |

`0136` (hot water, no feedback) additionally lists **no water supply** → check
the water supply, and **fill level sensor scaled/dirty** → clean or replace.

## 03xx — Odour extraction

6 codes: `0300`, `0301`, `0308`, `0309`, `030A` generic, plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `030B` | Fan — current interrupted | Faulty plug connection · Functional unit/module defective | Check the wiring. Replace the functional module. |

## 04xx — Shower unit

9 codes. `0400`, `0401`, `0408`, `0409`, `040A` generic, plus the four that
describe real mechanics:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `040B` | **Spray arm drive — wrong reference** | Functional unit/module defective · Faulty plug connection · **Magnet missing/corroded** | Replace the functional module. Check the wiring. **Replace the spray arm.** |
| `040C` | Multi-way valve — wrong reference | Mechanical blockage | Check freedom of movement. |
| `040D` | Spray arm drive — step loss | Faulty plug connection · Spray arm blocked/obstructed/dirty | Check the wiring. Clean the spindle drive. Check freedom of movement inside the WC bowl. Replace the functional module. |
| `040E` | Multi-way valve — step loss | Multi-way valve blocked or defective | Replace the multi-way valve. |

## 05xx — Lid lever (Mera Comfort)

10 codes. `0500`, `0501`, `0508`, `0509`, `050A` generic, plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `050B` | **Angle sensor — short circuit to supply voltage** | Faulty plug connection · Functional unit/module defective | Check the wiring. Replace the functional module. |
| `050C` | **Angle sensor — short circuit to ground** | Faulty plug connection · Functional unit/module defective | Check the wiring. Replace the functional module. |
| `050D` | Motor — overload | Constant opening and closing | Protection circuit. Operation resumes after 15 minutes. |
| `050E` | WC lid — blocked | Lid opening force too high · Functional unit/module defective | Check mechanical resistance. Replace the functional module. |
| `050F` | WC lid — wrong reference | Mechanical blockage · Motor defective | Check mechanical resistance. Replace the functional module. |

## 06xx — Dryer module

17 codes. Generic set plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `060B` | Fan — current interrupted | Faulty plug connection · Mechanical blockage | Check the wiring. Check freedom of movement. |
| `060C` | Fan — current out of tolerance | Mechanical blockage · Unit/module defective | Check freedom of movement. Replace the ventilation unit/module. |
| `060D` | Fan — speed out of tolerance | Mechanical blockage · Unit/module defective | Check freedom of movement. Replace the ventilation unit/module. |
| `0610` | Mains voltage missing | Faulty plug connection · Cable break | Check the wiring. |
| `0611` | 230 V AC — continuous overcurrent | Unit/module defective | Replace the ventilation unit/module. |
| `0612` | 230 V AC — brief overcurrent | Unit/module defective | Replace the ventilation unit/module. |
| `0613` | 230 V AC — leakage current | Heating element defective | Replace the heating element/module. |
| `0614` | Heating — current interrupted | Heating element defective · Faulty plug connection · Cable break | Check the wiring. Replace the heating element/module. |
| `0615` | Heating — overheated | Heating element defective | Replace the heating element/module. |
| `0616` | Temperature sensor — open circuit | Unit/module defective | Replace the heating element/module. |
| `0617` | Temperature sensor — short circuit | Unit/module defective | Replace the heating element/module. |
| `0618` | Temperature sensor — error | Unit/module defective | Replace the heating element / ventilation unit / module. |

## 07xx — Hot water production

30 codes — the largest table. Generic set plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0709` | Solenoid valve — current interrupted | Cable break · Control defective | Check the wiring. Replace the hot water control. |
| `070A` | Solenoid valve — overcurrent | Faulty plug connection · Cable break · Solenoid valve defective | Check the wiring. Replace the component. |
| `070B` | Solenoid valve — leakage current | Solenoid valve defective · Control defective | Replace the component / the hot water control. |
| `070C` | Boiler temperature sensor — open circuit | Faulty plug connection · Sensor defective | Check the wiring. Replace the component. |
| `070D` | Boiler temperature sensor — short circuit | Sensor defective · Control defective | Replace the component / the hot water control. |
| `070E` | Outlet temperature sensor — open circuit | Faulty plug connection · Sensor defective | Check the wiring. Replace the component. |
| `070F` | Outlet temperature sensor — short circuit | Sensor defective · Control defective | Replace the component / the hot water control. |
| `0710` | Boiler temperature sensor — overheating | Sensor defective · Control defective | Replace the component / the hot water control. |
| `0711` | Outlet temperature sensor — overheating | Sensor defective · Control defective | Replace the component / the hot water control. |
| `0712` | Temperature regulation — error | Sensor defective · Control defective | Replace the component / the hot water control. |
| `0713` | 230 V AC — no voltage | Faulty plug connection · Cable break | Check the wiring. |
| `0714` | Heating element — current interrupted | Unit/module defective · **Thermal cutout has tripped** | Replace the module. **Reset.** |
| `0715` | Heating element — continuous overcurrent | Faulty plug connection · Cable break · Heating element defective | Check the wiring. Replace the module. |
| `0716` | Heating element — brief overcurrent | Heating element defective | Replace the module. |
| `0717` | Heating element — leakage current | Heating element defective | Replace the module. |
| `0718` | Instantaneous heater pump — current interrupted | Control defective · Faulty plug connection · Cable break · Water pump defective | Check the wiring. Replace the component / the hot water control. |
| `0719` | Instantaneous heater pump — overcurrent | Water pump defective · Control defective | Replace the component / the hot water control. |
| `071A` | Instantaneous heater pump — leakage current | Water pump defective · Control defective | Replace the component / the hot water control. |
| `071B` | Boiler pump — current interrupted | Faulty plug connection · Cable break · Water pump defective | Check the wiring. Replace the component. |
| `071C` | Boiler pump — overcurrent | Water pump defective · Control defective | Replace the component / the hot water control. |
| `071D` | Boiler pump — leakage current | Control defective | Replace the hot water control. |
| `071E` | Cold water fill level sensor — error | Faulty plug connection · Cable break · **Sensor scaled/dirty** · Control defective | Check the wiring. **Clean or replace.** Replace the hot water control. |
| `071F` | Hot water fill level sensor — error | As `071E` | As `071E`. |
| `0728` | Cold water level rises too slowly | **No water supply** · Faulty plug connection · Cable break · Sensor scaled/dirty | **Check the water supply.** Check the wiring. Clean or replace. |
| `0729` | Hot water level rises too slowly | As `0728` | As `0728`. |
| `072A` | Cold water level falls too slowly | Faulty plug connection · Sensor scaled/dirty · Control defective | Check the wiring. Clean or replace. Replace the hot water control. |
| `072B` | Hot water level falls too slowly | As `072A` | As `072A`. |

## 08xx — Seat heating (Mera Comfort)

11 codes: `0800`, `0801` generic, then `0810`–`0818`:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0810` | 230 V AC — no voltage | Faulty plug connection · Cable break | Check the wiring. |
| `0811` | 230 V AC — continuous overcurrent | Unit/module defective | Replace the seat heating control. |
| `0812` | 230 V AC — brief overcurrent | Seat heating defective | Replace the module / the seat heating control. |
| `0813` | 230 V AC — leakage current | Seat heating defective | Replace the module / the seat heating control. |
| `0814` | Heating foil — current interrupted | Control defective | Replace the seat heating control. |
| `0815` | Heating foil — overheated | Faulty plug connection · Cable break | Check the wiring. |
| `0816` | Temperature sensor — open circuit | Seat heating defective | Replace the functional module. |
| `0817` | Temperature sensor — short circuit | Temperature sensor defective | Replace the functional module. |
| `0818` | Temperature regulation — error | Temperature sensor defective | Replace the module / the seat heating control. |

## 09xx — Lateral control panel

3 codes: `0900`, `0901` generic, plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0908` | Key — permanent detection | Key pressed for more than 60 seconds · Mechanical blockage · Unit/module defective | **Inform the customer.** Check the left design cover. Replace the functional module. |

## 0Axx — User detection

5 codes.

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0A00` | Factory data — write failed | Faulty read/write operation | Restart. If it recurs, replace the unit/module. |
| `0A01` | Operating data — write failed | Faulty read/write operation | Restart. If it recurs, replace the unit/module. |
| `0A08` ² | Sensor — permanent detection | **User seated for more than 1 hour** · **Heavy object on the seat or lid** · Mechanical obstruction · Unit/module defective | **Inform the customer.** Check freedom of movement. Replace the functional module. |
| `0A09` | Sensor — open circuit | Unit/module defective | Replace the functional module. |
| `0A0A` | Sensor — negative weight detected | **Heavy object on the seat or lid** | Inform the customer. |

² The manual prints this row's code as a second `0A01`. Every other module
numbers its first non-data fault `x08`, so the catalog maps it to `0A08` and
says so in a comment. **UNVERIFIED** — if the device ever reports either
number, both resolve to a sensible description.

## 0Bxx — Proximity sensor (Mera Comfort)

3 codes: `0B00`, `0B01` generic, plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0B09` | Measured-value preparation — error | Unit/module defective | Replace the functional module. |

## 0Cxx — Orientation light (Mera Comfort)

3 codes: `0C00`, `0C01` generic, plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0C09` | Brightness sensor — error | Unit/module defective | Replace the functional module. |

## 0Dxx — Interface module

7 codes: `0D00`, `0D01`, `0D08` generic, plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0D09` | WC control supply — wrong voltage | Connected WC control incompatible or defective · Unit/module defective | Check the WC control. Replace the functional module. |
| `0D0A` | WC control supply — overcurrent | Faulty plug connection · **Short circuit** · WC control incompatible or defective | Check the wiring. Check the WC control. |
| `0D0B` | Balance regulator — error | Unit/module defective | Replace the functional module. |
| `0D0C` | Communication with the WC control — error | Faulty plug connection · Cable break · WC control incompatible or defective | Check the wiring. Check the WC control. Replace the functional module. |

## 0Exx — Dryer assembly (2020)

7 codes: `0E00`, `0E01`, `0E08`, `0E09`, `0E0A` generic, plus:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0E0B` | **Dryer arm drive — wrong reference** | Faulty plug connection · **Magnet missing/corroded** · Mechanical obstruction | Check the wiring. **Replace the dryer nozzle.** Check freedom of movement. Replace the functional module. |
| `0E0D` | Dryer arm drive — step loss | Dryer arm blocked/stiff/dirty | Clean the spindle drive. Check freedom of movement inside the WC bowl. Replace the functional module. |

Note the symmetry with `040B`/`040D`: both arms use a magnet as position
reference, and both fail the same way when it corrodes.

## 0Fxx — Instantaneous water heater

7 codes, no `x00`/`x01` pair:

| Code | Fault | Cause | Measure |
|---|---|---|---|
| `0F08` | 230 V AC — no voltage | **Thermal cutout** · Cable break | **Reset.** Check the wiring. |
| `0F09` | Inlet temperature sensor — open circuit | Faulty plug connection · Unit/module defective | Check the wiring. Replace the functional module. |
| `0F0A` | Inlet temperature sensor — short circuit | Cable break · Faulty plug connection | Check the wiring. |
| `0F0B` | Outlet temperature sensor — open circuit | Unit/module defective | Replace the functional module. |
| `0F0C` | Outlet temperature sensor — short circuit | Temperature sensor defective | Replace the functional module. |
| `0F0D` | Outlet temperature sensor — overheating | Temperature sensor defective | Replace the functional module. |
| `0F0E` | Temperature regulation — error | Temperature sensor defective | Replace the functional module. |

---

## Faults without an error code

The manual carries eight further sections — *"Défauts sans code erreur"* — for
symptoms the firmware does not encode: odour extraction, shower unit, lid
lever, hot water production, seat heating, side control panel, orientation
light and dryer assembly. These are diagnosed by symptom, not by code, and are
therefore **invisible to this app**: a lid that misbehaves without tripping
`050D`/`050E`/`050F` leaves `LAST_ERROR` at 0.

That is worth stating plainly, because it is the most likely reason the app
shows "No error" while something is visibly wrong.

### Lid lever — symptoms with no code

> **Field note (2026-08-19).** A Geberit service technician on site described
> the lid mechanism as a known early-production weakness on these units — a
> *barnesykdom* — and confirmed it produces **no error code**: the firmware
> leaves `LAST_ERROR` at 0 while the lid misbehaves. So a lid that closes on
> its own, does not open fully, or collides is expected to show "No error" in
> this app. Do not read that as the toilet being fine; it is the documented
> behaviour for this class of fault, and the fix is mechanical (calibration or
> a lid-lever replacement under warranty), not something the app can clear.
>
> On this device the fix was a parts replacement, not calibration:
>
> | Part | Description | Replaced |
> |---|---|---|
> | `243.212.00.1` | Lid lifter with control (lokkløfter med styring) | 2026-08-19 |
> | `243.216.11.1` | Heated WC seat | 2025-10-08 |
>
> The lid lifter is a single module that carries both the motor and the lid
> sensor, so its replacement resets the reference this app reads at SPL index
> 12. That index read 16 originally and 11/15 after the fault developed; a
> fresh reading after this replacement is the clean baseline to record.

The one most likely to be met in practice, reproduced here because a lid
fault is what sends people looking. Causes are listed per symptom in the
manual; the measures are drawn from the same table.

| Symptom | Causes the manual lists |
|---|---|
| Collision | Lid position incorrectly adjusted · Lid lever defective |
| Does not open | Device switched off · Function disabled · Lid lever defective |
| Does not open on approach | Proximity sensor misadjusted or defective · Upper design cover not detected |
| **Does not open fully** | **Lid position incorrectly adjusted** · Lid lever defective |
| Does not open reliably | Proximity sensor misadjusted · Upper design cover not detected |
| Opens too slowly | Lid lever defective |
| Opens unexpectedly | Proximity sensor incorrectly adjusted |
| Does not close | Function disabled · User detection active |
| Does not close from the remote | Demo mode enabled |
| **Closes unexpectedly** | **Lid lever defective** · User detection defective · Proximity sensor misadjusted |

Measures, in the order the manual gives them: correct the setting ·
**calibrate** · check operation manually · check the electrical supply ·
switch the device on · enable the function · check the upper design cover is
present and closed · check its magnet · replace the component or the function
module.

Two entries deserve attention because they are cheap to check and easy to
miss:

**"Upper design cover: open/missing — check the magnet."** Several lid
symptoms trace to the design cover not being detected, which is a magnet, not
electronics.

**Demo mode.** If the lid will not close from the remote, demonstration mode
being left on is a listed cause — and it sits in the same
`[Care and maintenance]` menu as the lid calibration, one item before it.

There is a matching *Actuator* table: unusual noises trace to loose mounting
or a defective lid lever, and an actuator that moves in jerks to the lid lever
itself.

For the other seven sections, consult the manual directly.

## Historical error storage

**CONFIRMED absent over BLE.** A dedicated search of the complete jens62
corpus — protocol documents, both mock servers built from real-device
captures, the console app and the Home Assistant integration — found no
procedure, register or behaviour resembling an error history, fault memory,
event log or per-error timestamps in the Mera protocol.

The main control's scope in Tableau 7 does list *"Mémoire des défauts"* (fault
memory), so the device keeps one internally — but it is reachable through
Geberit's ServiceApp, not through this BLE interface.

Consequence: **the only error history available is the one Homey records
itself**, from the moment app version 1.7.1 first observed a value. Homey
cannot backfill faults it never saw.

## What the app records

- `aquaclean_error_code` — the raw number from parameter 6, with **Insights
  history** (step chart). Every change is a timestamped entry.
- `aquaclean_error_text` — the manual's notation plus the description, in
  English or Norwegian: `040B — Shower unit: spray arm drive lost its
  reference (missing/corroded magnet, wiring or defective module)`.
- Only a read that actually carried parameter 6 may change either value. A
  missing parameter, malformed frame, timeout or unreachable toilet keeps the
  last known value, so a failed read can never fabricate an "error cleared".
- An unchanged value is not rewritten: a standing fault is one step in the
  chart, and `42 → 0 → 42` is three entries and two occurrences.
- Flow triggers `aquaclean_error_occurred` and `aquaclean_error_cleared` carry
  the code, the hex form and the description as tokens. "Cleared" describes
  the fault that went away, not the zero that replaced it.
- Unknown codes stay visible as their hex value with a quote-this-to-service
  hint. Nothing maps an unknown value to "no error".

Implementation: `lib/aquaclean-error-codes.js` — 149 entries, each with an
English and a Norwegian description.

---

## Live readout — 2026-08-17, this device

Read-only, one connection. Full output in `error-diagnostics-readout.json`
next to the repository.

**GATT services (complete):**

| Service | Content |
|---|---|
| `3334429d…a03e0000` | Geberit RPC protocol, 8 characteristics (A1–A8) |
| `1800` / `1801` | Generic Access / Generic Attribute |
| `180a` | Device Information: manufacturer `Geberit`, firmware `BLD 01 1`, model and serial literally `n/a` |

No other service exists — **the Alba/BLE 2.0 datapoint service is absent**, by
enumeration rather than inference.

**System parameters:**

| Index | Result | | Index | Result |
|---|---|---|---|---|
| 0–5 | 0 (idle) | | 8–10 | rejected, status `0x80` |
| **6 LAST_ERROR** | **0** | | 11 | 0 |
| 7 service state | 0 | | 12 / 13 / 14 | 11 / 13 / 10 |

**Same-connection production reads:** descale statistics gave
`daysUntilNextDescale = 58` and `daysUntilShowerRestricted = 14` while SPL 13
read 13 and SPL 14 read 10 — simultaneous proof that positional name guesses
for SPL 11–14 do not hold on this firmware.

**Observed fault, 2026-08-17/18:** `LAST_ERROR` stood at **1035 (`040B`)** for
roughly 19 hours before returning to 0, recorded in Homey Insights. Per the
04xx table that is the spray arm drive losing its position reference, most
commonly a missing or corroded magnet on the spray arm.

## Datapoint registers — and why this app cannot read them

**CONFIRMED not applicable to Mera Comfort.** The `DP_*` constants in
`dp_ids.py` (jens62) describe the **BLE 2.0 / "Alba" protocol**, where each
register is individually readable by datapoint id. That project's own
`mera-comfort-alba-mapping.md` states the two families expose the same logical
features "via entirely different mechanisms": Mera Comfort speaks structured
RPC procedures, Alba speaks datapoint reads/writes.

These are **datapoint ids, not error codes**. `DP_SERVO_ERROR_STATUS = 166`
means "register 166 holds servo error status" — it says nothing about the
values that register holds, and nothing connects 166 to the LAST_ERROR
namespace.

The register catalogue also contains a full lid-lifter telemetry block —
position (1008), setpoint (32594), angle (32570), motor current (32569), motor
voltage (32572), angle limits (1058–1060) — exactly what one would want for a
failing lid sensor, and all of it unreachable here. Over BLE on this model a
lid fault can only surface as a non-zero LAST_ERROR in the 05xx range.

## Reading the toilet's own fault report

There is a manufacturer path that reads far more than the single `LAST_ERROR`
this app can see: the **Geberit Service app** ("Geberit Service", iOS App Store
id `1015277447`, Android `com.geberit.acmeraserviceapp`). It connects to the
same shower toilet over Bluetooth and reads out a full on-site report — fault
history, counters and diagnostics — and can install firmware.

It is **not usable by an owner.** Sign-in requires a Geberit ID that Geberit
must activate for a trained service technician; registering an account does not
grant access, and there is no local bypass — the toilet answers a token issued
by Geberit's server, not the app itself. The practical way to benefit from it
is to ask the attending technician to show the report on screen and note the
codes, which can then be looked up in the tables above.

## System parameter mapping

Moved to [PROTOCOL.md](PROTOCOL.md), where each index is listed with how it
was confirmed. The one that matters here is **index 6, LAST_ERROR**, confirmed
by three independent sources and by this app.

## Sources

- **Geberit AquaClean Mera, Manuel d'entretien `967.008.00.0(04)`, 05-2023** —
  the fault code tables, module overview and repair measures.
- Geberit AquaClean Mera Comfort user manual `966.732.00.0(05)` — the remote
  control's error-message menu and the symptom tables.
- [jens62/geberit-aquaclean](https://github.com/jens62/geberit-aquaclean) —
  `bluetooth_le/LE/dp_ids.py`, `docs/developer/mera-comfort-alba-mapping.md`,
  `docs/developer/unknown-procedures.md`, `docs/developer/mock-geberit-mera.md`,
  `custom_components/geberit_aquaclean/coordinator.py`,
  `aquaclean_console_app/.../GetSystemParameterList.py`.
- [thomas-bingel/geberit-aquaclean](https://github.com/thomas-bingel/geberit-aquaclean)
  — original C# labels for the SPL indices.
- Live readings from this device, 2026-08-16 to 2026-08-18.
