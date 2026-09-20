# Chapter 1 — Introduction

## 1.1 Background
AI coding assistants now produce much of the code developers work with, and the developer's role has shifted from writing
code to verifying it [vella2026longitudinal]. Generated code is often subtly wrong, insecure or reliant on non-existent
packages [liu2023evalplus], [pearce2022asleep], [fu2025weaknesses], [spracklen2024package], and developers using
assistants can be *more* confident in *less* secure code [perry2023insecure].

## 1.2 Motivation
Explanations and confidence displays, the usual remedy, can increase reliance on wrong AI output [bansal2021whole],
[kim2025fostering], [steyvers2025know]. Lowering the cost of verification and providing checkable sources are more
promising [vasconcelos2023explanations], [ferdowsi2024live]. No controlled study has tested this for AI-generated code with real analysis tools.

## 1.3 Problem statement, gap, aim
See `research/problem_statement.md` §3 and `research/research_gap_analysis.md` §2 (gaps G1–G3).
**Aim:** design, build and evaluate an IDE interface (TrustCode) that presents tool-grounded, status-labelled evidence
about AI-generated code, and measure its effect on the correctness and calibration of developers' accept/reject decisions.

## 1.4 Objectives, research questions, hypotheses
Objectives O1–O6 (`problem_statement.md` §6); RQ1–RQ4 and H1–H4 (`research_questions.md`).

## 1.5 Scope
Python and JavaScript snippets; user-submitted code; frozen rules; lab experiment. No claims about productivity or real-world defect rates.

## 1.6 Contributions
(1) Empirical: effect of status-labelled evidence on calibrated reliance, including complacency on tool-blind defects **[PENDING DATA]**;
(2) Artefact: open-source VS Code extension, backend and sandboxed verification engine with invariant-evidence adaptive explanations;
(3) Method: the C1/C2/D1/D2 benchmark design and a measurement protocol separating trust, reliance and calibration;
(4) Design knowledge for verification interfaces.

## 1.7 Structure
Chapter 2 reviews the literature; 3 describes the methodology; 4–5 present design and implementation; 6 evaluates the system and
reports the experiment; 7 discusses; 8 concludes.
