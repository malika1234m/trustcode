# Changelog

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
