# TrustCode VS Code Extension — QA Report

**Date:** 2026-11-09 · **Build:** `trustcode-research.trustcode@0.1.0` · **Environment:** macOS 15.5, VS Code 1.120.0,
Node 20.20.2, Python 3.14 (local) / 3.12 (Vercel, CI) · **Backends:** local (`127.0.0.1:8765`, local mode, temp SQLite) and production
(`https://trustcode-api.vercel.app`, read-only probes only).

**Method and limits.** Tests were executed, not inferred from source. The extension was driven inside the real **VS Code Extension
Development Host** (`@vscode/test-electron`) through its command and webview-message paths, against a live backend. GUI automation
(clicking inside the webview, theme screenshots, keyboard navigation, modal dialogs) was **not available** in this session; those items
are reported as NOT TESTED or BLOCKED, never as passed.

## 1. Project overview
TrustCode verifies AI-generated Python/JavaScript: syntax, lint, Semgrep security patterns, dependency existence and (self-hosted)
sandboxed unit tests, shown as scoped evidence with a "Not verified" list and three explanation levels. Users decide accept / modify /
reject with confidence; the extension never edits files. Components: TypeScript extension (zero runtime dependencies, strict-CSP
webview, SecretStorage tokens), FastAPI backend, verification engine, Neon Postgres (production).

Feature inventory: 9 commands, 1 webview view (activity bar), 1 editor context-menu item, 4 settings (3 application-scoped),
editor diagnostics, consent dialog, sign-in / local mode, explanation levels, decision and feedback, privacy settings, delete
account, research-study mode.

## 2. Testing summary

| Suite | Executed | Passed | Failed | Skipped/Blocked |
|---|---|---|---|---|
| Extension unit tests (`npm test`) | 23 | 23 | 0 | 0 |
| Extension Development Host: activation, commands, E2E journey, negative, stability | 24 | 24 | 0 | 0 |
| Backend API (pytest) | 37 | 36 | 0 | 1 (needs Docker) |
| Verification engine (pytest) | 29 | 19 | 0 | 10 (need Docker; all 29 passed in GitHub CI on the previous commit) |
| Production API probes (non-destructive) | 12 | 12 | 0 | 0 |
| Packaging + clean-profile install | 2 | 2 | 0 | 0 |
| **Total** | **127** | **116** | **0** | **11 blocked** |

Not tested: see §9.

## 3. Feature-by-feature results

| Feature | Status | Issues | Notes |
|---|---|---|---|
| Activation | PASSED | — | Activates on view/command; measured 0–1 ms in the host |
| Command registration (9) | PASSED | — | All present after activation |
| Verify selected code (main journey) | PASSED | QA-2, QA-3, QA-4, QA-6 fixed | Evidence rendered; document unchanged |
| Editor diagnostics | PASSED | QA-2, QA-5 fixed | Correct line offset; never "Error" severity |
| Explanation levels | PASSED | QA-1 fixed | Advanced shows CWE |
| Decision / feedback | PASSED | — | Invalid values rejected client-side |
| Webview message handling | PASSED | QA-1 fixed | Allow-list validation; unknown actions ignored |
| Backend unreachable / timeout | PASSED | — | Clear "Cannot reach" error; unit tests for timeout |
| Token storage / sign-out | PASSED | — | SecretStorage, bound to backend origin |
| Unicode input | PASSED | — | — |
| Oversized input | PASSED | QA-6 fixed | Refused before upload |
| Unsupported language | PASSED | QA-4 fixed | Refused with message, nothing sent |
| Stability (15 consecutive runs) | PASSED | QA-8 fixed | No errors, no diagnostic build-up |
| Consent dialog, sign-in prompts, delete-account confirm, privacy picker, study join | BLOCKED | — | Modal UI not automatable here; backend endpoints covered by backend tests |
| Light/dark theme, keyboard navigation, screen reader | NOT TESTED | — | CSS uses theme tokens only; status conveyed by text (unit-tested) |
| Sandboxed unit tests via extension | BLOCKED locally | — | Docker Desktop storage corrupted; passes in CI |

## 4. Bug report

| ID | Description | Severity | Root cause | Status |
|---|---|---|---|---|
| QA-1 | One malformed webview message (invalid level) broke every later explanation until restart | High | `level` stored without validation | Fixed: allow-list validation of all webview fields; regression test |
| QA-2 | Selecting identical code in another file/position put findings on the wrong file and lines | Medium | Selection refreshed only when text changed | Fixed: always refresh from the active editor; regression test |
| QA-3 | Rapid double-click sent duplicate verifications | Medium | No in-flight guard | Fixed: busy guard; regression test |
| QA-4 | Unsupported languages (e.g. Rust) were sent and reported as a misleading Python "syntax error" | Medium | No client-side language gate | Fixed: refused with explanation; regression test |
| QA-7 | VSIX contained local plugin telemetry (`.rune/metrics/*`) | Medium | Incomplete `.vscodeignore` | Fixed: excluded and removed; package re-verified (11 runtime files) |
| QA-13 | JavaScript syntax check reported **passed** for any code using `import`/`export`, even invalid code (found while investigating a TypeScript `.d.ts` selection from `node_modules`) | High | Node 20 `node --check` does not parse `.js` files with ES-module syntax and exits 0 | Fixed: ES-module code is checked as `.mjs`; 3 regression tests |
| QA-14 | Languages were not identified separately: TypeScript was refused or mis-parsed as JavaScript; `.d.ts` declarations and partial selections were reported as bare CRITICAL syntax errors; library code (node_modules) was verified as if AI-generated | Medium | Two-language model; Node-based JS parsing | Fixed in 0.3.0: TypeScript supported (tree-sitter parser, Semgrep rules); declarations-only detection; partial-selection hints; library-code confirmation. 11 worker + 3 E2E + 1 unit regression tests; verified live on Vercel |
| QA-5 | Diagnostics stayed on old lines after the user edited the file | Low | No change listener | Fixed: cleared on edit; regression test |
| QA-6 | Oversized selections were uploaded and then rejected by the server | Low | No client-side size check | Fixed: refused before upload; regression test |
| QA-8 | Polling back-off delayed results (median 5.0 s, max 8.1 s for ~2.6 s jobs) | Low | Back-off 1 s ×1.5 up to 3 s | Fixed: 0.5 s ×1.25 up to 2 s → median 3.3 s |
| QA-9 | Missing severity rendered as "UNDEFINED" | Low | No default | Fixed; strict unit test |
| QA-10 | Unknown routes / wrong methods returned a different error shape | Low | Handler bound to FastAPI subclass, not Starlette base | Fixed, deployed, verified in production |
| QA-11 | Workspace-trust behaviour undeclared | Low | Missing `capabilities` | Fixed: declared (no local code execution; application-scoped settings) |
| QA-12 | Dev-dependency vulnerabilities (2 high, 3 moderate) in the packaging tool | Low (not shipped) | `@vscode/vsce` 3.x | Upgraded to 4.1.0 → 0 high; 2 moderate remain (fix requires a downgrade) |
| QA-T1 | (Test harness) direct calls bypassed real error handling; one test did not restore config | — | QA's own test design | Fixed before conclusions were drawn |

## 5. Security findings
- Webview: CSP `default-src 'none'`, nonce scripts, no local resource roots; all rendered values escaped (unit-tested with XSS payloads);
  webview messages validated against allow-lists (QA-1).
- Secrets: tokens in SecretStorage keyed by backend origin; local secret sent only to loopback; settings application-scoped
  (workspace cannot redirect traffic); no tokens or passwords logged (source scan).
- Network: HTTPS default backend; production returns HSTS, `nosniff`, `no-store`, request ids; unauthorized and malformed requests
  rejected (12 probes). A forged unsigned JWT was blocked by Vercel's firewall (403) before reaching the app.
- Dependencies: 0 runtime dependencies; 2 moderate dev-only advisories (QA-12).
- No file writes by the extension; documents verified unchanged after every verification.

## 6. Performance findings
Activation 0–1 ms. Verification latency against the local backend (15 runs, after QA-8): min 2.8 s, median 3.3 s, max 12.5 s
(one backend-side outlier; analysis time dominated by Semgrep start-up). Production (earlier smoke test): 2.3–5.6 s.
No error accumulation or diagnostic build-up over 15 consecutive runs. CPU/memory profiling of the extension host was **not measured**.

## 7. Regression testing
After each fix the full extension unit suite and the full Extension Development Host suite were re-run (final: 23/23 and 24/24).
Backend suite re-run after QA-10 (36 passed, 1 skipped). VSIX rebuilt and reinstalled after QA-7.

## 8. Release readiness: **READY WITH MINOR ISSUES**
The primary journey, failure handling, security controls and packaging were verified by execution, and every confirmed bug found in
this session was fixed and regression-tested. Remaining items are verification gaps (manual GUI pass, Windows/Linux host, minimum
VS Code version, sandboxed tests locally), not known defects.

## 8a. UI/UX redesign (2026-11-09, after QA)
Panel redesigned to VS Code-native patterns: header with status and actions; Verify / History / Account tabs; welcome screen
(sign in, create account, local mode); onboarding steps; plain-language **headline** (evidence counts, never a verdict); summary
tiles; findings with essentials first and evidence folded under "Evidence & limits"; **Go to line**; compact feedback with in-place
confirmation; decision card that confirms in place and can be changed; compact check rows; error card with Retry / Settings;
status-bar summary. All colours from theme tokens; previewed in Dark Modern and Light Modern renderings. Narrow panels stack
labels above values. Regression after the redesign: unit **34/34**, Extension Development Host **30/30**.

## 8b. Browser sign-in (2026-11-09)
OAuth 2.0 authorization code + PKCE (S256). Codes: 5-minute, single-use, hash-only storage, bound to challenge and redirect URI;
failed exchange burns the code. Redirect allow-list: editor deep links for this extension only. Login page: CSP, frame-ancestors
'none', X-Frame-Options DENY, no-referrer, rate-limited. Tests: backend 8 (flow, foreign redirects, single use, wrong verifier,
redirect mismatch, expiry, wrong password, registration, HTML injection), extension unit 3, Extension Development Host 1
(real form → code → editor callback → token; replay rejected). Live production: page 200 with headers, foreign redirect 400,
full flow 200, replay 400, test account deleted.

## 9. Remaining work
| Item | Recommended action |
|---|---|
| Manual GUI pass: consent dialog, sign-in, delete-account confirm, privacy picker, study join, light/dark/high-contrast, keyboard only | 30-minute exploratory session with the checklist in `docs/ux/interaction_design.md` |
| Windows and Linux extension host | Run `node out/test/integration/run.js` on each (or add to CI with `xvfb-run` on Linux) |
| Minimum VS Code 1.90 | Run the integration suite with `version: '1.90.0'` in `runTests` |
| Local sandboxed tests | Purge Docker Desktop data, rebuild `trustcode-sandbox:0.1`, re-run worker suite |
| Extension-host memory/CPU profile | Use *Developer: Show Running Extensions* during a 50-run loop |
| Shared rate limits on Vercel | Move the limiter to a shared store (e.g. Upstash Redis via Marketplace) before wide release |
| Marketplace publishing | Create publisher `trustcode-research` and PAT (see the publishing steps in the README and project docs) |
