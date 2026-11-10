# Technical audit — 2026-11-10

Scope: `extension/`, `verification-worker/`, `backend/` (verification, explanation and feedback paths).
The website (`web/`), billing and the research-study flow were read but not changed.

## How a verification flows

1. **Extension** (`extension/src/extension.ts`): the user selects code (or a whole file) → language check →
   third-party-path warning → size cap (50 000 chars) → consent dialog per server → sign-in (browser PKCE or
   local secret) → `POST /api/v1/verifications` → polls `GET /verifications/{id}` with back-off.
2. **Backend** (`backend/app/api/routes.py`, `services/jobs.py`): rate limit and quota → job row (database as
   queue) → worker claims it → `trustcode_worker.pipeline.verify` → result JSON stored, source code purged.
3. **Engine** (`verification-worker/trustcode_worker/`): syntax → independent stages → normalised evidence
   (`models.py`): per-check status and scope, findings, explicit *unverified* areas, **no aggregate score**.
4. **Explanation** (`backend/app/explanations/`): deterministic templates at three levels; optional LLM
   wording that can only re-word existing finding ids and is rejected if it makes absolute claims.
5. **Extension** renders the explanation in a strict-CSP webview and maps findings to editor lines.

## What was real, simulated or missing (before this change)

| Area | State before | Evidence |
|---|---|---|
| Python syntax / lint / security patterns / dependency extraction | Real | ruff, Semgrep (frozen 21 rules), `ast` |
| JS/TS syntax and security patterns | Real | tree-sitter, Semgrep |
| JS/TS static analysis | **Missing** — always "Not run" | `analyzers/lint.py` |
| Type checking | **Missing** | — |
| Secret detection | Variable-name heuristics only (Semgrep rule) | 2 of 6 secret cases detected |
| Sandboxed tests (Python, JS) | Real, well isolated; **self-hosted only** (hosted server runs static checks) | `sandbox/docker_runner.py` |
| Package existence | Real but **off by default** (`TRUSTCODE_REGISTRY_CHECK`) | `analyzers/dependencies.py` |
| LLM explanations | Implemented with validation; **never exercised against the real API** (KI-014) | `explanations/llm.py` |
| Accuracy measurement of the engine | **Missing** (the benchmark measures human calibration) | `datasets/README.md` |
| Editor integration | Diagnostics only; all removed on any edit; selection only | `extension.ts` |
| Learning from feedback | Explanation-level suggestion only; nothing learned about rules | `adaptation/engine.py` |

No placeholder buttons or fabricated results were found. The honesty invariants (no verdict, failed check ≠
passed, evidence text identical across levels) are enforced by tests and were kept.

## Findings, by priority

| # | Priority | Finding | Status |
|---|---|---|---|
| 1 | High | Half of the labelled defects were invisible to static checks (recall 0.48 on the new evaluation set); JS/TS had no static analysis; no type checking | **Addressed**: JS/TS rules, wider ruff selection, mypy, secret formats → recall 0.76 at unchanged false-positive count |
| 2 | High | No way to measure engine accuracy or detect regressions | **Addressed**: `scripts/engine_eval/`, baseline + regression test |
| 3 | High | Growing the engine would silently change the frozen research benchmark (CI rebuilds snapshots with the live engine) | **Addressed**: `study-v1` profile, pinned in `build_benchmark.py`, regression-tested against all 20 snapshots |
| 4 | Medium | Committed snapshots carry a stale ruleset digest (rules changed after they were built) | **Open** — KI-016, needs the researcher's decision |
| 5 | Medium | Stages ran one after another | **Addressed**: concurrent stages, median 1454 → 928 ms with tests |
| 6 | Medium | Two analyzers could report the same problem twice once more analyzers exist | **Addressed**: line + weakness de-duplication that keeps both sources |
| 7 | Medium | Diagnostics vanished on any keystroke; "Go to line" used stale offsets after edits | **Addressed**: line tracking |
| 8 | Medium | Identical code was re-sent and re-analysed on every click | **Addressed**: 10-minute in-memory result cache, cleared on sign-out |
| 9 | Medium | Feedback "wrong" was stored without the rule it referred to, so nothing could be learned | **Addressed**: rule recorded; per-user, opt-in, presentation-only adaptation |
| 10 | Medium | Tool failures were visible per check but not in the "Not verified" list | **Addressed** (extended profile) |
| 11 | Low | CI lint failed on an unused import in `backend/app/api/saas.py` | **Fixed** |
| 12 | Low | `ruleset_digest()` re-read and re-hashed the rule files twice per request | **Fixed** (cached) |
| 13 | Medium | No TypeScript/JavaScript type checker; no undefined-name check for JS/TS | **Open** — needs Node + `typescript` on the worker and project context |
| 14 | Medium | Whole-workspace verification | **Not built** — each file is a separate consented upload and quota unit; needs a server-side batch design |
| 15 | Medium | AI-generated code fixes | **Not built** — there is no API key to test against (KI-014) and the product promise is that files are never edited; suggested next steps come from rule metadata |
| 16 | Low | In-memory rate limiter, no e-mail verification (KI-011) | Open, unchanged |
| 17 | Low | Extension polls for results (≤ 2 s) | Acceptable at current latencies |

## Design decisions made in this change

- **Profiles, not rule edits.** The frozen rule files are untouched; product-only rules live in
  `rules/extended/`. `engine_profile` (`TRUSTCODE_ENGINE_PROFILE`) lets an operator pin `study-v1`.
- **High precision over coverage for JS/TS.** Nine syntax-tree rules mirroring ESLint core rules; no
  undefined-name guessing on partial selections.
- **Secrets are masked** in evidence so a real key is not stored or displayed a second time.
- **Learning changes presentation only.** A rule a user marked wrong ≥ 2 times (and more often than helpful)
  gets a note and is collapsed below high severity. Evidence, severity and counts never change, nothing is
  hidden, nothing is shared across users, and it is covered by the existing "adaptive suggestions" opt-in.
- **Zero runtime dependencies in the extension** (ADR-009) preserved.
