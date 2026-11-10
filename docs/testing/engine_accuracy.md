# Engine accuracy and performance — measured results

Measured on 2026-11-10 on the development machine (macOS arm64, Python 3.14.5, ruff 0.17.3, Semgrep 1.79.0,
mypy 2.4.1) with `scripts/engine_eval/`. Every number below comes from the result files in
`datasets/engine_eval/`; nothing is estimated.

## What is measured

89 labelled snippets, static checks only (no test execution). Per case:

- **flagged** — at least one finding of severity *medium* or higher.
- **detected** — flagged by a rule that matches the labelled defect ("targeted recall"), not merely "something was reported".
- Low-severity findings (unused import, empty catch) are advisory and are not counted as flags.

## Accuracy: before and after

"Before" is the original check set run exactly as engine 0.1.0 ran it (`--profile study-v1 --sequential`).
"After" is engine 0.2.0's default `extended` profile.

| Metric | Before (0.1.0) | After (0.2.0) | After + registry lookup |
|---|---|---|---|
| True positives / false negatives (58 defective cases) | 28 / 30 | 44 / 14 | 46 / 12 |
| False positives / true negatives (31 non-defective cases) | 1 / 30 | 1 / 30 | 1 / 30 |
| Precision | 0.966 | 0.978 | 0.979 |
| Recall | 0.483 | 0.759 | 0.793 |
| F1 | 0.644 | 0.855 | 0.876 |
| False-positive rate | 0.032 | 0.032 | 0.032 |
| False-negative rate | 0.517 | 0.241 | 0.207 |
| Targeted recall (the labelled defect itself was found) | 0.500 | 0.776 | 0.810 |
| Tool failure rate (checks ending in `check_failed`) | 0.0 | 0.0 | 0.0 |
| Median / p95 time per case (static only) | 748 / 1064 ms | 764 / 952 ms | — |

Defective cases flagged, by category:

| Category | Cases | Before | After | Not detected after (and why) |
|---|---|---|---|---|
| Syntax errors | 6 | 6 | 6 | — |
| Security vulnerabilities | 18 | 15 | 16 | SSRF, unverified JWT decode: no rule; need data-flow or intent |
| Hardcoded secrets | 6 | 2 | 6 | — |
| Logic errors | 11 | 3 | 6 | off-by-one, wrong boundary, division by zero, numeric sort: need tests |
| Missing / hallucinated dependencies | 4 | 1 | 1 (3 with registry) | undeclared `fs` in JavaScript: undefined names are not checked for JS/TS |
| AI-style subtle defects | 13 | 1 | 9 | missing `await` (Python and JS), TypeScript type error, `except: pass` (reported, but low severity) |
| Correct code (false positives) | 16 | 1 | 1 | `random.shuffle` for a quiz is reported by the `insecure-random` rule |
| Valid but unusual code | 9 | 0 | 0 | — |
| Engine edge cases (empty, unicode, placeholders) | 6 | 0 | 0 | — |

## Performance: before and after (with sandboxed tests)

`scripts/engine_eval/bench_time.py`, 20 benchmark items x 3 repetitions, tests executed in the Docker sandbox:

| Configuration | Median | Mean | p95 |
|---|---|---|---|
| Before: original check set, stages sequential | 1454 ms | 1524 ms | 2248 ms |
| Original check set, stages concurrent | 999 ms | 1098 ms | 2035 ms |
| Extended check set, stages sequential | 1805 ms | 1994 ms | 3214 ms |
| **After: extended check set, stages concurrent** | **928 ms** | **976 ms** | **1480 ms** |

The extended profile runs two more checks and still finishes about 36 % sooner at the median, because the
stages (which mostly wait on a subprocess) now run concurrently. Without test execution the gain is small:
Semgrep alone accounts for most of the time.

## Limitations — read before quoting these numbers

1. **Small, author-written set.** 89 cases written by the same author as the rules (LLM-assisted), not
   independently labelled. Several cases were written knowing which rules exist. The figures are a
   regression signal for this repository, **not** an estimate of accuracy on real AI-generated code.
2. **No confidence intervals.** With 31 non-defective cases, one false positive moves the false-positive
   rate by 3.2 percentage points.
3. **Case-level, not finding-level.** A defective case counts as detected when any qualifying rule fires.
4. **Static only.** Logic errors are mostly invisible without tests; the low recall there is the expected
   and honest result, which is why the product lists "Runtime behaviour" under *Not verified*.
5. **One machine, warm caches.** Timings will differ on the serverless deployment (no ruff binary, no mypy).
6. **The "after" rules were developed against this set.** The gain on unseen code will be smaller.

A proper external evaluation would use an independently labelled sample (for example a slice of CWE-labelled
test suites plus real assistant output reviewed by a second rater) held out from rule development.
