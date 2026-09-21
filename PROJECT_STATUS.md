# TrustCode — Project Status

_Last updated: 2026-11-03_

| Phase | Name | Status |
|---|---|---|
| 1 | Literature review & gap | ✅ Draft complete (full texts of 12 key papers + Scopus search pending) |
| 2 | Novelty & feasibility | ✅ Complete (supervisor sign-off pending) |
| 3 | Requirements & architecture | ✅ `docs/requirements`, `docs/architecture`, `docs/security`, `docs/api/openapi.json`, `ARCHITECTURE_DECISIONS.md` |
| 4 | UX & interaction design | ✅ `docs/ux/interaction_design.md`; implemented in the webview (usability validation pending pilot) |
| 5 | Benchmark | ✅ 20 items validated 20/20 (independent label review pending) |
| 6 | Backend | ✅ 30 tests |
| 7 | Verification engine | ✅ 25 tests incl. sandbox attacks |
| 8 | Explanation engine | ✅ templates + validated optional LLM (real API untested) |
| 9 | VS Code extension | ✅ 12 unit + 5 extension-host tests; VSIX built |
| 10 | Integration & E2E | ✅ 15/15 e2e; `TEST_REPORT.md` |
| 11 | Deployment | 🟡 local verified; compose partly verified (see `DEPLOYMENT_STATUS.md`); cloud needs your credentials |
| 12 | Experiment design | ✅ drafts + power simulation (needs ethics approval) |
| 13 | Pilot | ⛔ blocked: ethics approval, participants |
| 14 | Main experiment | ⛔ blocked: ethics approval, participants |
| 15 | Analysis | 🟡 pipeline ready, checked on synthetic data only; **no results exist** |
| 16 | Improvement from findings | ⛔ blocked: needs results |
| 17 | Dissertation | 🟡 Ch 1–5 drafted; Ch 6–8 need data |
| 18 | Release | ✅ v0.1.0 prototype (tag); not the frozen experiment version |
| 19 | Presentation & viva | 🟡 slides, demo script, viva Q&A; results slide pending |

## Phase 1 report

### Completed
- Verified 84 references against Crossref/arXiv (0 unresolved); 74 from 2021+, 31 from 2025–2026.
- Reproducible verification pipeline (`scripts/literature/`), with raw evidence in `research/evidence/`.
- Deliverables: `literature_review.md`, `paper_comparison.csv`, `research_gap_analysis.md`, `problem_statement.md`, `research_questions.md`, `conceptual_framework.md`, `references.bib`.

### Key findings that change the project
1. **Adaptive explanation alone is not novel** (TARS 2026; persona-aware code review 2026).
2. **LLM explanations can increase over-reliance** (Bansal 2021; Kim CHI 2025; Steyvers 2025), so TrustCode is re-centred on *tool-grounded evidence with explicit verification status*, with adaptation as a presentation layer.
3. **Defensible gap:** a controlled, ground-truth evaluation of evidence vs LLM-only explanation on decision correctness and calibration, including **complacency on tool-blind defects** (G1 + G2). Adaptation (G3) is secondary or exploratory.
4. Very recent competing work (June–August 2026) must be re-checked before proposal submission.

### Tests executed
Not applicable to code yet. Verification checks run:
- `build_outputs.py`: 84/84 identifiers resolved.
- Citation cross-check: every `[key]` cited in `research/*.md` exists in `references.bib` (0 missing).

### Exit criteria status
| Criterion | Status |
|---|---|
| Gap supported by verified academic evidence | Met at abstract level |
| Key papers read in full | **Not met:** 12 ★ papers listed in `literature_review.md` §8 |
| Systematic database search (Scopus/WoS) | **Not met:** needs university library access; search string provided |
| Supervisor review of RQs and title | **Pending** |

### Blockers (need you)
1. Read, or obtain via the library, the 12 ★ full texts, starting with `fan2026whenhelp` (CHI 2026) and `gao2026xai`.
2. Run the Scopus/WoS search string (§9 of the literature review) through your library.
3. Provide university constraints: deadlines, ethics process, dissertation format/citation style, likely participant pool size.

### Recommended next phase
Phase 2: novelty and feasibility validation, including the commercial tool comparison (Copilot code review, CodeRabbit, Sonar, Semgrep, Snyk, Amazon Q), dataset feasibility, and the final scope decision (two vs three conditions).
