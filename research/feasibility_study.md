# Feasibility Study (Phase 2)

**Status:** v0.1, 2026-11-03. Items marked ✅ were checked on the development machine on this date.

| Area | Assessment | Risk | Mitigation |
|---|---|---|---|
| **Languages** | Python + JavaScript (TS later). Fu et al. report security weaknesses in both [fu2025weaknesses]; both have mature tooling | Low | Keep snippet scope (single module + tests) |
| **Tools** | ✅ Semgrep 1.79 runs offline with local rules (`--metrics=off`); ✅ ruff 0.17; ✅ Node 20 (`node --check`, `node:test`); ✅ Docker 29 for sandboxing | Medium: semgrep CLI launcher breaks on paths with spaces | Worker invokes `pysemgrep` via the interpreter (ADR-004) |
| **Rules** | Use a **frozen local ruleset** (versioned in repo) rather than the online registry | Low | Required for experimental reproducibility; registry rules can be added in product mode |
| **LLM** | Anthropic API (structured output) optional; deterministic template explanations are the fallback and the default when no key is set | Cost/privacy | Experiment uses pre-generated, reviewed explanations frozen per item, so every participant sees identical text |
| **Datasets** | HumanEval/MBPP (MIT/CC-BY), EvalPlus (Apache-2.0) suit task inspiration; none provides C1/C2/D1/D2 classes | Medium | Curate our own benchmark (Phase 5), with task ideas from permissively licensed sources and independent human review of ground truth |
| **Infrastructure cost** | Railway Hobby (~US$5/month plus usage) or a university VM; managed Postgres; LLM ≈ cents per item with pre-generation | Low | Local Docker Compose fully functional without cloud |
| **Implementation complexity** | ~4–6k LOC across extension, API, worker | Medium | Modular monorepo; tests per module |
| **Participants** | Indicative N ≈ 34 within-subjects (two conditions) | **High:** recruitment is the main risk | Recruit from CS final-year/MSc students + local developer meetups; remote sessions via VS Code |
| **Ethics** | Human-participant study needs university ethics approval; minimal risk; no personal code collected | Medium (timeline) | Draft documents in Phase 12; submit early |
| **Timeline** | 24-week plan in the brief is realistic only if ethics is submitted by about week 10 | High | Submit the ethics application in parallel with implementation |
| **Disk/compute (dev machine)** | ✅ about 5 GB free; sandbox image must be slim | Low | `python:3.12-slim` base with Node from Debian packages; one shared image |

**Conclusion:** feasible as an MVP, provided the experiment is within-subjects with two primary conditions and adaptation is tested only as an exploratory factor.
