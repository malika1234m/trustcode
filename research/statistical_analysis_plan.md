# Statistical Analysis Plan — DRAFT (to be frozen/pre-registered before the main study)

Unit of analysis: trial (participant × item). Software: Python (`statsmodels`), script `research/analysis/analyze.py`.

## Exclusions (pre-specified)
- Sessions without recorded consent (automatically excluded from export).
- Participants completing < 75% of trials.
- Trials with decision time < 3 s (non-engagement) — excluded and reported.
- No exclusions based on outcomes.

## Primary analyses (confirmatory, α = .05, Holm correction across H1, H1b, H2, H3)
| H | Data | Model | Test |
|---|---|---|---|
| H1 | Defective items (D1+D2) | Logistic GEE: `accept ~ condition + order`, clustered by participant, exchangeable | condition coefficient < 0; report OR, 95% CI |
| H1b | Correct items (C1+C2) | Same model on `reject_or_modify` | Non-inferiority: upper 95% CI of risk difference < +0.10 (margin to confirm with supervisor) |
| H2 | All items | Per-participant Brier score of confidence-that-decision-is-correct, by condition | Paired t-test (Wilcoxon if non-normal); Cohen's d_z with CI |
| H3 | Defective items | `accept ~ condition * detectability (D1 vs D2) + order` | Interaction term |

Sensitivity: mixed-effects logistic regression with crossed random intercepts (participant, item) where it converges;
results reported alongside GEE.

## Secondary / exploratory (no correction; labelled exploratory)
H3-exp (TrustCode vs baseline on D2 only, two-sided); H4 adapted vs fixed presentation (calibration, NASA-TLX);
experience as moderator; AUROC discrimination of confidence; Appropriateness of Reliance (relative AI/self reliance —
requires an initial-judgement step; only if added after the pilot); time per item (log-transformed, paired);
NASA-TLX, trust scale and SUS by condition; RQ4 engagement events vs correctness; thematic analysis (Braun & Clarke) of open answers by two coders.

## Reporting
Descriptives by condition × class; effect sizes with 95% CIs; calibration plots; participant flow diagram;
every hypothesis reported as **Supported / Not supported / Inconclusive**, including null results.
Deviations from this plan are listed explicitly in the dissertation.
