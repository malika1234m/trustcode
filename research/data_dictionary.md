# Data Dictionary — `trustcode_trials.csv` (export) and questionnaires

| Column | Type | Description |
|---|---|---|
| participant_code | string | Pseudonymous `P-XXXXXXXX`; no link to accounts |
| study_id | string | e.g. `pilot`, `main` |
| sequence_index | int | Session order within study; drives counterbalancing |
| software_version | string | Frozen experiment software version |
| adaptation | `fixed`/`adapted` | Exploratory presentation factor (TrustCode condition) |
| experience_level | `beginner`/`intermediate`/`advanced` | Self-declared |
| years_experience | int | Self-declared |
| position | int 0–15 | Trial order |
| condition | `baseline`/`trustcode` | Interface condition |
| item_id, item_class, language | string | Benchmark item; class C1/C2/D1/D2 |
| ground_truth_correct | bool | True for C1/C2 |
| decision | `accept`/`modify`/`reject` | Participant decision |
| accepted | 0/1 | decision == accept |
| decision_correct | 0/1 | accept on correct item, or not-accept on defective item |
| confidence | int 0–100 | Confidence that the decision is correct |
| time_ms | int | From trial shown to decision |
| n_evidence_expand, n_unverified_view, n_request_more_checks | int | Engagement events for the trial |

Derived (analysis script): `false_accept` = accepted ∧ ¬ground_truth_correct; `false_reject` = ¬accepted ∧ ground_truth_correct;
`brier` = (confidence/100 − decision_correct)²; `detectability` = D1 vs D2.

Questionnaires (`experiment_questionnaires.responses`): `nasa_tlx` {mental, physical, temporal, performance, effort, frustration: 0–100};
`trust` {q1…q12: 1–7}; `sus` {q1…q10: 1–5}; `open` {free text}.
