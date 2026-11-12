# Security scanner accuracy — measured results

Measured on 2026-11-12 with `python scripts/security_eval/evaluate_scanner.py` (macOS arm64, Semgrep 1.79.0, Bandit 1.9.4, Gitleaks 8.30.1).
Numbers come from `datasets/security_eval/results.json`.

## Method

138 small files: 94 vulnerable and 44 safe counterparts (parameterised SQL, placeholder
environment files, escaped output, verified JWTs and so on). A vulnerable case counts as detected only when a
finding of the expected category is reported **on the expected line**. A safe case is a false positive when any
finding of its category is reported in that file.

## Result

Overall: 94 of 94 vulnerable cases detected at the exact line, 0 false positives on 44 safe cases
(precision 1.0, recall 1.0, F1 1.0, false-positive rate 0.0, false-negative rate 0.0).

| Category | Cases | Detected at exact line | Missed | False positives on safe cases | Precision | Recall |
|---|---|---|---|---|---|---|
| agent-config | 6 | 5 | 0 | 0 | 1.0 | 1.0 |
| api-security | 5 | 4 | 0 | 0 | 1.0 | 1.0 |
| authentication | 9 | 6 | 0 | 0 | 1.0 | 1.0 |
| authorization | 9 | 4 | 0 | 0 | 1.0 | 1.0 |
| ci-cd | 3 | 2 | 0 | 0 | 1.0 | 1.0 |
| command-injection | 9 | 7 | 0 | 0 | 1.0 | 1.0 |
| configuration | 5 | 3 | 0 | 0 | 1.0 | 1.0 |
| cors | 4 | 3 | 0 | 0 | 1.0 | 1.0 |
| cryptography | 7 | 7 | 0 | 0 | 1.0 | 1.0 |
| database | 2 | 1 | 0 | 0 | 1.0 | 1.0 |
| dependencies | 2 | 1 | 0 | 0 | 1.0 | 1.0 |
| destructive-command | 1 | 1 | 0 | 0 | 1.0 | 1.0 |
| environment | 7 | 5 | 0 | 0 | 1.0 | 1.0 |
| frontend | 2 | 1 | 0 | 0 | 1.0 | 1.0 |
| infrastructure | 9 | 5 | 0 | 0 | 1.0 | 1.0 |
| logging | 3 | 2 | 0 | 0 | 1.0 | 1.0 |
| path-traversal | 8 | 6 | 0 | 0 | 1.0 | 1.0 |
| secrets | 15 | 10 | 0 | 0 | 1.0 | 1.0 |
| sql-injection | 12 | 7 | 0 | 0 | 1.0 | 1.0 |
| ssrf | 3 | 2 | 0 | 0 | 1.0 | 1.0 |
| suppression | 1 | 1 | 0 | 0 | 1.0 | 1.0 |
| unsafe-deserialization | 4 | 4 | 0 | 0 | 1.0 | 1.0 |
| xss | 8 | 5 | 0 | 0 | 1.0 | 1.0 |
| xxe | 4 | 2 | 0 | 0 | 1.0 | 1.0 |

The first run of this set had one false positive (a placeholder flagged by the older name-based secret rule); it
was fixed by recognising placeholders before the figures above were recorded.

Performance (from the regression suite): 2,001 Python files scanned in 7.9 s cold; 1.2 s after changing one file.

## Rule coverage

91 of 106 rules have at least one labelled case in this set. Of the rest, TC-DEP-004, TC-REG-001/003/005/008/009,
TC-SEC-006 and TC-SEC-007 need a Git history, a network lookup or build output and are covered by the regression
tests in `verification-worker/tests/test_scan.py` instead. No labelled case exists for:
`assert-for-validation`, `java-trust-all-certificates`, `js-hardcoded-secret`, `js-insecure-random`, `js-runtime-or-test-tampering`, `js-sql-concat`, `runtime-or-test-tampering`.
Most of the 48 cases added for rule coverage have no safe counterpart, so they measure detection only.

## These numbers overstate real-world accuracy

1. **The rules and the cases were written together by the same author.** Every vulnerable case uses a pattern a
   rule was written for. A perfect score here means the rules do what they were designed to do, nothing more.
2. **Small and synthetic.** One to six lines of relevant code per case; no real project, no framework indirection,
   no data flow across files.
3. **Not independently labelled**, and no confidence intervals: with 28 safe cases, one false positive moves the rate by 3.6 points.
4. **Categories with one or two cases** (SSRF, configuration, deserialisation, database) say almost nothing.
5. **What is known to be missed** is not in the set: object-level authorization, rate limiting, cross-file flows.

A credible estimate needs an external corpus that was not used to write the rules (for example OWASP Benchmark
or a labelled sample of real repositories). That has not been done.

Regression guard: `verification-worker/tests/test_scan.py::test_accuracy_matches_recorded_baseline`.
