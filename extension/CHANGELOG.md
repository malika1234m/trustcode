# Changelog

## 1.1.1

- The Account tab no longer says an account is optional. TrustCode is free and needs a TrustCode account (see 1.1.0).

## 1.1.0

- **Sign in to use TrustCode.** TrustCode stays free, but it now needs a TrustCode account. Create one on the
  website or from the TrustCode panel; sign-in happens in your browser. Your code is still checked on your
  computer and is not uploaded.
- **Works offline after sign-in.** VS Code keeps a signed licence for your account and checks it on your computer
  at every start. You can work without an internet connection for up to 30 days; TrustCode confirms your account
  when you are online (at startup and about once a day) and warns you 5 days before the offline period ends.
- **Devices**: an account can be signed in on 3 devices. See and sign out devices in the web dashboard
  (Settings → Devices). Signing out in VS Code frees the device.
- **Account tab**: a "This computer" card shows the plan in use, when it was last confirmed online and how long it
  can work offline. New commands: *Account and Plan*, *Check My Plan Now*.

## 1.0.0

- **Everything runs on your computer.** Verify and Session now use a local engine, like the Security tab. Your
  code is not uploaded, no account is needed, and there is no per-request file limit. The server remains
  available as an option (`trustcode.analysis.location`).
- **One-time engine setup, with your agreement**: a private Python environment in VS Code's storage. Needs
  Python 3.11+. Commands: Set Up / Check / Remove Local Engine.
- History, decisions and "wrong finding" feedback are kept on this computer and still adapt explanations.
- Unit tests you supply run in the Docker sandbox on your machine when Docker is available.
- **Account tab**: plan and renewal state as verified by the server, a privacy status computed from your
  settings, and update checking with SHA-256 verified installation from GitHub Releases.
- Not available with local analysis: AI-worded explanations and the monthly verification limit.

## 0.8.0

- **Weakened controls are reported from the change itself**: removed authentication guards, skipped or deleted
  tests, removed secret-protecting ignore rules, and CI security steps that were removed or made unable to fail.
- More rules: missing guards on sensitive Flask routes and state-changing Spring endpoints (needs review),
  unencrypted HTTP endpoints, public cloud resources in Terraform, plus logging of credentials, stack traces in
  responses, XXE, `postMessage` to any origin, client-named uploads, Kubernetes and IAM misconfiguration.
- **Disable / enable a rule** from a finding or the Scanners section; **Rules & exclusions** opens the policy file.
- Real scan progress (phase and file counts), a **New files** scan, optional Git-history credential scan.
- A full scan now starts shortly after a trusted folder is opened (`trustcode.scanner.scanOnStartup`).
- Optional Bandit integration; the dependency advisory lookup was verified against the live service.
- Hardening: scanners run isolated from the project, changes to the policy files are themselves reported,
  copied evidence is redacted, and the scanner is only started in trusted workspaces from a path outside the workspace.

## 0.7.0

- **Security tab: scan the whole project locally.** No account and no upload. Covers tracked and untracked files,
  configuration, environment files, CI workflows, container files and agent configuration.
- Detection: SQL and NoSQL injection, command injection, XSS, path traversal, SSRF, unsafe deserialisation, JWT and
  session mistakes, insecure CORS, debug mode, disabled TLS verification, exposed credentials (masked), committed
  environment files, secrets exposed to the frontend, risky agent settings, unsafe CI workflows and more.
- **Exact highlighting**: the vulnerable expression is underlined, with severity, a separate confidence
  (confirmed / strongly suspected / needs review), the rule and one line of evidence. Next / previous finding commands.
- Scan modes: entire project, changed files, before commit (staged content), before push, before production, rescan.
- **Automatic rescans** when files change, however they are changed; unchanged files are reused from a cache.
- Baseline (new / existing / reintroduced / resolved) and audited "reviewed false positive" records.
- Git hooks that never replace an existing hook, a CI workflow example, and a configurable blocking policy.
- An incomplete or failed scan is always shown as such, never as a clean result.
- Changes made in a tracked AI session are scanned when the session reaches a review point.
- **Long explanations are now off by default** in the Verify and Session tabs (`trustcode.showExplanations`).
- Requires the local scanner: `pip install "trustcode-worker[tools]"`. Details: `docs/security_scanner.md`.

## 0.6.0

- **Session tracking**: start a session before giving your coding agent a task. TrustCode records a baseline and then
  collects every file the task creates, modifies, renames or deletes — no selection needed. Edits you already had are
  part of the baseline and are not attributed to the session.
- **Verify all changes together**: per-file checks plus checks between files — imports of deleted or missing files,
  names a module no longer defines or exports (including in unchanged files that import a changed one), and packages
  that are imported but not declared.
- Findings are labelled **new in this change**, **already present before** or **origin unknown**.
- New **Session** tab: status, counts, changed files with diffs, report, verification history, settings.
- Other scopes: Git-changed files, chosen files (also from the Explorer context menu), entire workspace.
- Check depth: Quick, Standard, Deep. Checks that do not run at a depth are shown as not run.
- Automatic verification (optional): when the agent reports it finished, after inactivity, on save, per batch, or
  when you end the session. Automatic runs only send to a server you already approved.
- **Agent completion signal**: an agent hook can tell TrustCode it finished (setup guide included for Claude Code).
  Without a signal, "possibly finished" is shown as an estimate.
- Results are marked **out of date** if files change during or after a run.
- **Copy fix prompt for your agent**, then re-verify and compare runs. TrustCode still never edits your files.
- Sessions survive a restart. Files matching sensitive patterns (`.env`, keys) are tracked but never sent.
- Not included: project test execution, API-contract and database-schema checks (always listed as not executed).

## 0.5.0

- **Verify Current File** (command, editor context menu, panel button) next to Verify Selected Code; **Run the Checks Again** command.
- Keyboard shortcuts: `Ctrl/Cmd+K Alt+V` (selection), `Ctrl/Cmd+K Alt+F` (file), `Ctrl/Cmd+K Alt+R` (run again).
- **Hover** on a finding shows why it matters, the tool evidence, the suggested next step and what was not verified.
- **Quick action** on a finding ("TrustCode: explain …") opens the panel at that finding.
- Findings now **follow your edits**: evidence below an edit moves with the code; evidence on an edited line is removed instead of pointing at different text.
- Lines never executed by your tests are marked in the editor as **not verified** (dotted border + overview ruler).
- **What changed since the last verification** of the same file: new, unchanged and no-longer-reported findings (never described as "fixed").
- Identical code is **not sent twice**: a recent result is shown with its age and a "Run again" button.
- Findings are grouped by severity; duplicate reports from two analyzers are shown once with both sources.
- New server checks are displayed: JavaScript/TypeScript static analysis, type checking (Python, when available on the server), hardcoded-secret formats.
- If you mark a rule's findings as wrong repeatedly (and adaptive suggestions are on), later findings from that rule say so and are collapsed below high severity. They are never hidden.
- Status bar shows progress while verifying and counts failed checks.

## 0.4.1

- New TrustCode logo and extension icon: a selection frame around a check whose stroke fades, marking where verification stops.
- Marketplace gallery banner updated to the new brand navy.

## 0.4.0
- **Sign in with your browser**: Sign In / Create account open the TrustCode website; you are returned to VS Code automatically.
  Uses the OAuth 2.0 authorization-code flow with PKCE — your password is never entered in or seen by the editor.

## 0.3.0
- **TypeScript support** (.ts / .tsx): TypeScript syntax checking, Semgrep security rules, dependency checks.
- Type-declaration code (e.g. `.d.ts`) is identified as "type declarations only"; behaviour checks are marked not applicable.
- Partial selections (starting inside a `/** */` comment or mid-block) are explained instead of reported as a bare syntax error.
- Code from installed libraries (node_modules, site-packages, virtual environments) asks for confirmation before verification.
- Fixed: JavaScript using `import`/`export` could be reported as parsing when it did not.

## 0.2.0
- Redesigned panel: Verify / History / Account tabs, welcome screen, onboarding steps, plain-language headline, summary tiles.
- Findings show essentials first with evidence folded; **Go to line**; compact feedback; decisions confirm in place.
- Status-bar summary; error card with Retry / Settings.
- Unsupported languages (e.g. TypeScript) are refused with a clear message instead of a misleading syntax error.
- Validation of all panel input, duplicate-submission guard, stale-hint clearing, oversized-selection check.

## 0.1.0
- Verify selected AI-generated Python/JavaScript: syntax, lint, Semgrep security patterns, dependency existence, sandboxed tests (self-hosted).
- Evidence view with per-check status and a "Not verified" list; beginner / intermediate / advanced explanations.
- Findings shown as editor hints; accept / modify / reject with confidence; never edits your files.
- Consent before sending code; privacy settings; delete account and data; research-study mode.
