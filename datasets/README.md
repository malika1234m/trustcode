# TrustCode Benchmark v1

20 short Python/JavaScript snippets imitating AI-assistant output, with ground truth, built for
**measuring developer calibration** rather than model capability.

| Class | Meaning | Eval items | Purpose |
|---|---|---|---|
| C1 | Correct; checks clean | 4 | Under-reliance on clean evidence |
| C2 | Correct; spurious (false-positive) warning | 4 | Under-reliance caused by false alarms |
| D1 | Defect detectable by TrustCode's checks (failing supplied test or security rule) | 4 | Benefit of evidence |
| D2 | Defect outside the checks' coverage ("tool-blind") | 4 | Complacency (H3) |

- **Eval split (16):** blocks A and B each hold exactly one item per language x class, so a participant
  sees one block per condition (counterbalanced). **Dev split (4):** practice and training only.
- Files: `benchmark/items/<ID>.json` (code, task, visible tests, hidden ground-truth tests, frozen
  evidence snapshot, baseline explanation, provenance), `benchmark_metadata.csv`, `benchmark_validation.md`.
- Rebuild/validate: `python scripts/dataset_validation/build_benchmark.py` (needs Docker + the sandbox image).

## Why not HumanEval / MBPP / SWE-bench / Defects4J / Juliet directly?
They measure model or tool accuracy. None provides the C2/D2 contrast needed to separate *human
calibration* from *tool accuracy*, and several are likely in LLM training data. Task ideas follow the
same short-function style as HumanEval/MBPP, but all code here was written for this benchmark.

## Licence and provenance
Authored for TrustCode; CC-BY-4.0. Labels are author-defined with LLM assistance; **independent review is
required before the main study** (see `benchmark_validation.md`, Limitations).
