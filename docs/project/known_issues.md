# Known Issues / Open Items

| ID | Area | Issue | Impact | Owner | Next step |
|---|---|---|---|---|---|
| KI-001 | Literature | Annotations based on abstracts; full texts not read | Findings may lack nuance; gap could narrow | Student | Read the 12 ★ papers (`literature_review.md` §8) |
| KI-002 | Literature | `fan2026whenhelp` (CHI 2026) findings come only from a search snippet; ACM page returned 403 | Could weaken G3 | Student | Obtain the full text via the library |
| KI-003 | Literature | No direct Scopus/WoS/IEEE Xplore search (no institutional access in this environment) | Review not yet "systematic" | Student | Run the provided search string |
| KI-004 | Literature | 16 preprints cited; publication status may change | Citation accuracy | Both | Re-run `build_outputs.py` and recheck before submission |
| KI-005 | Literature | `sandoval2023lostatc` and `spracklen2024package` cited in arXiv form; published versions (USENIX Security) not yet confirmed | Citation should point to the peer-reviewed version | Claude | Confirm DOIs in Phase 2 |
| KI-006 | Tooling | OpenAlex free daily quota exhausted during the run; fallback to Crossref/arXiv | None (handled) | — | — |
| KI-007 | Process | University deadlines, ethics process, participant pool and citation style unknown | Timeline and design decisions | Student | Provide them before Phase 2 is finalised |
| KI-008 | Benchmark | Ground-truth labels author-defined (LLM-assisted); need independent review | Validity of the main outcome | Student + reviewer | Second rater; record agreement |
| KI-009 | Method | With 4 defective items per condition, H1 power is 0.55–0.94 depending on effect/N | Underpowered study risk | Student | Extend eval split to 32 items or recruit ≥40 |
| KI-010 | Deployment | Worker container sandbox fix (Docker CLI 27) not re-verified; Docker Desktop storage I/O errors (low disk) | Compose stack cannot run tests | Student | Free disk, restart Docker Desktop, re-run check |
| KI-011 | Security | No e-mail verification; in-memory rate limiter; worker holds Docker socket | See threat model T-6, T-8, T-9 | Claude/Student | Before public deployment |
| KI-012 | Product | No in-panel "request additional check" button (re-verification only) | FR-14 partial | Claude | Next iteration |
| KI-013 | Product | Data deletion is API-only (no UI button); no screen-reader audit; JS has no linter/coverage | Usability/accessibility | Claude | Next iteration |
| KI-014 | Process | LLM explanations never tested against the real Anthropic API (no key) | Fallback tested only | Student | Test with a key, or keep disabled |
| KI-015 | Repo | `extension/package.json` repository URL is a placeholder | Packaging metadata | Student | Set the real URL |
