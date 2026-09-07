# Final Research Scope (Phase 2)

**Status:** v1.0, 2026-11-03.
**Approval:** the student instructed "finish all phases" on 2026-11-03, which is recorded as approval to proceed with the scope recommended in Phase 1 (RD-008). **Supervisor approval is still required** before ethics submission.

## Title
*TrustCode: Effects of Tool-Grounded Verification Evidence and Expertise-Adapted Presentation on Developers' Calibrated Reliance on AI-Generated Code*

## Research questions
RQ1–RQ4 and H1–H4 as in `research_questions.md` (H1, H1b, H2, H3 confirmatory; H3-exp, H4 exploratory).

## Study design (to be finalised in Phase 12)
- Within-subjects: **Baseline** (code + conventional LLM explanation) vs **TrustCode** (code + status-labelled tool evidence + grounded explanation). Condition order and item sets are counterbalanced.
- Exploratory between-subjects factor within TrustCode: **fixed** (intermediate) vs **adapted** presentation.
- Benchmark item classes: C1, C2, D1, D2.

## MVP product scope
| Included | Excluded |
|---|---|
| VS Code extension: submit selection + task, view evidence, explanation levels, decide with confidence, feedback, privacy settings, experiment mode | Copilot/Cursor/Claude Code integration (manual submission only) |
| Backend API (FastAPI): auth, local mode, jobs, results, decisions, feedback, experiment sessions, anonymised export | Organisation/team features |
| Worker: syntax, ruff, Semgrep (frozen local rules), sandboxed tests (Docker, no network), dependency check, coverage gaps | Formal verification, multi-file repositories |
| Explanation engine: deterministic templates (3 levels) + optional Claude grounded explanations with validation | Automatic code repair |
| Python + JavaScript | Other languages |

## Out-of-scope research claims
No claims about productivity, skill formation, or real-world defect rates.
