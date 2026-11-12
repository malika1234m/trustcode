# TrustCode brand guidelines

## The idea

TrustCode reports evidence, and it is honest about where the evidence stops. The mark says exactly that:

- **Two corner brackets** form a *selection frame*: the code you selected and asked TrustCode to inspect.
- **A check mark** inside it: what the checks verified.
- **The long stroke of the check breaks into fading segments**: verification goes so far, and the gaps are shown, not hidden.

The supporting motif is **diagonal hatching**, which marks anything no check covered (lines in the inspector, the "not verified" list, the final call to action).

## Logo files (`web/public/brand/`)

| File | Use |
|---|---|
| `mark-dark.svg` / `mark-light.svg` | Symbol on dark / light backgrounds |
| `mark-mono.svg` | Single colour (`currentColor`), e.g. embossing, one-colour print |
| `mark-mono-white.svg` / `mark-mono-black.svg` | Fixed white / black |
| `logo-horizontal-dark.svg` / `-light.svg` | Symbol + wordmark (wordmark uses IBM Plex Sans SemiBold; outline the text before sending to print) |
| `app-icon.svg`, `app-icon-512.png`, `app-icon-256.png` | App tile (rounded square, navy) |
| `marketplace-icon-128.png` | VS Code Marketplace (also `extension/media/icon.png` at 256 px) |
| `favicon.svg`, `app/favicon.ico` (16/32/48) | Browser tab: a simplified mark with a single faded segment so it stays legible at 16 px |
| `mark-*-1024.png` | High-resolution transparent PNGs |

In the website, use the `<Logo>` / `<LogoMark>` components (`web/components/logo.tsx`); they follow the theme automatically.

## Colour

| Role | Dark | Light |
|---|---|---|
| Background (blueprint navy) | `#0C1322` | `#F6F8FC` |
| Surface | `#121B2E` | `#FFFFFF` |
| Text | `#E7ECF5` | `#0C1322` |
| Brand / selection frame (periwinkle) | `#8E96FF` | `#4650D6` |
| Evidence / verified (teal) | `#4FD1B5` | `#0B7A63` |
| Finding (amber) | `#F2B544` | `#8A5A00` |
| Failure (coral) | `#FF7A70` | `#C2382E` |

Every text/background pair meets WCAG AA (4.5:1). Amber and coral are status colours only, never decoration.

## Typography

IBM Plex Sans (400/500/600/700) for everything; IBM Plex Mono for code only. Headlines are SemiBold, tracking −1.5 %, sentence case, left-aligned. No all-caps labels.

## Usage rules

- **Clear space:** at least the height of one corner bracket (¼ of the mark) on every side.
- **Minimum size:** mark 16 px (use `favicon.svg` below 24 px); horizontal logo 96 px wide.
- **Backgrounds:** use the dark mark on navy or any dark surface, the light mark on white or light grey. On photos or busy backgrounds, use the app tile.
- **Don't:** recolour the frame and check to the same colour (except the mono versions), rotate, add effects or shadows, put the mark inside a circle, or remove the fading segments at sizes above 24 px.
- **Marketplace:** gallery banner colour `#0C1322`, theme `dark`.

## Interface system (website)

- **Tokens** live in `app/globals.css` (`--bg`, `--card`, `--text`, `--muted`, `--dim`, `--brand`, `--ok`, `--warn`, `--err`, `--info`, `--frame`, `--check`, `--hatch`) and are exposed to Tailwind as `bg`, `card`, `fg`, `muted`, `dim`, `brand`, `ok`, `warn`, `err`, `info`. Never use raw hex in components.
- **Radii:** 8 px controls, 10 px buttons/inputs, 14 px cards, 16 px large frames.
- **Touch targets:** at least 44 px for buttons, inputs and standalone links (`.btn`, `.input`, `min-h-11`).
- **Motion:** 150–300 ms, ease-out. One unprompted motion on the landing page (the inspector's first run) and one scroll reveal (the journey timeline). Everything else answers a user action. `prefers-reduced-motion` disables all of it.
- **Hatching** (`.hatch`) means "not verified". Don't use it as decoration elsewhere.
- **Copy:** sentence case, plain verbs, no eyebrow labels, no invented numbers or testimonials.

## 3D and motion layer (landing page)

| Dependency | Version | Used for |
|---|---|---|
| `three` | 0.187 | WebGL renderer behind the hero |
| `@react-three/fiber` | 9.8 | React renderer for the Three.js scene |
| `@react-three/drei` | 10.7 | `Float` helper for the floating mark |
| `motion` | 14.11 | Scroll-triggered entrances (`motion/react`) |

| Component | What it does |
|---|---|
| `components/landing/hero-scene.tsx` | WebGL scene: three orbital rings, a particle field, the TrustCode mark as 3D tubes, neon point lights, pointer parallax. Pauses (`frameloop="never"`) when off screen; fewer particles and a lower DPR on small screens. |
| `components/landing/hero-visual.tsx` | Loads the scene lazily (`next/dynamic`, no SSR) only if WebGL exists and reduced motion is off; otherwise shows static SVG rings. Renders the product showcase as real DOM in CSS 3D perspective, with pointer tilt (fine pointers only). |
| `components/landing/tilt-card.tsx` | Feature card with perspective tilt and a pointer-following glow; mouse only, disabled with reduced motion. |
| `components/landing/reveal-motion.tsx` | One-time scroll entrance; renders plain content when the visitor prefers reduced motion. |
| `components/landing/inspector.tsx` | The interactive demo (unchanged), now under `#demo`. |

Neon tokens: `--neon-cyan #38E1FF`, `--neon-blue #5B8CFF`, `--neon-purple #A97CFF`; utilities `.text-neon`, `.neon-frame`, `.btn-neon`, `.glass`, `.pill`, `.streaks`, `.float-3d` (all in `app/globals.css`).

Content rules kept from the reference design: no Marketplace badge until the listing exists, no confidence percentage or "code is trustworthy" verdict, no prices or Monthly/Yearly toggle until billing is live, no testimonials or social links that don't exist.

## Visual-first homepage (2026-11)

The homepage presents TrustCode as a project-wide security scanner, told mostly through illustrations: short headlines, one-line captions, no paragraphs.

- **Availability is data, not copy.** Every capability's status comes from `lib/capabilities.ts` (`available` / `in-development` / `planned`, shown as Available / In development / Coming soon). Use `<CapabilityBadge name="…">` or `<StatusBadge>`; promote a capability only after it ships and is tested. The full list lives on `/roadmap`.
- **Status badges** (`.status-*`): teal = available, periwinkle = in development, hatched = coming soon (hatching keeps its meaning: not covered). Planned steps and not-checked tiles use a dashed border, so text never sits on hatching.
- **Severity** (`.sev-*`): coral = critical, amber = high, info blue = medium, dim = low. Status colours only.
- **Demonstration data** is always tagged. Sample findings are never presented as real output.

| Visual | File | What it shows |
|---|---|---|
| Hero dashboard | `components/landing/hero-visual.tsx` | WebGL rings (or static rings), a tilted scan dashboard with a sweeping scan line, flagged files and floating chips |
| Workspace scan | `components/visuals/workspace-scan.tsx` | File tree plus a grid of file tiles: new, modified, findings, not checked; a beam sweeps across |
| Agent hub | `components/visuals/agent-hub.tsx` | Agent names (plain text, no logos) connected to a central TrustCode shield; stacks on phones |
| Pipeline | `components/visuals/pipeline.tsx` | Code → Scan → Review → Deploy with travelling beams; Deploy is drawn dashed (coming soon) |
| Walkthrough | `components/walkthrough/` | A 78-second, seven-scene product film rendered as live UI (see below) |
| Closing backdrop | `public/visuals/shield-glow.svg` | Static shield and rings behind the final call to action |

**Motion:** ambient loops (scan sweeps, flowing connectors, soft pulses, drifting chips) are slow and low-contrast. Every animation's resting frame is the finished illustration, and `prefers-reduced-motion` disables all of them through the global rule in `globals.css`. Keyframes: `tc-sweep`, `tc-sweep-x`, `tc-flag`, `tc-pop`, `tc-dash`, `tc-drift`, `tc-pulse`, `tc-beam`.

The earlier selected-code components (`inspector.tsx`, `tilt-card.tsx`, `features.tsx`, `versus.tsx`) are no longer used by the homepage.

## Walkthrough (`components/walkthrough/`)

A video-style, interactive demonstration placed right after the hero (`#demo`). `script.ts` is the storyboard: scenes,
durations, captions, camera moves and all sample data. `walkthrough.tsx` is the player.

- **Truthful by construction.** Rule IDs, severities, confidence levels, engines, policy defaults and the "not checked" list
  come from the real scanner (`docs/security_scanner.md`). Files, findings and numbers are invented, and the player is
  labelled "Simulated demo · sample data". Update `script.ts` when the scanner's behaviour changes.
- **One continuous stage.** A 1120×630 VS Code-style workspace scaled to fit like a video frame; a virtual camera
  (`Scene.camera`) pans and zooms between regions while playing. Paused or exploring shows the full frame.
- **Controls.** Play/pause, replay, previous/next scene, scrubbable timeline with chapter ticks, chapter buttons,
  captions (lower thirds), full screen where supported. Keys: Space/K, ←/→, C, F.
- **Interaction.** Any click on the simulated interface pauses the film and shows the visitor's choice (open files,
  findings, severity filters, engines, pipeline stages). "Explore yourself" turns the clock off and shows each scene complete.
- **Phones** get a focused panel per scene instead of the scaled stage. **Reduced motion** disables the camera,
  chapter cards and all CSS animation; captions and controls are unchanged. No audio.
