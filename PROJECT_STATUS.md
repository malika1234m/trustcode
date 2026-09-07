# TrustCode — Project Status

_Last updated: 2026-11-03_

| Phase | Name | Status | Exit criteria met? |
|---|---|---|---|
| 1 | Research landscape & literature review | **Draft complete — awaiting your review** | Partially (see below) |
| 2 | Novelty & feasibility validation | **Draft complete** (4 docs in `research/`) | Yes, pending supervisor sign-off |
| 3–8 | Architecture, UX, benchmark, backend, verification engine, explanations | **In progress**: verification worker partly built (evidence model, language detection, syntax/ruff/Semgrep/dependency analyzers, 19 validated Semgrep rules). Still to do: sandboxed test runner, pipeline, unit tests | No |
| 9–12 | Extension, E2E tests, deployment, experiment design | Not started | — |
| 13–16 | Pilot, main study, analysis, improvement | **Blocked**: needs ethics approval + participants | — |
| 17–19 | Dissertation, release, viva | Not started | — |

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
