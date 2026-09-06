# TrustCode — Research Gap Analysis

**Status:** Draft v0.1, 2026-11-03. This replaces the assumption in the original brief that *combining* evidence, adaptation, calibration and human control is automatically novel.

## 1. The five proposed dimensions, checked one at a time

The brief asked whether prior work has addressed: **(E)** evidence-based code verification, **(A)** adaptive explanation by expertise, **(C)** trust calibration, **(H)** human-controlled accept/reject, **(M)** measured verification performance. Each dimension is assessed separately below.

| Dim. | Already done? | Strongest prior work | What remains open |
|---|---|---|---|
| **E** evidence-based verification shown to the developer | **Partly.** Runtime values (LP), detector alerts, risk constructs | [ferdowsi2024live], [steenhoek2025closing], [heander2026trustcalibrated] | **Multi-source tool evidence** (tests + static + security + dependency checks) with an explicit **epistemic status per check** (verified / issue / check failed / not tested / unverified assumption) has not been built and evaluated |
| **A** adaptive explanation by expertise | **Yes, for comprehension and review preferences** | [todisco2026tars], [cynthia2026persona], [desolda2025mental] | Its effect on **calibrated reliance during verification** is untested; adaptation that keeps the **evidence invariant** is untested |
| **C** trust calibration | **Yes in general HAI; framed but not measured for AI code** | [kim2025fostering], [bo2025rely], [schemmer2023appropriate]; [heander2026trustcalibrated] (self-report) | **Correctness-conditioned** calibration metrics (AoR, Brier, discrimination) for AI-code verification decisions |
| **H** human decision control | **Yes, standard in every tool** | All assistants; [ferino2026reliancecontrol] | Not a contribution by itself. It is worth studying only as a **process variable** (how evidence-seeking actions relate to decision quality) |
| **M** measured verification performance | **Partly.** Small N, single evidence type | [ferdowsi2024live] (N=17), [gao2026xai] (N=34, agreement), [vasconcelos2025generation] (N=30) | A **ground-truth benchmark** with *tool-detectable* and *tool-blind* defects, plus correct code with spurious warnings |

```
Legend: ● addressed  ◐ partially  ○ not addressed  ? unknown (full text not read)

                                    E    A    C    H    M    Domain
ferdowsi2024live (CHI'24)           ◐    ○    ◐    ●    ●    AI code
vasconcelos2025generation (TOCHI)   ○    ○    ◐    ●    ●    AI code
gao2026xai (ISSTA'26/PACMSE)        ○    ○    ◐    ●    ◐    AI code review
heander2026trustcalibrated (pre.)   ◐    ○    ◐    ●    ○    AI multi-file changes
wang2024trust (FAccT'24)            ◐    ○    ○    ◐    ○    AI code
steenhoek2025closing (ICSE'25)      ◐    ○    ○    ●    ○    AI vuln detection
yan2024ivie (CHI'24)                ○    ○    ○    ●    ◐    AI code
todisco2026tars (pre., ICSME demo)  ○    ●    ○    ◐    ◐    code comprehension
cynthia2026persona (pre.)           ○    ●    ○    ○    ○    code review
fan2026whenhelp (CHI'26)            ?    ◐    ?    ●    ●    AI code (snippet only)
kim2025fostering (CHI'25)           ◐    ○    ●    ●    ●    general QA (not code)
bo2025rely (CHI'25)                 ○    ○    ●    ●    ●    general (not code)
----------------------------------------------------------------------------
TrustCode (proposed)                ●    ●    ●    ●    ●    AI code
```

**Honest reading of the matrix:** no single reviewed study covers all five dimensions. But *covering many dimensions* is a weak novelty claim, and an examiner will rightly call it "integration, not contribution". The defensible contribution is narrower and testable (§2).

## 2. The refined, defensible gap

> **Gap statement.** Prior work shows that (i) LLM explanations can increase reliance on incorrect AI output [bansal2021whole], [kim2025fostering], [steyvers2025know]; (ii) lowering verification cost can reduce over- and under-reliance on AI code [ferdowsi2024live], [vasconcelos2023explanations]; and (iii) practitioners see reviewing AI code as a trust-calibration problem [heander2026trustcalibrated], [wang2024trust]. However, **no controlled study has measured whether presenting tool-grounded verification evidence with explicit epistemic status — compared with an LLM explanation alone — improves the correctness and calibration of developers' accept/reject decisions on AI-generated code, as measured against a ground-truth defect benchmark.** In particular, it is unknown whether such evidence induces **complacency on defects outside the checks' coverage**, as automation-bias theory predicts [parasuraman2010complacency], and whether **expertise-adapted presentation of identical evidence** changes these outcomes.

This gap has three parts, in decreasing order of strength:

| # | Gap component | Strength of support | Why |
|---|---|---|---|
| G1 | Effect of tool-grounded, status-labelled evidence vs LLM-only explanation on **decision correctness and calibration** for AI code | **Strong** | Closest studies use runtime values only [ferdowsi2024live] or LLM explanations [gao2026xai]; neither reports correctness-conditioned calibration on a seeded benchmark |
| G2 | **Evidence-induced complacency**: does "checks passed" raise acceptance of *tool-blind* defects? | **Strong and distinctive** | Predicted by theory [parasuraman2010complacency]; supported by the finding that test suites miss wrong code [liu2023evalplus]; not tested in any reviewed code study. This makes the work HAI research rather than tool engineering |
| G3 | Effect of **expertise-adapted presentation with invariant evidence** on calibration and workload | **Moderate** | Adaptation exists [todisco2026tars], but not for verification or calibration; theory predicts a possible *negative* effect (longer explanations inflate confidence [steyvers2025know]). Underpowered with small samples (see §4) |

**Not claimed as a contribution:** human accept/reject control (standard everywhere); "using Semgrep + an LLM" (engineering); a universal correctness score (deliberately rejected).

## 3. Why the benchmark design is part of the contribution

If a study only seeds defects that the tools *can* detect, TrustCode trivially "wins": the tool finds the bug, the user reads it, and the result measures **tool accuracy**, not **human calibration**. To isolate the interaction effect, the benchmark must contain at least four item classes:

| Item class | Ground truth | Tool evidence shows | Appropriate decision | Measures |
|---|---|---|---|---|
| C1 correct code, clean checks | correct | passes, with gaps marked "not tested" | accept | under-reliance |
| C2 correct code, spurious warning | correct | a (false-positive) finding | accept or modify, with justification | under-reliance from false alarms |
| D1 defect detectable by checks | defective | failing test / security finding | reject or modify | benefit of evidence |
| D2 defect outside check coverage (tool-blind) | defective | checks pass; the defect sits in an "unverified" area | reject or modify | **complacency (G2)** |

## 4. Threats to the novelty claim (to address in Phase 2)

1. **Fast-moving field.** Five closely related papers appeared between June and August 2026. Repeat the search before proposal submission and again before the dissertation.
2. **[fan2026whenhelp] is unread.** If its full text measures expertise × interface effects on verification correctness, G3 weakens further. **Read it first.**
3. **[gao2026xai] full text** may report correctness-conditioned agreement. If so, G1 should be framed as "tool evidence vs LLM explanation" (still distinct), not "first calibration study".
4. **Commercial tools** (Copilot code review, CodeRabbit, Sonar's AI code assurance, Snyk) already show tool findings next to AI code. The novelty is in the **interaction design and its controlled evaluation**, not in showing findings at all. This is covered in Phase 2 `existing_system_comparison.md`.

## 5. Recommendation

Frame TrustCode's core contribution as **G1 + G2** (primary, confirmatory), with **G3 as a secondary or exploratory** factor unless the participant pool is large enough (decision deferred to Phase 2 scope approval). This framing:
- is supported by verified literature;
- is testable within a final-year project;
- produces a publishable result whichever way it comes out: a null or negative G2 result (evidence induces complacency) is itself an important finding.
