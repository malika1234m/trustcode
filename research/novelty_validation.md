# Novelty Validation (Phase 2)

**Status:** v0.1, 2026-11-03. Builds on `research_gap_analysis.md` and `existing_system_comparison.md`.

For each candidate contribution the brief proposed (A–E): the comparable work, the difference, how it is implemented, and how it is evaluated.

| # | Candidate contribution | Comparable work | Difference | Implementation | Evaluation | Verdict |
|---|---|---|---|---|---|---|
| A | Evidence-based verification presentation | [ferdowsi2024live] runtime values; Copilot+CodeQL, CodeRabbit (products); [heander2026trustcalibrated] design | Per-check **epistemic status**, including explicit *Not tested* / *Needs human review*; no aggregate score; nothing suppressed | `verification-worker` produces normalised `Evidence` records; extension renders status chips per check | H1, H2, H3 (baseline vs TrustCode) | **Core contribution** (as an evaluated interaction design) |
| B | Adaptive explanations by expertise | [todisco2026tars], [cynthia2026persona] | Adaptation changes **presentation only**; evidence IDs and statuses invariant, enforced by tests | `explanations/` renders 3 levels from the same evidence; property test asserts the evidence set is identical across levels | H4 (exploratory) | **Secondary**; novel only in combination with invariance + calibration outcome |
| C | Human decision-support workflow | Every assistant has accept/reject | Decision + confidence capture; optional "decide-before-reveal" step (cognitive forcing, [bucinca2021trust]) | Decision panel; experiment mode | RQ4 process analysis | **Not a contribution alone**; it is instrumentation |
| D | Trust calibration measurement | [schemmer2023appropriate], [bo2025rely] (non-code) | First application to AI-code verification with **tool-detectable vs tool-blind** defect classes | Benchmark C1/C2/D1/D2; analysis pipeline (Brier, AoR, AUROC, GLMM) | Main study | **Core methodological contribution** |
| E | Feedback-driven adaptation | [mozannar2024when] (system-side hiding) | Only *suggests* a level change to the user; never silently profiles | Adaptation engine rule: suggest a change after N "too detailed / too brief" ratings | Descriptive only | **Out of the core study** (it would confound the experiment); product feature only |

## Final novelty claim (one sentence)

> TrustCode contributes (1) an interaction design for AI-generated-code verification that presents tool-grounded evidence with explicit epistemic status and keeps evidence invariant under expertise-adapted presentation, and (2) the first controlled evaluation, on a ground-truth benchmark with tool-detectable and tool-blind defects, of how such evidence affects the correctness and calibration of developers' accept/reject decisions.

Claim (2) holds only if the full-text checks listed in `KNOWN_ISSUES.md` (KI-001, KI-002) do not reveal an equivalent study. **Re-run the search before submitting the proposal.**
