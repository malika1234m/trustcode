# TrustCode Trust Center — privacy, data flows and honest limits

This describes what the code does today (extension 1.0.0, engine 1.0.0). Where something is not built, it says so.

## Architecture as it really is

```
                      ┌────────────────────────── your machine ───────────────────────────┐
 YOU ── VS Code ──▶   │ TrustCode extension                                              │
                      │   ├─ Security tab ──▶ local scanner (trustcode-scan)             │   nothing leaves
                      │   ├─ Verify / Session tabs ──▶ local engine (Python)             │   the machine
                      │   │      Ruff · Pyflakes · mypy · Semgrep · tree-sitter           │
                      │   ├─ Account and licence check ──(account identity, no code)──┼──▶ TrustCode server
                      │   └─ Update check ──(no account or project data)─────────────────┼──▶ GitHub releases
                      └───────────────────────────────────────────────────────────────────┘
 One-time engine setup (after you agree) downloads the analysis tools from PyPI.
 TrustCode server (FastAPI on Vercel + Postgres): optional account, plan, research study, and analysis only if
 you select "server" in trustcode.analysis.location. No billing provider is connected yet; every account is Free.
```

By default TrustCode analyses code **on your machine**. Security, Verify and Session all run locally and need no
account. You can switch Verify and Session to the server (`trustcode.analysis.location = server`); then the code
you choose is sent after a confirmation dialog, exactly as before 1.0.0. Design: `docs/LOCAL_ENGINE_ARCHITECTURE.md`.

## What goes where

| Data | Leaves your machine? | When | Stored |
|---|---|---|---|
| Files read by the Security tab | No | — | Findings in `.trustcode/` inside the project |
| Code you verify (Verify tab), files a session changed (Session tab) | **No** with local analysis (default) | — | Results of the last 25 runs, decisions and ratings in VS Code's storage on this machine (file mode 0600, not encrypted) |
| The same, if you select server analysis | Yes, to the TrustCode server | Only after a confirmation dialog that states how much is sent and where | Source is deleted when analysis ends; results expire after 24 hours (30 days with history on) |
| Imported package names | Only if you turn on `trustcode.engine.registryLookups` | To PyPI / npm, names only | Not stored by TrustCode |
| Engine setup | A download from PyPI | Once, after you agree; again after an extension update | A private Python environment in VS Code's storage |
| Files matching sensitive patterns (`.env`, keys) | Never | — | — |
| Workspace file names (Session tab) | No with local analysis; names only with server analysis | With a session verification | Deleted with the job |
| Your API keys and credentials | Never collected | TrustCode asks for none. Secrets the scanner finds are masked before display or storage | — |
| Sign-in token | Sent to the TrustCode server only | Every authenticated request | VS Code SecretStorage, bound to the server address |
| Account identity for plan checks | Yes | When the Account tab is opened | Last answer cached in SecretStorage for 72 hours |
| Device registration (at sign-in; an account is required to use TrustCode) | A random install id, a device public key, the device name (`<editor> on <computer name>`) and the platform, to the TrustCode server | At sign-in; shown to you under Devices in the web dashboard | Until you sign the device out or delete the account |
| Account and licence check | The install id, your account id and a request counter, signed with the device key. No code, file names or project data | At startup if last confirmed over an hour ago, then about once a day, plus retries after a failed attempt | The signed licence and device key in VS Code SecretStorage (the OS keychain) |
| Dependency names and versions | Only if you turn on advisory lookups | `trustcode.scanner.onlineAdvisories` | Not stored by TrustCode |
| Finding details to an AI provider | Only if the setting, your profile toggle and the server all allow it | Off by default; the hosted server has no provider configured | — |
| Telemetry, analytics, crash reports | None | The code contains none | — |
| Update check | A request to GitHub's public API | At most once a day; `trustcode.updates.check` | — |

The Account tab shows a **Privacy status** computed from these settings and the live connection state.

## How findings are classified, and why they can be wrong

- **Severity** (critical … info) is the impact if the finding is real. **Confidence** is separate: *confirmed* only
  when independently verified (an advisory matching an exact dependency version); *strongly suspected* for a
  data-flow or syntax-aware match; *potential* for a heuristic that needs a person.
- A scanner matches patterns. It reports things that are harmless in context (false positives) and misses problems
  it has no rule for (false negatives). Not detected at all: who is allowed to access which record, rate limiting,
  missing input validation, flows across files.
- Every report lists files scanned and skipped (with reasons), tools that ran, tools that were unavailable, checks
  not performed, and whether the scan was complete. No report says a project is secure.
- You can mark a finding as a reviewed false positive (recorded with who, when and why), disable a rule for the
  project, re-enable it, and report a wrong finding. Accuracy figures exist only for the project's own labelled
  test set (`docs/testing/security_scanner_accuracy.md`) and are not a claim about real projects.

## How subscriptions are verified

The server alone decides your plan, from billing events signed with a secret that only the server holds. Nothing in
the extension or on your disk can grant a plan. Paid plans are not on sale yet. Details:
`docs/SUBSCRIPTION_AND_ENTITLEMENT_ARCHITECTURE.md`.

## How updates reach you

From the project's GitHub releases. The extension can download a new version, check it against the SHA-256 published
with the release, and install it through VS Code; it never installs an older version. Details:
`docs/UPDATE_AND_RELEASE_ARCHITECTURE.md`.

## Reporting a security problem

Open a private security advisory on the GitHub repository, or use the support form with category "bug" and no
exploit details. Please do not post working exploits in public issues.

## Known limits of these protections

- Local scan results in `.trustcode/` are plain files in your project (secrets masked). Protect them as you
  protect the project.
- The cached plan in SecretStorage is protected by your operating system's keychain, not against you; it is
  display-only, so changing it unlocks nothing.
- The hosted server's rate limiting is per server instance.
- There is no independent security audit of TrustCode.
