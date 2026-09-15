# Test Report

_Last run: 2026-11-03 on macOS (Darwin 24.5), Python 3.14.5, Node 20.20.2, Docker 29.2.0, VS Code (local install).
Every result below was produced by an actual run in this session; commands are given so you can reproduce them._

| Suite | Command | Result |
|---|---|---|
| Verification worker (unit + sandbox security) | `.venv/bin/python -m pytest verification-worker/tests` | **25 passed** |
| Backend API (unit + integration, inline worker) | `cd backend && ../.venv/bin/python -m pytest tests` | **29 passed** |
| Extension unit tests | `cd extension && npm test` | **12 passed** |
| Extension-host integration (real VS Code) | `cd extension && VSCODE_EXECUTABLE=… node out/test/integration/run.js` | **5 passed** |
| Full-stack end-to-end (API + separate worker process + Docker sandbox, driven by the extension's API client) | `./scripts/e2e/run_e2e.sh` | **15/15 steps passed** (`docs/testing/e2e-results.json`) |
| Benchmark validation (engine + hidden tests) | `.venv/bin/python scripts/dataset_validation/build_benchmark.py` | **20/20 items valid**, 0 duplicates, eval split balanced |

## Brief workflows (Phase 10) → evidence
| Workflow | Covered by |
|---|---|
| A correct code | e2e step A; worker `test_clean_code_security_passed_but_scope_disclaims` |
| B vulnerable code | e2e step B; worker `test_python_security_rules`, `test_js_security_rules` |
| C logical defect + unverified areas | e2e step C; worker `test_logical_defect_detected_by_failing_test_and_gaps_reported` |
| D incomplete/invalid code | e2e step D; worker `test_syntax_error_skips_dependent_checks_and_never_passes` |
| E adaptive explanations, invariant evidence | e2e step E; backend `test_levels_change_wording_not_evidence` |
| F human decision, files untouched | e2e step F; VS Code integration tests 3–4 |
| G failure conditions | e2e G1–G7 (malicious code, timeout, malformed input, invalid auth, cancellation, API down, LLM unavailable); backend rate-limit and validation tests; worker sandbox tests (no network, read-only FS, fork bomb, forged results, output flood, uid) |

**Not yet tested (honest gaps):** database-unavailable behaviour against PostgreSQL; load/performance testing;
LLM explanations against the real Anthropic API (no key in this environment, so only the validator and the fallback path were tested);
accessibility audit with a screen reader; Windows/Linux hosts.

## Defects found by testing and fixed
| ID | Found by | Defect | Fix |
|---|---|---|---|
| D-1 | e2e run 1 (11/15) | Status polling exhausted the 60/min per-user rate limit, locking users out mid-session | General limit 300/min (submissions keep 10/min); extension polling backs off from 1 s to 3 s |
| D-2 | backend test | Beginner guidance contained "the code is correct" (inside a negation) | Reworded; test forbids such phrasing |
| D-3 | benchmark validation | Dev item JS-D1-D1's hidden test crashed the runner instead of demonstrating the defect | Hidden test rewritten to detect code execution |
| S-1..S-6 | automated security review | Result spoofing / nonce theft via `/proc/1/fd/1`; unbounded host output buffering; researcher role granted at self-registration; local-mode DNS-rebinding; promotion of squatted accounts | Separate uid for untrusted tests + process-group kill + nonce; 1 MB output cap; admin-only provisioning; per-install secret + Host/Origin checks; `create-researcher` with interactive confirmation for existing accounts |
