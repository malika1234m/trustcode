# TrustCode — Conceptual Framework

**Status:** Draft v0.1, 2026-11-03.

## 1. Theoretical foundations

| Theory / finding | Role in TrustCode |
|---|---|
| Trust calibration, resolution and specificity [lee2004trust] | Target outcome: reliance should match the code's actual correctness, item by item |
| Misuse / disuse [parasuraman1997humans]; automation complacency and bias [parasuraman2010complacency] | Predicts over-reliance on AI code, and possible complacency on "checks passed" evidence (H3) |
| Cost–benefit engagement with explanations [vasconcelos2023explanations] | Mechanism: evidence works by lowering the cost of verification, not by persuading |
| Explanations raise reliance regardless of correctness [bansal2021whole], [kim2025fostering], [steyvers2025know] | Design constraint: the LLM explains evidence and never adds verdicts |
| Checkable sources reduce reliance on wrong answers [kim2025fostering] | Analogue for tool evidence |
| Dual-process / cognitive forcing [bucinca2021trust] | Option: elicit an initial judgement or confidence before revealing the evidence summary (Phase 4 decision) |
| Appropriateness of Reliance [schemmer2023appropriate]; trust ≠ acceptance [baltes2026rethink] | Measurement model |

## 2. Framework diagram

```mermaid
flowchart LR
  subgraph IN[Inputs]
    T[Development task / requirement]
    G[AI-generated code]
  end
  subgraph EV[Evidence layer - deterministic, tool-grounded]
    S1[Syntax / parse]
    S2[Lint + type check]
    S3[Security scan - Semgrep, CWE]
    S4[Sandboxed unit tests + coverage]
    S5[Dependency existence]
    S6[LLM requirement-consistency notes<br/>status = UNVERIFIED]
    ST{{Epistemic status per check:<br/>Verified-by-check / Issue detected /<br/>Check failed / Not tested / Needs human review}}
  end
  subgraph PR[Presentation layer - adaptive]
    P1[Beginner / Intermediate / Advanced<br/>same evidence, different depth]
    P2[Grounded explanation<br/>must cite evidence IDs]
  end
  subgraph HU[Developer]
    E1[Evidence engagement<br/>expand, request checks]
    E2[Perceived reliability, trust]
    E3[Cognitive load]
    D[Decision: accept / modify / reject<br/>+ confidence]
  end
  subgraph OUT[Outcomes]
    O1[Decision correctness<br/>false accept / false reject]
    O2[Calibration: Brier, AoR, AUROC]
    O3[Time, workload, usability]
  end
  T --> EV
  G --> EV
  S1 & S2 & S3 & S4 & S5 & S6 --> ST --> PR
  PR --> E1 --> D
  PR --> E2 --> D
  PR --> E3
  D --> O1 & O2
  E3 --> O3
  M1([Moderator: developer experience]) -.-> PR
  M1 -.-> D
  M2([Moderator: defect detectability<br/>D1 tool-detectable vs D2 tool-blind]) -.-> O1
  M3([Moderator: task complexity]) -.-> E3
```

## 3. Variables

| Type | Variable | Levels / measure |
|---|---|---|
| Independent (primary) | Interface condition | Baseline (code + LLM explanation) vs TrustCode (code + status-labelled tool evidence + grounded explanation) |
| Independent (secondary) | Presentation adaptation | Fixed (intermediate) vs adapted to declared expertise (exploratory) |
| Item-level factor | Item class | C1 correct-clean, C2 correct-spurious-warning, D1 tool-detectable defect, D2 tool-blind defect |
| Moderator | Developer experience | Self-report years + short pre-test (avoid sensitive profiling) |
| Dependent | Correctness, false accept/reject, Brier, AoR, AUROC, time, NASA-TLX, trust scale, SUS | See `research_questions.md` §4 |
| Process | Evidence engagement events | Logged |
| Controls | Same LLM, same items, same editor, counterbalanced order | — |

## 4. Design invariants derived from the framework

These carry forward into Phases 3–8 as requirements:

1. **Evidence is immutable.** The explanation engine reads evidence and can never write it. Changing explanation level never changes evidence or status.
2. **Every explanation sentence about a finding must reference an evidence ID.** Unreferenced claims are dropped or labelled *"AI interpretation — not verified"*.
3. **No aggregate correctness score.** Show per-check status and coverage, including what was *not* tested.
4. **LLM-derived judgements** (e.g., requirement mismatch) always carry the *Needs human review* status, never *Verified*.
5. **Human decides.** No auto-apply; the decision and confidence are captured with every submission in experiment mode.
