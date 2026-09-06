# TrustCode — Research Problem Definition

**Status:** Draft v0.1, 2026-11-03. Supersedes the provisional framing in the project brief.

## Proposed title (refined)

**Primary:** *TrustCode: Effects of Tool-Grounded Verification Evidence and Expertise-Adapted Presentation on Developers' Calibrated Reliance on AI-Generated Code*

**Alternative (shorter):** *TrustCode: Evidence-Grounded Verification Interfaces for Calibrated Developer Reliance on AI-Generated Code*

Why it changed from the original title: "improving trust calibration" assumes the result in advance; "evidence-based" is vague; and the literature shows that adaptation is not novel by itself (`research_gap_analysis.md` §1). The new title names the manipulated variables and the outcome.

## 1. Background

AI coding assistants now generate a large share of code, and the developer's role has shifted toward verifying it [vella2026longitudinal], [mozannar2024reading]. Generated code is frequently defective, insecure or hallucinated [liu2023evalplus], [pearce2022asleep], [fu2025weaknesses], [spracklen2024package]. Developers using AI assistants can be *more* confident in *less* secure code [perry2023insecure].

## 2. Motivation

- **Practical:** whether a defect ships depends on the human accept/reject decision. Current assistants give developers few affordances for judging trustworthiness [wang2024trust].
- **Scientific:** HAI research shows that explanations can increase over-reliance [bansal2021whole], [kim2025fostering], whereas checkable evidence and lower verification cost help [vasconcelos2023explanations], [ferdowsi2024live]. Whether this holds for code verification with real analysis tools is unknown.
- **Methodological:** SE research often equates trust with acceptance [baltes2026rethink], and trust metrics for LLM4SE are undeveloped [khati2025mapping].

## 3. Problem statement

> When developers decide whether to accept AI-generated code, they lack verifiable, scoped evidence about which properties of the code have and have not been checked. Existing assistants offer fluent natural-language explanations, which can raise confidence without raising accuracy. As a result, developers accept defective code and reject correct code at rates that do not match the code's actual quality. It is not known whether an interface that presents **tool-grounded evidence with explicit verification status** improves the *calibration* of these decisions, whether it causes *complacency* about defects the tools cannot detect, or whether adapting its presentation to developer expertise helps or harms.

## 4. Research gap

See `research_gap_analysis.md` §2 (G1–G3).

## 5. Research aim

To design, build and empirically evaluate an IDE-integrated verification interface (TrustCode) that presents tool-grounded, status-labelled evidence about AI-generated code. The evaluation determines its effect on the correctness, calibration, efficiency and workload of developers' accept/modify/reject decisions.

## 6. Research objectives

| # | Objective | Phase |
|---|---|---|
| O1 | Critically review literature on trust, reliance, explanation and verification of AI-generated code, and identify a verified gap | 1 (this) |
| O2 | Specify an interaction framework mapping verification evidence to explicit epistemic status, with expertise-adapted presentation that keeps evidence invariant | 2–4 |
| O3 | Build a validated benchmark of Python/JavaScript AI-generated code with ground truth, including tool-detectable defects, tool-blind defects, correct code, and correct code with spurious warnings | 5 |
| O4 | Implement TrustCode (VS Code extension, backend, sandboxed verification worker, grounded explanation engine) | 6–11 |
| O5 | Evaluate TrustCode against an LLM-explanation baseline in an ethically approved controlled experiment | 12–15 |
| O6 | Derive design implications for calibrated human verification of AI code | 15–17 |

## 7. Expected contributions

1. **Empirical (primary):** controlled evidence on how tool-grounded, status-labelled verification evidence affects decision correctness and calibration for AI-generated code, including the complacency effect on tool-blind defects.
2. **Artefact:** an open-source VS Code extension and verification backend that keeps evidence (deterministic) separate from explanation (LLM), with explanations constrained to cite evidence.
3. **Methodological:** a benchmark design (C1/C2/D1/D2 item classes) and a measurement protocol that separates trust, reliance and calibration, answering [baltes2026rethink].
4. **Design knowledge:** implications for adaptive presentation of verification evidence. These may be confirmatory or exploratory, depending on sample size.

## 8. Scope

**In scope:** Python and JavaScript/TypeScript, function- or module-level snippets; user-submitted code (no claims of Copilot/Cursor integration); static analysis, security scanning (Semgrep), linting/type checking, sandboxed unit tests, dependency-existence checks; LLM-based requirement-consistency notes clearly labelled as *unverified*; three presentation levels.

**Out of scope:** repository-scale or multi-file agent changes (cf. [heander2026trustcalibrated]); automatic repair; languages other than Python/JS/TS; formal verification; longitudinal field deployment; measuring learning or skill formation.

## 9. Limitations (anticipated)

- Lab tasks with short snippets limit ecological validity.
- Participant pool is likely students and early-career developers, which limits generalisation to experts.
- The benchmark is researcher-curated, so the defect distribution may not match real-world frequencies.
- Tool behaviour (e.g., Semgrep rule versions) and LLM versions must be frozen for the experiment.
- The literature review is currently abstract-level (see `literature_review.md` §0).
