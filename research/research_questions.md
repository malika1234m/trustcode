# TrustCode — Research Questions and Hypotheses

**Status:** Draft v0.1, 2026-11-03. Refines the four suggested RQs in the brief using the Phase 1 literature. Hypotheses are **provisional**. They must be frozen, with the analysis plan, in Phase 12 before any data collection (ideally pre-registered on OSF).

## 1. Changes from the brief's RQs

| Brief | Change | Reason |
|---|---|---|
| RQ1 "adaptive explanation → identify incorrect code" | Split. The **evidence** effect becomes primary (RQ1); adaptation moves to RQ3 | Adaptation alone is not novel [todisco2026tars]; explanations can raise over-reliance [kim2025fostering] |
| RQ2 "evidence → trust calibration" | Kept, with calibration defined against ground truth and **complacency on tool-blind defects** added (RQ2b) | Distinctive, theory-driven gap G2 [parasuraman2010complacency] |
| RQ3 "expertise-based explanation → workload" | Broadened to calibration + workload; marked secondary/exploratory | Power limits; possible negative effect [steyvers2025know] |
| RQ4 "human control → accept/reject" | Reframed as a **process** question about evidence-seeking behaviour | Human control is present in every condition, so it cannot be a manipulated factor without removing it, which would be unrealistic |

## 2. Research questions

**RQ1 (primary).** Compared with an LLM explanation alone, does presenting tool-grounded verification evidence with explicit verification status improve the correctness of developers' accept/modify/reject decisions on AI-generated code?

**RQ2 (primary).** Does such evidence improve the calibration of developers' confidence in their decisions?
- **RQ2a:** overall calibration and discrimination.
- **RQ2b:** for defects *outside* the checks' coverage (tool-blind defects), does evidence reduce, leave unchanged, or *increase* false acceptance (complacency)?

**RQ3 (secondary / exploratory).** Does adapting the *presentation* of identical evidence to declared developer expertise affect decision correctness, calibration and perceived workload, and does this depend on experience?

**RQ4 (process, mixed-methods).** How do developers use evidence-seeking actions (expanding evidence, requesting additional checks, reading "not tested" areas), and how do these behaviours relate to decision quality?

## 3. Hypotheses (directional where theory supports a direction)

| ID | Hypothesis | Basis | Test level |
|---|---|---|---|
| **H1** | False-acceptance rate of defective code (D1+D2) is lower in the TrustCode condition than in the baseline | [kim2025fostering] (checkable sources), [ferdowsi2024live] | Confirmatory |
| **H1b** | False-rejection rate of correct code (C1+C2) is **not meaningfully higher** in TrustCode than in baseline (non-inferiority; margin set in Phase 12) | Guards against "reject everything" strategies [bo2025rely] | Confirmatory |
| **H2** | Confidence calibration (Brier score of confidence that the decision is correct) is better in TrustCode | [lee2004trust], [steyvers2025know] | Confirmatory |
| **H3** | The TrustCode benefit on false acceptance is larger for tool-detectable defects (D1) than for tool-blind defects (D2) (condition × detectability interaction) | [parasuraman2010complacency], [liu2023evalplus] | Confirmatory |
| **H3-exp** | On D2 items, TrustCode *increases* false acceptance relative to baseline (complacency) | Same; direction uncertain | Two-sided, exploratory |
| **H4** | Adapted presentation differs from fixed presentation in calibration and NASA-TLX workload; the difference depends on experience | [todisco2026tars] (+), [steyvers2025know] (−) | Two-sided, exploratory |
| — | RQ4: no hypothesis; descriptive and qualitative analysis | — | Exploratory |

## 4. Operational definitions (draft)

| Construct | Operationalisation | Instrument |
|---|---|---|
| Decision correctness | Accept on correct item = correct; reject or modify-with-defect-addressed on defective item = correct | Benchmark ground truth (Phase 5) |
| False acceptance / false rejection | Proportion of defective items accepted / correct items rejected | Trial logs |
| Appropriate reliance | Appropriateness of Reliance (relative AI reliance, relative self-reliance) | [schemmer2023appropriate] (needs initial-judgement step; decide in Phase 12) |
| Confidence calibration | Brier score of per-trial confidence (0–100%) that the decision is correct; calibration curves | [brier1950verification] |
| Discrimination | AUROC of confidence for correct vs incorrect decisions | [steyvers2025know] |
| Trust (attitude) | Trust-in-automation scale, post-condition | [jian2000foundations] or [hoffman2023measures] |
| Workload | NASA-TLX (raw) per condition | [hart1988nasatlx] |
| Usability | SUS (TrustCode only, or both) | [lewis2018sus] |
| Efficiency | Time per item; time to first decision | Logs |
| Evidence engagement (RQ4) | Expand/collapse, additional-check requests, dwell time on "not tested" | Logs |

**Never used as a trust measure:** acceptance rate alone [baltes2026rethink].

## 5. Design implications (inputs to Phase 2 / 12; not final)

- **Baseline fairness:** the baseline gets the *same* AI code and the *same* LLM, with a conventional explanation, and the same editor and ability to run code. Only the evidence and presentation layer differ.
- **Indicative sample size** (normal approximation; replaced by a simulation-based power analysis for the mixed-effects model in Phase 12):
  - Within-subjects, two conditions, d_z = 0.5, α = .05 two-sided, power .80 → **≈ 34 participants** (before attrition).
  - Between-subjects, same effect → **≈ 64 per group** (128 total), likely infeasible.
  - A three-condition design (baseline / TrustCode-fixed / TrustCode-adaptive) needs substantially more → **this is why H4 is exploratory** unless recruitment allows more.
- **Recommended design:** within-subjects, counterbalanced condition order and item sets, with trial-level mixed-effects logistic regression (participant and item random effects). Adaptation (H4) can be tested as a between-subjects factor *within* the TrustCode condition, labelled exploratory.
