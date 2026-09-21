---
marp: true
title: TrustCode
paginate: true
---
# TrustCode
Evidence-grounded verification of AI-generated code, and does it calibrate developer trust?
[Student] · [University] · [Date]

---
## Problem
- Developers now mostly *verify* AI code (Vella & Blincoe 2026)
- AI code is often wrong or insecure (EvalPlus; Pearce 2022: ~40% vulnerable)
- AI users can write less secure code *and* feel more confident (Perry et al. 2023)

---
## Why not "just explain it"?
- Explanations increase acceptance of **wrong** answers too (Bansal 2021; Kim CHI 2025, N=308)
- Checkable sources and lower verification cost help (Kim 2025; Vasconcelos 2023; Ferdowsi 2024)

---
## Research gap
No controlled study of **tool-grounded, status-labelled evidence** vs LLM explanation for AI code,
measured against ground truth, including **complacency on defects tools can't see**.

---
## Research questions
RQ1 decision correctness · RQ2 calibration (+ tool-blind complacency) · RQ3 adaptive presentation · RQ4 evidence-seeking behaviour

---
## TrustCode
Per-check status: ✓ within scope · ! issue · ✕ check failed · – not tested · ? human review
"Not verified" list · 3 explanation levels with **identical evidence** · Accept/Modify/Reject + confidence · no "safe" score

---
## Architecture
VS Code extension → FastAPI → PostgreSQL queue → worker → Docker sandbox (no network, RO FS, tests as separate uid)
(diagram: docs/architecture/architecture.md)

---
## Live demo
(see presentation/demo_script.md)

---
## Benchmark: separating human calibration from tool accuracy
C1 correct · C2 correct + false alarm · D1 tool-detectable defect · D2 tool-blind defect — 20 items, validated by execution

---
## Method
Within-subjects, counterbalanced 2×2 Latin square; GEE logistic; simulated power (N=40: 0.70–0.94 for H1)

---
## Results
[PENDING DATA — do not fill before the study]

---
## Engineering evidence
82 automated tests + 15/15 end-to-end steps; 6 security findings fixed during development

---
## Contributions · Limitations · Future work
Interaction design + controlled evaluation + benchmark method · snippets, student sample, author-labelled items · repository-scale, AI-triaged evidence
