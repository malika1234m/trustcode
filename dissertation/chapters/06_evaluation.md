# Chapter 6 — Testing and Evaluation

## 6.1 Functional and security testing (complete — real results)
From `TEST_REPORT.md`: worker 25 tests, backend 30, extension 12 unit + 5 extension-host, full-stack e2e 15/15,
benchmark validation 20/20. Defects found by testing (D-1 rate-limit lockout, D-2 wording, D-3 benchmark item) and six
security-review findings were fixed and regression-tested. Untested areas are listed in the report.

## 6.2 Benchmark validation (complete)
`datasets/benchmark_validation.md`.

## 6.3 Performance
Observed 2–6 s per verification in the e2e worker log on a laptop; no load testing **[TODO]**.

## 6.4 Pilot study — [PENDING DATA]
## 6.5 Main experiment: participant flow, descriptives — [PENDING DATA]
## 6.6 Hypothesis tests H1, H1b, H2, H3 (confirmatory) — [PENDING DATA]
## 6.7 Exploratory analyses (H3-exp, H4, RQ4, qualitative) — [PENDING DATA]
Do not write these sections until real data exist; use `research/analysis/analyze.py` on the exported CSV.
