# Experimental Protocol — DRAFT for supervisor and ethics review

**Status:** draft v0.1 (2026-11-03). **No participant data may be collected until university ethics approval is granted.**
Software under test: frozen version to be tagged `experiment-v1` after the pilot (current build `trustcode 0.1.0`).

## 1. Design
- **Within-subjects** factor *Interface*: **Baseline** (AI code + the assistant's explanation + supplied tests) vs
  **TrustCode** (the same + tool-grounded evidence with status labels, "Not verified" list and explanations).
  Both conditions show the identical assistant explanation, so the only manipulated layer is the evidence (ADR-008).
- **Counterbalancing:** 2 (condition order) × 2 (item-block assignment) Latin square, assigned by session sequence
  (implemented in `backend/app/experiments/service.py`); trial order within a block is shuffled per participant.
- **Exploratory between-subjects** factor *Presentation* (TrustCode condition only): fixed intermediate vs adapted
  to self-declared level (assigned in blocks of 4 sessions).
- **Item factor:** C1 / C2 / D1 / D2 (see `datasets/README.md`). Participants are not told the item classes or the base rate of defects.

## 2. Participants
- Inclusion: ≥ 18 years; can read Python *or* JavaScript; final-year/MSc CS students or professional developers.
- Exclusion: involvement in TrustCode development; prior exposure to the benchmark.
- **Target N = 40** (see §7); recruit 46 to allow ~15% attrition/exclusion.
- Recruitment through approved channels only (course mailing lists, developer meet-ups); no incentives that could coerce
  (a small voucher, if approved, is paid regardless of performance).

## 3. Procedure (≈ 60 minutes, remote or lab)
1. Information sheet, questions, consent (extension consent modal + signed form) — 5 min
2. Demographics: experience level, years of experience — 2 min
3. Training: 2 dev-split items per condition with the researcher (identical script per condition) — 10 min
4. Block 1: 8 items (condition per Latin square), accept/modify/reject + confidence 0–100 + optional reason — ~15 min
5. NASA-TLX (raw) + trust scale for block 1 condition — 3 min
6. Block 2: 8 items in the other condition — ~15 min
7. NASA-TLX + trust scale for block 2; SUS for TrustCode — 5 min
8. Open questions + debrief (reveal ground truth on request) — 5 min

## 4. Instruments
| Measure | Instrument | Stored as |
|---|---|---|
| Decision, confidence, time | Extension study mode | `experiment_trials` |
| Evidence engagement | Webview events (expand/collapse, Not-verified viewed) | `experiment_events` |
| Workload | NASA-TLX raw, 6 subscales 0–100 [hart1988nasatlx] | `experiment_questionnaires` (`nasa_tlx`) |
| Trust (attitude) | Trust in Automated Systems scale, 12 items [jian2000foundations] | `trust` |
| Usability | SUS, 10 items [lewis2018sus] | `sus` |
| Qualitative | Open questions | `open` |
Questionnaire items should be administered on the approved survey platform if the university requires it.
The `/experiments/questionnaires` endpoint stores responses keyed only by session.

## 5. Variables
See `research_questions.md` §4 and `data_dictionary.md`.

## 6. Data management
Pseudonymous participant codes (`P-XXXXXXXX`); the code ↔ consent-form list is kept on paper or an encrypted
university drive, separate from the data. No source code from participants is collected (benchmark items only).
Export: `GET /experiments/export.csv` (researcher role). Retention as required by the university (typically 5–10 years for research data).
Withdrawal: up to the date in the information sheet, by participant code.

## 7. Sample size (simulation, `research/analysis/power_simulation.py`, 300 sims per cell)
Assumptions: baseline false acceptance 0.45; random-intercept SDs 1.0 (participants), 0.5 (items); GEE logistic; α = .05.

| Defective items per condition | FA 0.45 → TrustCode | N=20 | N=30 | N=40 | N=60 |
|---|---|---|---|---|---|
| 4 (current benchmark) | 0.30 | 0.41 | 0.55 | 0.70 | 0.86 |
| 4 | 0.25 | 0.66 | 0.81 | 0.94 | 1.00 |
| 8 (if benchmark doubled) | 0.30 | 0.71 | 0.90 | 0.93 | 1.00 |
| 8 | 0.25 | 0.93 | 1.00 | 1.00 | 1.00 |

**Recommendation:** extend the eval split to 32 items (8 defective per condition; ~75 min session) **or** recruit ≥ 40.
With N = 40 and the current benchmark, H1 has ~0.70–0.94 power depending on effect size. H3 (interaction) and H4 are
underpowered and are therefore analysed as secondary/exploratory. Re-run the simulation with pilot estimates.

## 8. Pilot (Phase 13)
5–8 participants (not included in the main analysis): check timing, comprehension of status labels, item difficulty
(no item accepted or rejected by everyone), logging completeness, and estimate baseline FA and variance for §7.
Changes after the pilot are logged in `CHANGELOG.md`; the version is then frozen and tagged `experiment-v1`.

## 9. Risks to validity (summary; full discussion in the dissertation)
Demand characteristics (TrustCode is visibly the "new" tool); learning effects (counterbalanced); short snippets
(ecological validity); author-labelled benchmark (independent review required); student-heavy sample.
