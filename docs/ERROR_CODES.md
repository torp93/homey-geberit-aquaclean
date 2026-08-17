# Geberit AquaClean Error Diagnostics

What error information an AquaClean Mera Comfort actually exposes over
Bluetooth, what this app records of it, and what the various register lists
floating around in reference material really are. Compiled 2026-08-17 against
a Mera Comfort (RS30.0 TS206, `Geberit AC PRO`) through an ESPHome
bluetooth_proxy.

Every claim below is marked **CONFIRMED** (verified on this device or in two
independent sources), **PROBABLE** (single credible source, not verified
here), or **UNVERIFIED**.

---

## LAST_ERROR

**CONFIRMED.** The one error datum this device exposes over BLE is *system
parameter 6* of `GetSystemParameterList` (procedure `0x0D`, context `0x01`)
— named `lastErrorCode` in the original C# protocol work and
`AC_STATUS_LAST_ERROR` in the jens62 register enumeration. The app reads it
on every full status refresh and shows it as the **Error code** capability
(`aquaclean_error_code`).

It is a single scalar: the most recent error, with `0` meaning no error.
Nothing in the protocol indicates when it was set or what preceded it.

## Confirmed LAST_ERROR codes

**None.** No public source maps the numeric values this parameter can take.

- The jens62 bridge passes the raw value through unmapped
  (`coordinator.py`: `"last_error_code": state.data_array[6]`).
- Its `ErrorCodes.py` / `docs/error-codes.md` are the *bridge's own* E-codes
  (E0001 = BLE device not found, …) — they describe the bridge software, not
  the toilet. Do not confuse the two.
- Every observation of parameter 6 on record — this device across all
  sessions, and the jens62 capture of a healthy Mera — reads `0`.
- Geberit's service tooling evidently decodes these values (a technician
  quoted a code around 50 for a lid sensor fault on this very device), but
  that table is not public.

Consequence: the app must preserve the raw number, and does. An unknown code
stays visible as its number; nothing maps unknown values to "no error".

## Error-status datapoints (DP IDs) — and why this app cannot read them

**CONFIRMED not applicable to Mera Comfort.** The `DP_*` constants in
`dp_ids.py` (jens62) describe the **BLE 2.0 / "Alba" protocol**: an
inventory-based API where each register is individually readable by DP ID.
The project's own `mera-comfort-alba-mapping.md` states the two device
families expose the same logical features "via entirely different
mechanisms" — Mera Comfort speaks structured RPC procedures (what this app
implements); Alba-family devices speak DP reads/writes.

There is no procedure in the Mera Comfort protocol that takes a DP ID. The
DP list is therefore a *firmware register catalogue*, useful for
understanding what the machine tracks internally, but unreachable from here.

These are **datapoint IDs, not error codes**. `DP_SERVO_ERROR_STATUS = 166`
means "register number 166 holds servo error status" — it says nothing about
what values that register holds, and nothing connects the number 166 to the
LAST_ERROR namespace.

### Global error datapoints (UNVERIFIED on this model, from `dp_ids.py`)

| DP | Name |
|---|---|
| 87 | `DP_FATAL_ERROR_COUNT` |
| 358 | `DP_GLOBAL_FATAL_ERROR` |
| 359 | `DP_GLOBAL_ERROR` |
| 360 | `DP_GLOBAL_WARNING` |
| 759 | `DP_ERROR_MONITORING_DISABLE_STATUS` |

### Subsystem error datapoints (UNVERIFIED on this model, from `dp_ids.py`)

| DP | Subsystem | | DP | Subsystem |
|---|---|---|---|---|
| 88 | Odour extraction | | 604 | Temp flush |
| 93 | Power supply | | 713–716 | Interval/time/remote flush, user interface |
| 166 | Servo | | 764 | Water heater |
| 224 | Valve | | 765 | Level control |
| 226 | Sensor | | 766 | User detection |
| 354 | IDC | | 789 | Water pump |
| 377 | Control unit | | 790 | Spray-arm drive |
| 378 | Lighting | | 819 | Seat heater |
| 478 | Temperature sensor | | 982 | Descaling |
| 480 | Flow sensor | | 1063 | Manifold valve |
| 512 | Level sensor | | 1064 | Dryer fan |
| 532/537/541/546 | GBus/Ethernet/WiFi/Join | | 1065 | Dryer heater |
| 594/598/602 | System app/Move device/IoT | | | |

Encodings, value ranges and model applicability are unknown for all of the
above. None of them is readable on a Mera Comfort.

## Fatal error counter

`DP_FATAL_ERROR_COUNT` (DP 87) exists in the register catalogue.
**UNVERIFIED**: datatype, persistence across power loss, reset behaviour and
whether it pairs with any per-error storage are all unknown — and it is not
readable on a Mera Comfort for the transport reason above. It was not read.

## Lid-lifter diagnostics

The register catalogue contains a full lid-lifter telemetry block —
position (DP 1008), setpoint (32594), angle (32570), motor current (32569),
motor voltage (32572), angle limits (1058–1060), plus `DP_SERVO_ERROR_STATUS`
(166) and `DP_MOVE_DEVICE_ERROR` (598). Exactly the measurements one would
want for a failing lid sensor.

**All of it is Alba/firmware-internal. None of it is reachable over the Mera
Comfort BLE protocol** (see the live readout below). The only lid-related
data this protocol carries are *settings*
(sensor range, auto open/close — common settings 4/6/7) and the calibration
command family (33–36), none of which report sensor health.

Consequence for the physical fault: over BLE, a lid sensor failure can only
ever surface as a nonzero LAST_ERROR. That is why the Insights history on
that single value matters.

## Historical error storage

**CONFIRMED absent, to the limit of available evidence.** A dedicated search
of the complete jens62 corpus (all protocol docs, both mock servers built
from real-device captures, the console app, the HA integration) found no
procedure, register or behaviour resembling an error history, fault memory,
event log or per-error timestamps for the Mera protocol. The Mera Comfort
exposes the current/last error scalar — nothing historical.

The toilet may well store more internally for Geberit's service tooling, but
it is not reachable over this BLE interface.

Consequence: **the only error history that exists for this device is the one
Homey records itself**, which starts when app version 1.7.1 first observes a
value — see `README` section on Insights. Homey cannot backfill faults it
never saw.

## System parameter mapping — proven vs. positional guessing

Confirmed on this device (RS30) unless noted:

| Index | Meaning | Status |
|---|---|---|
| 0 | User present | **CONFIRMED** (live, both projects agree) |
| 1 | Anal shower running¹ | **CONFIRMED here**; jens62 hardware disagrees¹ |
| 2 | Lady shower running | **CONFIRMED** (both) |
| 3 | Dryer running¹ | **CONFIRMED here, live-flipped via command**; jens62 hardware disagrees¹ |
| 4 | Descaling state | **CONFIRMED** (both) |
| 5 | Descaling minutes | **CONFIRMED** (both) |
| 6 | **LAST_ERROR** | **CONFIRMED** (C# labels + jens62 BLE log + this app) |
| 7 | Service state | **CONFIRMED** (named in two sources; sat 0 through a live service-menu calibration here, so it does *not* flag that routine) |
| 8–10 | — | **Rejected (status 0x80) on this device.** On jens62's device they echo 0. Model/firmware variance is real. |
| 11–14 | Readable, values 0/varies/13/10 | **UNKNOWN.** The `AC_STATUS_*` enumeration would suggest names, but this device's rejection of 8–10 breaks positional alignment, and the suggestion for index 13 ("days until descale") contradicts the device's own statistics (13 ≠ 58). Do not map these positionally. |

¹ On jens62's hardware (`HB2304EU298413`), index 3 tracks the *anal shower*
and index 1 never changes; on this Mera Comfort, index 3 verifiably tracks
the *dryer* (flipped live via command 2 on 2026-08-09) and index 1 the anal
shower. SPL index semantics differ between models/firmware. Nothing in this
app relies on indices beyond 0–7.

An earlier hypothesis that parameter 12 tracked lid position is **withdrawn**:
the value did not follow the lid (identical fully open and fully closed) and
the positional name suggestion is unreliable per the above.

## Mera vs Mera Comfort vs Alba notes

- "Mera" and "Mera Comfort" both speak the RPC procedure protocol; observed
  SPL index support differs by firmware (this RS30 rejects 8–10; another
  device echoes them as 0).
- Alba-family devices speak the DP protocol; their inventory *lacks* lady
  shower, dryer, odour extraction, seat heating and orientation light — and
  gains per-register reads including error statuses. The two worlds do not
  mix on one device.

## Unknown / unverified registers

Everything in the DP catalogue, on this model. SPL indices 11–14. The
LAST_ERROR value namespace. The `AC_STATUS_*` constants above 65607 as they
would apply to this device.

## What the app records (v1.7.1)

- `aquaclean_error_code` mirrors SPL parameter 6 on every full refresh, with
  **Insights history enabled** (step chart) — every change of value is a
  timestamped entry.
- Only a read that actually carried parameter 6 can change the value. A
  missing parameter, malformed frame, timeout or unreachable toilet keeps
  the last known value; a failed read can never fabricate an
  "error cleared" (0) entry.
- An unchanged value is not rewritten, so a long-standing error is one step
  in the chart, not a flood of entries. `42 → 0 → 42` is three entries and
  two `error occurred` Flow triggers.
- Flow triggers: `aquaclean_error_occurred` (0 → nonzero, with the code as
  token), `aquaclean_error_cleared` (nonzero → 0),
  `aquaclean_error_code_changed` (any change).

## Live readout — 2026-08-17, this device

Read-only, one connection, script `read-error-diagnostics.js` (kept next to
the repo). Full output in `error-diagnostics-readout.json`.

**GATT services (complete list):**

| Service | Content |
|---|---|
| `3334429d…a03e0000` | Geberit RPC protocol, 8 characteristics (A1–A8) |
| `1800` / `1801` | Generic Access / Generic Attribute |
| `180a` | Device Information: manufacturer `Geberit`, firmware `BLD 01 1`, model and serial literally `n/a` |

No other service exists — **the Alba/BLE 2.0 DP service is absent**, so every
`DP_*` register above is confirmed unreachable on this hardware, by
enumeration rather than inference.

**System parameters:**

| Index | Result | | Index | Result |
|---|---|---|---|---|
| 0–5 | 0 (idle, no shower/dryer) | | 8–10 | rejected, status 0x80 |
| **6 LAST_ERROR** | **0 — no current error** | | 11 | 0 |
| 7 service state | 0 | | 12 / 13 / 14 | 11 / 13 / 10 |

**Same-connection production reads:** descale statistics said
`daysUntilNextDescale = 58` and `daysUntilShowerRestricted = 14` while SPL 13
read 13 and SPL 14 read 10 — fresh, simultaneous proof that the positional
name guesses for SPL 11–14 do not hold on this firmware.

Note on the physical lid fault: LAST_ERROR reads 0 *now*, after the fault was
diagnosed by a technician. Whether it was nonzero while the lid misbehaved is
unknowable — there was no history recording at the time. That is precisely
what v1.7.1 fixes for the next occurrence.

## Sources

- [jens62/geberit-aquaclean](https://github.com/jens62/geberit-aquaclean) —
  `bluetooth_le/LE/dp_ids.py` (register catalogue),
  `docs/developer/mera-comfort-alba-mapping.md` (protocol split),
  `docs/developer/unknown-procedures.md` (SPL index evidence),
  `docs/developer/mock-geberit-mera.md` (real-Mera capture: LastError=0),
  `custom_components/geberit_aquaclean/coordinator.py` (raw pass-through),
  `aquaclean_console_app/.../GetSystemParameterList.py` (SPL semantics).
- [thomas-bingel/geberit-aquaclean](https://github.com/thomas-bingel/geberit-aquaclean)
  — original C# labels for SPL indices.
- Live readings from this device: `../..//lid-calibration-snapshots.jsonl`
  and the audit sweeps of 2026-08-16/17.
