# Engine accuracy evaluation set

Measures what the verification engine's **static** checks detect. It is separate from `datasets/benchmark/`
(the frozen human-calibration benchmark used in the study) and never changes it.

| File | Content |
|---|---|
| `../../scripts/engine_eval/cases.py` | 89 labelled snippets (Python / JavaScript / TypeScript) in 9 categories |
| `../../scripts/engine_eval/run_eval.py` | Runs the engine on every case and computes the metrics |
| `../../scripts/engine_eval/bench_time.py` | Wall-clock comparison with sandboxed tests (needs Docker) |
| `baseline.json` | Per-case outcome the regression test compares against |
| `results_before_0.1.0.json` | Measured with the original check set, stages sequential (`--profile study-v1 --sequential`) |
| `results_extended.json`, `results_extended_registry.json` | Measured with the current product check set, without / with registry lookups |
| `timing.json` | Output of `bench_time.py` |

```bash
python scripts/engine_eval/run_eval.py                      # current engine
python scripts/engine_eval/run_eval.py --profile study-v1   # frozen research check set
python scripts/engine_eval/run_eval.py --registry           # also look up packages on PyPI / npm (network)
```

`verification-worker/tests/test_extended_engine.py::test_accuracy_does_not_regress_against_recorded_baseline`
fails when a correct case becomes flagged or a detected defect is no longer detected. If a change is
intentional, add or relabel cases first, then regenerate `baseline.json` from a fresh `run_eval.py --write`
result and explain the change in the commit.

Results and limitations: `docs/testing/engine_accuracy.md`.
