# Local engine architecture (extension 1.0.0, engine 1.0.0)

From 1.0.0 the **Verify** and **Session** tabs analyse code on the developer's machine. The TrustCode server is
no longer part of a verification unless the user selects it. This document records the design, the reasons, and
what was and was not tested.

## Why

- **Capacity.** On the hosted server every verification ran inside one web request (19.4 s measured for an 8-file
  batch, 60 s limit, 8 files per request). Running the same engine locally removes that load completely; the
  server keeps only small account requests.
- **Privacy.** Source code does not leave the machine, so there is no upload to consent to.
- **Parity with comparable tools.** Linters and static analysers (ESLint, Ruff, Semgrep, SonarLint) run locally;
  only tools that need a hosted model upload code. TrustCode's checks are deterministic tools.

## Components

```
VS Code extension
  ├─ RoutedApi (src/engine/local.ts)       decides per request: local engine or server
  │    ├─ LocalAnalysis                    same request/response shapes as the server's verification API;
  │    │                                   history, decisions, feedback and profile in a local file (mode 0600)
  │    └─ TrustCodeApi                     account, plan, research study, and server analysis when selected
  ├─ EngineManager (src/engine/manager.ts) finds, installs (after consent), runs and removes the engine
  └─ SecurityController                    uses the scanner from the same engine environment
        │  one JSON request on stdin, one JSON answer on stdout
        ▼
  python -I -m trustcode_worker.local      (verification-worker/trustcode_worker/local.py)
        ├─ pipeline.verify / project.verify_session      unchanged analysis code, shared with the server
        └─ present/ (templates, adaptation, explain)     report wording, moved here from the backend so both
                                                         sides build identical reports
```

`trustcode.analysis.location` selects `local` (default) or `server`. A self-hosted backend
(`trustcode.mode = local`) counts as server analysis.

## The engine process

- Started with an argument array (no shell), `-I` (isolated: no user site-packages, no `PYTHON*` variables, the
  working directory is not importable), working directory = the extension's storage folder, never the workspace.
- Receives the text to analyse as data. It does not read project files by itself.
- Makes no network request unless `trustcode.engine.registryLookups` is on (package names to PyPI / npm).
- Runs supplied unit tests only inside the Docker sandbox, and only when tests were supplied and
  `trustcode.engine.runTests` is on. Without Docker the tests check is reported as **not run**.
- A crash, a timeout, an unreadable answer or a cancelled run is an error. It is never shown as a result.

## Installation

The `.vsix` contains the engine as a wheel (`engine/trustcode_worker-1.0.0-py3-none-any.whl`, about 115 KB, built
by `npm run bundle-engine`). Its dependencies are not bundled. On first use TrustCode asks, then:

1. finds Python 3.11 or newer (`trustcode.engine.basePython`, else PATH; never inside the workspace);
2. creates a virtual environment in VS Code's global storage for the extension;
3. installs the wheel, then Ruff, Pyflakes, mypy, Bandit and Semgrep one by one from PyPI;
4. runs the engine's self-check and records the result.

A tool that cannot be installed is skipped and reported; the checks that need it then say **not run** or **check
failed**. Declining the dialog installs nothing and nothing is checked. A new extension version carries a new
wheel and sets up a new environment; the old one is deleted. `trustcode.engine.pythonPath` lets an advanced user
point at an interpreter that already has the engine.

## What moved, what stayed

| Concern | 0.9.0 | 1.0.0 (local selected) |
|---|---|---|
| Verify, Session analysis | server | this machine |
| History, decisions, feedback, explanation level | server database | `local-analysis.json` in VS Code storage (last 50 runs, results for the last 25) |
| Learning from "wrong" ratings | server, per account | this machine, same rule (`present/adaptation.py`) |
| Account, plan, subscription | server | server (optional) |
| Research study trials | server | server |
| AI-worded explanations | server, off by default | not available |
| Monthly verification limit | enforced by the server | **not enforced**: a local engine cannot be metered reliably |

The last row is a deliberate product consequence: local analysis is unmetered. Plans can still gate server-side
features. This is recorded in `docs/SUBSCRIPTION_AND_ENTITLEMENT_ARCHITECTURE.md`.

## Server capacity after the change

Read from the code and configuration, not load-tested: the server runs analysis in-request (`sync` mode), uses a
new database connection per request against Neon's pooled endpoint, and its rate limiter keeps counters in
process memory, so limits are per serverless instance. With analysis local, the remaining requests are sign-in,
plan checks and the research study, which this setup handles. No load test was run.

## Tested

- Engine entry point: `verification-worker/tests/test_local.py`.
- Extension logic: `extension/test/engine.test.ts` (routing, history, feedback, cancellation, failure handling,
  stored-state validation, privacy rows).
- Real VS Code, engine from the development environment, **server address unreachable**: the full selection
  journey and the session scenarios (`scripts/e2e/run_vscode_integration.sh engine e-session-git e-session-nogit`).
- Real installation from PyPI into a private environment (`engine-install`).

## Not tested / known limits

- Windows and Linux installation (developed and tested on macOS arm64 only). Semgrep's Windows support is newer;
  if it cannot be installed there, security rules are reported as not run.
- Machines without Python 3.11+: setup stops with a message; TrustCode does not install Python.
- Offline first-time setup is impossible (dependencies come from PyPI).
- The dependencies are not pinned to exact versions or hashes; a compromised PyPI release of a tool would be installed.
- The local history file is protected by file permissions only, not encrypted.
- The study's frozen `study-v1` check set is not selectable from the extension; local analysis uses `extended`.
