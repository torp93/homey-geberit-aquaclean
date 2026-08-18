# The remote control's service menus

How to reach the AquaClean's own settings from the remote control — including
the lid calibration and the error-code display, the two that matter most when
something is wrong.

**Source:** Geberit AquaClean Mera Comfort user manual `966.732.00.0(05)`,
sections "How to program the device" and "Care and maintenance main menu".
Verified on a Mera Comfort.

---

## Getting in

The menus live on the **rear side** of the remote control, not the front. The
front side is only for daily use — shower, dryer, lid, profiles.

1. Turn the remote over and **press any button on the back** to wake the LCD
   display.
2. Move between the three main menus with the **`<left>` / `<right>`** arrow
   keys:
   - `[Basic settings]`
   - `[Profile settings]`
   - `[Care and maintenance]` ← the lid calibration and the error code live here
3. Step through the items inside a menu with the **`<up>` / `<down>`** arrow
   keys.

Three things worth knowing before you start:

- **Holding `<up>` for more than 2 seconds** jumps back to `[Basic settings]`
  from anywhere.
- **The display switches off after 30 seconds** to save the battery. Anything
  half-finished is left half-finished.
- **To save a change you must run the menu through to the end**, until the
  main menu appears again. Walking away mid-menu discards the change.

## Where things are in [Care and maintenance]

The items come in a fixed order. Answering `no` to a prompt moves on to the
next one, so you can page through to the one you want:

| # | Display | What it is |
|---|---|---|
| 1 | `Next descaling in ddd days` | Days remaining |
| 2 | `Descale device now?` | Starts descaling — needs descaling agent |
| 3 | `Descaling completed` | Confirmation that descaling finished |
| 4 | `Filter replaced?` | Resets the ceramic filter counter |
| 5 | `Show device info?` | Model, article number, **serial number**, commissioning date |
| 6 | **`Error message`** | **The fault code — see below** |
| 7 | `Demonstration mode` | Showroom mode |
| 8 | **`Set WC lid?`** | **The lid calibration — see below** |

## Reading the error code

Item 6, `Error message`, shows a code as four characters, e.g. `040B`.

The manual is explicit: *"An error code is displayed only in the event of an
error."* No error, nothing shown.

This is the same value the Homey app reads over Bluetooth as system parameter
6 — the app just shows it as a decimal number alongside the hex form. `040B`
on the remote is `1035` in the raw protocol; both mean the spray arm drive has
lost its position reference.

What each code means is in [`ERROR_CODES.md`](ERROR_CODES.md) — all 149 of
them, with the cause and the repair measure from the service manual.

## Calibrating the WC lid

Item 8. The manual describes it as *"Safety query for setting the opening
angle of the WC lid"*.

1. Page down to **`Set WC lid?`**
2. Answer **`yes`**
3. The display shows **`WC lid position`** and the lid moves to its current
   set position
4. Adjust the opening angle, then run the menu through to the end so the value
   is stored

**When to use it.** The user manual lists exactly one symptom for this:

> *"The WC lid touches the wall — WC lid set incorrectly → Set the opening
> angle of the WC lid."*

So it is a fit adjustment for the room, not a repair. There is no
factory-correct number — the right angle is the one where the lid stays open
on its own, clears the wall and the cistern, and does not need pushing.

**Do not push the lid past its set top position by hand.** It reads as
travel beyond the learned endpoint and the lid closes itself. Repeatedly
forcing a motorised lid wears the drive.

**If a lid sensor is faulty, calibrate after it is replaced, not before.** The
routine measures the endpoint through that sensor, so calibrating against a
failing one stores a wrong value. Codes `050B`, `050C` and `050F` in
`ERROR_CODES.md` cover the angle sensor and lid reference faults.

## The same calibration over Bluetooth

The Homey app can drive this routine too, from the device's **Repair** screen
— commands 33–36 in the AquaClean protocol (`START_LID_CALIBRATION`,
`LID_OFFSET_INCREMENT`, `LID_OFFSET_DECREMENT`, `LID_OFFSET_SAVE`).

Two warnings from experience, both now handled by the app:

- Starting the routine puts the toilet into a service state where normal
  operation stops and its own remote is locked out. Closing the repair screen
  without saving used to leave it there; the app now finishes the routine on
  the way out.
- The toilet reports no lid position over Bluetooth, so neither the app nor
  anything else can read the angle back. Watch the lid, not a screen.

The remote is the more reliable route. The app's version exists for the case
where the remote is not to hand.

## Related

- [`ERROR_CODES.md`](ERROR_CODES.md) — every fault code, cause and measure
- Geberit AquaClean Mera Comfort user manual `966.732.00.0(05)`
- Geberit AquaClean Mera service manual `967.008.00.0(04)` — for the fault
  tables and repair procedures behind the codes
