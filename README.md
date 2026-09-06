# TrustCode

Final-year research project: Human–AI Interaction in Software Engineering.

TrustCode investigates whether presenting **tool-grounded verification evidence with explicit verification status** helps developers make better-calibrated accept/modify/reject decisions about AI-generated code. It also asks whether adapting the presentation to developer expertise helps or harms.

**Current phase:** 1 — literature review and research-gap validation (see `PROJECT_STATUS.md`).

## Layout (current)

```
research/              Phase 1 deliverables (review, gap, RQs, framework, bib, comparison CSV)
research/evidence/     Raw outputs from the reference verification pipeline
scripts/literature/    Reproducible literature verification and bib/CSV generation
PROJECT_STATUS.md      Phase tracker and phase reports
RESEARCH_DECISIONS.md  Research decision log
KNOWN_ISSUES.md        Open items and blockers
```

Folders for the extension, backend, worker, datasets and deployment will be created when their phases begin (no empty scaffolding).

## Rebuild the bibliography

```bash
python3 scripts/literature/build_outputs.py
```
