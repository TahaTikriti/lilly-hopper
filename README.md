# Lily Hopper 🐸

A rhythm game in a pond. Hop your frog from lily pad to lily pad and **land on the pulse** —
on-beat landings build your combo and stir up a storm; one slip and the pond exhales back to glass.

Everything is procedural: no game engine, no audio files, no image assets.

## Play

- **Click / tap** a lily pad to hop to it, or use **arrow keys / WASD**.
- A beat ring pulses at the center of the pond — time your landings to it.
- `PERFECT` (±85 ms) and `GOOD` (±180 ms) landings grow your combo; a miss resets it.
- Combo drives **chaos**: rougher water, rain, wind, wandering pads, and extra music layers.

## Development

```bash
npm install
npm run dev        # dev server at http://localhost:5173
```

| Script                 | What it does                            |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | Start the Vite dev server               |
| `npm run build`        | Typecheck + production build to `dist/` |
| `npm run preview`      | Serve the production build locally      |
| `npm run typecheck`    | TypeScript check only (no emit)         |
| `npm run format`       | Format with Prettier                    |
| `npm run format:check` | Verify formatting (used in CI)          |

Requires Node ≥ 20.

## Architecture

```
index.html          HUD + canvas shell (Tailwind CSS v4)
src/
├── main.ts         Orchestrator: game loop, input, weather, rendering, HUD
├── game.ts         Rhythm core: beat grid, landing judgment, combo/score, chaos level
├── audio.ts        Fully synthesized adaptive soundtrack (Web Audio API)
├── entities.ts     LilyPad + Frog (squash & stretch, beat-locked hops)
├── waves.ts        2D wave-equation simulation on a height-field grid
├── water.ts        Per-pixel water renderer: refraction, caustics, reflections, foam
└── style.css       Tailwind entry + custom styles
```

The central idea: a single smoothed `chaos` scalar (0–1), driven by your combo, is read by
every system — the water gets stormier, rain falls, pads drift (raising the difficulty),
and instrument layers fade in. The audio clock **is** the judgment grid, so what you hear
is exactly what you're judged against.

## CI/CD

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)):

- **Every push / PR to `main`**: format check → typecheck → build.
- **Push to `main`**: the build is deployed to GitHub Pages automatically.

> One-time setup: in the repo settings, set **Settings → Pages → Source** to **GitHub Actions**.
