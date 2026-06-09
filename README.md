# Monaco GP

A browser-based 3D racing game: drive a modern F1-style single-seater around an
accurate Circuit de Monaco from inside the cockpit.

![stack](https://img.shields.io/badge/Babylon.js-9-blue) ![physics](https://img.shields.io/badge/physics-Havok%20(WASM)-orange)

## Features

- **Accurate Monaco layout** — centerline from real GPS circuit data, with the
  full ~42 m elevation profile (the Beau Rivage climb, Casino Square, the descent
  to Mirabeau and the hairpin, the tunnel, down to La Rascasse).
- **Real physics** — Havok rigid-body simulation with a custom raycast vehicle:
  suspension with anti-roll bars, brush tire model with friction circle,
  downforce/drag aero, 8-speed drivetrain with auto-shift, ~280 km/h top speed.
- **Cockpit view** — procedural F1 cockpit (halo, mirrors, exposed front wheels)
  with an animated steering wheel (±92°, live gear display).
- **Full collision** — continuous barrier walls around the entire lap; you cannot
  leave the circuit. Walls scrub speed; hold brake at a standstill to reverse out.
- **Synthesized engine audio** — no samples: a Web Audio V6-turbo synth tracks
  RPM/throttle continuously, with gear-shift cuts, overrun crackle, and wind noise.
- **F1 start sequence** — five red lights at 1 s intervals, a random 1–3 s hold,
  lights out and away; throttle is gated until then.
- **Lap timing** — starts on your first crossing of the line, resets each lap;
  current / last / best shown top-right. Minimap with live position bottom-left.
- **Monte Carlo environment** — procedural buildings, the harbor with yachts,
  the tunnel with its exposure change, hillside backdrop.

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake (hold at standstill to reverse) |
| `A` `D` / `←` `→` | Steer |
| `Esc` | Pause |
| `R` | Restart race |

## Run

```sh
npm install
npm run dev        # http://localhost:5173
```

Production build: `npm run build && npm run preview`.

## Development

- `npm run track` — regenerate `src/data/monaco.json` from `data-src/`
  (GeoJSON centerline + hand-authored elevation/width/feature control points).
  Also writes `tools/track-preview.svg` for visual validation.
- `?debug` URL flag — FPS/telemetry readout, `C` toggles a top-down camera,
  visible physics box; add `&auto` for the validation autopilot.
- Headless test suite (requires Chrome):
  `node tools/lap-test.mjs` (full autopilot lap), `tools/flow-test.mjs`
  (lights/pause/restart), `tools/audio-test.mjs`, `tools/telemetry-test.mjs`.

## Data attribution

Circuit centerline from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)
(`circuits/mc-1929.geojson`), MIT License. Elevation and track widths are
hand-authored approximations anchored to the published 42 m elevation delta of
the real circuit.
