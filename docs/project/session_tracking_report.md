# AI coding session tracking and whole-change verification — engineering report

Date: 2026-11-11 · Extension 0.6.0 · Engine 0.2.0 (`trustcode_worker/project.py`)

## What was built

| Part | Where | Summary |
|---|---|---|
| Session model | `extension/src/session/model.ts` | A session is defined by a **baseline**: the content hash of every tracked file when tracking starts. A file is a session change exactly when its content differs from the baseline. |
| Change detection | `extension/src/session/controller.ts` | File watcher, save, create, delete and rename events feed a debounced queue; a **full rescan** (before every verification, on demand, and after a restart) recomputes the same answer without relying on events. |
| Git integration | same | In trusted workspaces: `git ls-files` lists files (honours `.gitignore`), `git status` records what was already uncommitted, `git show <HEAD at start>` supplies pre-session text. Git is never used in untrusted workspaces. |
| Fallback without Git | same | Files are scanned, and text files are copied into VS Code's workspace storage (64 MB budget) so diffs and attribution still work. |
| Completion signals | `model.ts`, `controller.ts` | Three kinds, always labelled: **agent signal** (a hook wrote `.trustcode/agent-signal.json`), **inactivity estimate**, **manual**. An estimate is withdrawn as soon as files change again. |
| Multi-file verification | `verification-worker/trustcode_worker/project.py`, `POST /api/v1/session-verifications` | Every changed file runs through the single-file engine; then cross-file checks run once for the set. |
| Dashboard | `extension/src/session/render.ts` | New **Session** tab: status, counts, grouped changed-file list with diffs, report, history, settings. |
| Settings | `extension/package.json` | 20 settings for scope, depth, triggers, include/exclude, limits, retention, notifications. |
| Fix workflow | `extension/src/session/report.ts` | A copyable prompt for the user's agent. TrustCode never edits files. |

### Cross-file checks (deterministic, nothing is executed)

- A relative/local import must resolve to a file that exists in the workspace.
- An import must not point at a file deleted or renamed in the same change.
- An imported name must be defined (Python) or exported (JS/TS) by the target — checked only when the target's text
  was supplied and its exports are statically knowable (not for CommonJS or `export *`).
- **Unchanged files that import a changed or deleted file are included** ("related" files), so a function the agent
  renamed is reported in the file that still calls it.
- A third-party package that is imported must be declared in the nearest `package.json` / `requirements*.txt` /
  `pyproject.toml`.
- JSON and TOML files are checked for well-formedness; every text file is scanned for credential formats.

### Attribution

When the pre-session text of a modified file is available it is sent as a baseline and verified with the same
checks. A finding also present in the baseline is labelled **already present before**; otherwise **new in this
change**. Created files are always new. Without a baseline the label is **origin unknown** — it is never guessed.

## Agent integrations — what is actually supported

| Agent | Completion detection | Basis |
|---|---|---|
| Claude Code | **Confirmed**, per turn, when the user installs the Stop hook shown by *TrustCode: Agent Hook Setup* | The hook writes the signal file. The snippet is valid JSON and its command was executed and produces a valid signal; it was **not** run inside Claude Code itself. A Stop hook fires at the end of a turn, which is not always the end of the task — the UI says "finished a turn". |
| Any tool that can run a shell command on completion | Confirmed, same signal file | Generic protocol; no tool-specific code. |
| GitHub Copilot | **Estimate only** | Copilot exposes no completion event to other extensions. |
| Cursor | **Estimate only**, unless the user wires a hook to the signal file | No Cursor-specific integration was built or tested. |
| Any agent, or manual work | Manual: *Review Latest AI Changes*, *End Session and Verify* | Always available. |

TrustCode does not claim to know which process wrote a file. A file typed and saved in a VS Code editor during a
session is tagged "edited in editor"; that covers the developer *and* in-editor assistants.

## Test results (all run on 2026-11-11, macOS arm64)

| Suite | Result |
|---|---|
| Worker (`verification-worker/tests`) incl. 14 multi-file tests | 92 passed |
| Backend incl. multi-file endpoint and validation | 60 passed |
| Extension unit tests incl. 22 session tests | 69 passed |
| VS Code integration, single-selection journey | 36 passed |
| VS Code integration, session scenarios, Git workspace | 28 passed |
| VS Code integration, session scenarios, 3,000-file workspace without Git | 28 passed |
| Frozen research benchmark (`study-v1` profile) | 20 / 20 validate |

Reproduce the integration runs: `VSCODE_EXECUTABLE=… scripts/e2e/run_vscode_integration.sh`.

Requested scenarios and where they are covered (`extension/test/integration/session.ts` unless noted):

| # | Scenario | Covered by |
|---|---|---|
| 1, 2 | Agent creates / modifies multiple files | detected from file events alone, no rescan |
| 3, 4 | Delete, rename | rename inferred from identical content; old path not double-reported |
| 5 | Config and dependency changes | categorised; undeclared-dependency check |
| 6 | Frontend and backend together | TS + Python in one report |
| 7 | Database migrations | tracked and categorised; **content not analysed** (reported as such) |
| 8 | Developer edits during a session | "edited in editor" tag |
| 9 | Uncommitted changes before tracking | not attributed (both workspaces) |
| 10 | Agent edits while verification runs | result marked out of date; file awaits verification again |
| 11 | Agent stops unexpectedly | inactivity estimate, labelled as an estimate |
| 12 | VS Code restarts | simulated by a fresh controller restoring from storage, with a file written in between; **not** a real relaunch of the application |
| 13 | Git unavailable | whole non-Git workspace run |
| 14 | Thousands of files | 3,015-file baseline; 300-file burst tracked in about 0.65 s; full rescan about 0.15 s |
| 15 | Tools missing | TypeScript type checker absent → "not run" in the report; mypy absence covered by a worker test |
| 16 | Network failure | error surfaced, nothing marked verified. AI-provider failure: the session report does not call an AI provider |
| 17 | Pause / resume | paused edits absorbed into the baseline; mixed files flagged |
| 18 | Settings changed mid-session | depth change applies to the next run; skipped checks shown as not run |

Bugs found by these runs and fixed: the "edited in editor" tag was never set (now uses VS Code's own save
event); a failed test of mine tripped on the disclaimer wording (test fixed, product unchanged).

## Security review follow-up (2026-11-11)

An automated review of the first commit raised three points; all were fixed and are covered by tests.

- **Registry lookups stay an operator decision.** The deep check no longer makes the server contact PyPI / npm unless
  `TRUSTCODE_REGISTRY_CHECK=1` is set on the server; otherwise the lookup is listed as not executed. Lookups are capped
  at 15 per file.
- **Import resolution uses a suffix index** built once per request instead of scanning the client-supplied file listing
  for every import, and examines at most 400 imports per file.
- **Symbolic links are not followed out of the workspace.** A link that resolves outside the workspace, or onto a file
  matching the sensitive-file patterns, is listed as not sent.

Also changed for the hosted (serverless) server, which analyses inside the request: the server advertises its
per-request limits on `/health` (8 files there, 40 on a worker deployment) and the extension batches accordingly;
unchanged supporting files are parsed for structure only and no longer run through the analyzers.

## Limitations

1. **No project test execution.** The sandbox runs one file with supplied tests. Every multi-file report lists
   "Project tests" under *Not executed*. This is the largest gap against "verify that the feature works".
2. **API-contract and database-schema consistency are not implemented.** They are listed as not executed. Migrations
   and SQL get a credential scan only.
3. **Languages:** per-file analysis for Python, JavaScript and TypeScript. Other files are tracked and shown; JSON/TOML
   are syntax-checked; everything else is "no analyzer".
4. **Import resolution is path-based.** Path aliases (`@/…`), `tsconfig` paths, `sys.path` changes and generated
   modules are not resolved; alias imports are counted in the check's scope text, not reported.
5. **Renames are detected only when the content is identical.** A file renamed and edited appears as delete + create.
6. **Human vs agent edits cannot be separated while tracking.** Pause tracking to exclude your own edits.
7. **Git operations change files too.** After a checkout or pull during a session the changed files count as session
   changes; a warning says so.
8. **Limits:** 50,000 characters per file and about 380,000 per request (files are batched; cross-file checks see one
   batch plus its related files). Files over the limit are listed as not analysed. Each batch counts as one
   verification against the monthly allowance.
9. **Multi-root workspaces** are supported for tracking; Git features need a single folder. Not tested with multi-root.
10. **One session per workspace at a time.** Concurrent sessions are not supported.
11. **"Max concurrent checks" is not a client setting** — concurrency is decided by the server (4 files at a time).
12. **The hosted server must be redeployed** before this works against it; the extension needs the new endpoint.
13. **No AI-generated fixes.** The fix workflow is a prompt for the user's agent; nothing is applied by TrustCode.
14. **Verification history** keeps the last 10 reports per workspace (configurable), stored locally and unencrypted in
    VS Code's workspace storage, including finding excerpts.
