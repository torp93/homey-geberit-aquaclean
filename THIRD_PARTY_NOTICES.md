# Third-party notices

The Geberit application-protocol implementation was informed by these public
projects:

- `jens62/geberit-aquaclean`
  (<https://github.com/jens62/geberit-aquaclean>), MIT License.
- `thomas-bingel/geberit-aquaclean`
  (<https://github.com/thomas-bingel/geberit-aquaclean>).

No third-party runtime code or dependency is bundled in the Homey app. The
references were used to verify UUID roles, message framing, CRC behavior,
session initialization, flow control, and safe system-state parameters.

## Icons

The app icon, the driver icon, and every capability icon are derived from
**Material Design Icons** by Pictogrammers
(<https://pictogrammers.com/library/mdi/>), licensed under the
**Apache License 2.0**.

Each icon file names the source glyph in a comment. The path data is used
verbatim; only the canvas was scaled from the original 24x24 viewBox to the
500x500 one Homey expects.

Glyphs used: `bluetooth-connect`, `bluetooth-off`, `clock-check-outline`,
`gender-female`, `hair-dryer`, `air-filter`, `fan-clock`, `water-sync`,
`toilet`, `stop-circle-outline`, `spray-bottle`, `alert-circle-outline`,
`text-box-outline`, `refresh`.

`anal-shower.svg` is derived from the MDI glyph `sprinkler-variant`: the canvas
is rotated a quarter turn and the downward spray fan is removed, so the nozzle
reads as a shower arm spraying upward. The remaining path data is unmodified.

### Icons taken from the jens62 reference repository

Eight capability icons come from `graphics/` in
<https://github.com/jens62/geberit-aquaclean>. They are scaled and centred into
a 500x500 canvas; the drawings themselves are unchanged.

| File in this app | Source file | Notes |
|---|---|---|
| `anal-shower.svg` | `analshower.svg` | Inkscape, no stated origin |
| `lady-shower.svg` | `ladywash.svg` | Inkscape, no stated origin |
| `dryer.svg` | `airdryer.svg` | Inkscape, no stated origin |
| `odour.svg` | `odourextraction.svg` | Inkscape, no stated origin |
| `lid.svg` | `adjustabletoiletseat.svg` | Inkscape, no stated origin |
| `flush.svg` | `flush.svg` | Inkscape, no stated origin |
| `descaling.svg` | `descaling.svg` | Inkscape, no stated origin |
| `user-seat.svg` | `is_user_sitting.svg` | Metadata names `icons8-toilet-100.svg` — **originally from Icons8** |

These files are redistributed here with attribution, on the basis of that
repository's MIT licence. This app builds directly on the protocol work in
`jens62/geberit-aquaclean`, and both the icons and the protocol knowledge are
credited to that project.

**Provenance note, kept for transparency:** an MIT licence covers a
repository author's own work; where a file has third-party origins the
original licence applies. One file (`user-seat.svg`) carries metadata naming
`icons8-toilet-100.svg` as its source. If any rights holder objects to a
file's inclusion, it will be replaced on request — each icon is a separate,
drop-in-replaceable file, and a hand-drawn clean-licence alternative for
`user-seat.svg` exists and can be swapped in immediately.
