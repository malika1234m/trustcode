# Requirements (v0.1.0) with implementation status

Status: ✅ implemented and tested · 🟡 implemented, partially tested · ⏳ not implemented

## Functional
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-1 | Registration and optional local-only mode | ✅ | `/auth/register`, `/auth/local` (+ per-install secret); tests in `backend/tests` |
| FR-2 | Experience-level configuration | ✅ | `PATCH /profile`; command *Set Experience Level* |
| FR-3 | VS Code integration | ✅ | activity-bar view, commands, context menu; 5 extension-host tests |
| FR-4/5 | Manual submission of selected code, with permission | ✅ | explicit command + modal consent; `client_consent` enforced server-side |
| FR-6 | Original task submission | ✅ | `task` field; shown as "Matches the task? – Requires human review" |
| FR-7 | Language detection (Python, JavaScript) | ✅ | `languages.py`; tests |
| FR-8/9 | Code + security analysis | ✅ | ruff, Semgrep (21 frozen rules, CWE/OWASP) |
| FR-10 | Test execution | ✅ | Docker sandbox; coverage gaps → "Not verified" |
| FR-11 | Evidence collection | ✅ | normalised `VerificationResult`, per-check scope |
| FR-12 | Adaptive explanation | ✅ | 3 levels, invariant evidence (tested) |
| FR-13 | Accept / modify / reject | ✅ | decision + confidence, never edits files |
| FR-14 | Additional verification requests | 🟡 | re-verify with added tests/task; no "run extra check" button yet (KNOWN_ISSUES KI-012) |
| FR-15 | Feedback collection | ✅ | per-finding ratings |
| FR-16 | History subject to privacy settings | ✅ | `store_history` controls retention |
| FR-17 | Research experiment mode | ✅ | sessions, counterbalancing, trials, events, questionnaires |
| FR-18 | Export without identifying information | ✅ | CSV export; test asserts no e-mail addresses, consented sessions only |

## Non-functional
| ID | Area | Requirement | Status |
|---|---|---|---|
| NFR-S1 | Security | Untrusted code never executes in the API process; sandbox isolation (no network, RO FS, caps, uid, limits, timeout) | ✅ tested with attack cases |
| NFR-S2 | Security | AuthN/AuthZ, rotating refresh tokens, rate limits (auth 20/min/IP, general 300/min/user, submit 10/min) | ✅ |
| NFR-P1 | Privacy | No code sent without explicit consent | ✅ |
| NFR-P2 | Privacy | Code deleted immediately after analysis; results expire | ✅ |
| NFR-P3 | Privacy | Logs and errors never contain code | ✅ (validation-error test) |
| NFR-P4 | Privacy | LLM use off by default; requires user opt-in + server key | ✅ |
| NFR-E1 | Explainability | Every finding: what/where/method/why/evidence/not-verified/next step | ✅ |
| NFR-E2 | Honesty | No aggregate "safe"/correctness score; "Not tested" distinct from "passed" | ✅ tested |
| NFR-R1 | Reliability | A crashing analyzer yields "check failed", never "passed" | ✅ |
| NFR-PF1 | Performance | Typical snippet verified in < 15 s on a laptop (observed 2–6 s in e2e worker log) | 🟡 not load-tested |
| NFR-A1 | Accessibility | Theme colours, status conveyed by text + icon, keyboard focus, aria labels, reduced motion | 🟡 no screen-reader audit yet |
| NFR-M1 | Maintainability | Modular packages; CI; migrations | ✅ |
| NFR-AV1 | Availability | Health endpoint; container health check | 🟡 no uptime monitoring configured |
| NFR-SC1 | Scalability | DB queue supports several workers (`SKIP LOCKED`) | 🟡 in-memory rate limiter is single-instance |
