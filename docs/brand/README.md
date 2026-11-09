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
