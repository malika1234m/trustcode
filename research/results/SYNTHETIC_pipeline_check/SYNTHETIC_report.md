# !!! SYNTHETIC DATA - PIPELINE CHECK ONLY - NOT A STUDY RESULT !!!

Participants: 40, trials: 640

## Descriptives

|                     |   accept_rate |   correct |   n |
|:--------------------|--------------:|----------:|----:|
| ('baseline', 'C1')  |         0.775 |     0.775 |  80 |
| ('baseline', 'C2')  |         0.825 |     0.825 |  80 |
| ('baseline', 'D1')  |         0.588 |     0.412 |  80 |
| ('baseline', 'D2')  |         0.538 |     0.462 |  80 |
| ('trustcode', 'C1') |         0.75  |     0.75  |  80 |
| ('trustcode', 'C2') |         0.7   |     0.7   |  80 |
| ('trustcode', 'D1') |         0.238 |     0.762 |  80 |
| ('trustcode', 'D2') |         0.475 |     0.525 |  80 |

## H1 false acceptance (defective items)
OR(TrustCode vs baseline) = 0.43 [0.28, 0.65], p = 0.0001

## H1b false rejection (correct items), non-inferiority margin +0.10
mean diff = 0.075, one-sided 95% upper bound = 0.152 -> not shown

## H2 Brier score (lower = better calibrated)
baseline 0.204, TrustCode 0.204, t = -0.06, p = 0.9504, d_z = -0.01

## H3 condition x detectability
interaction OR = 3.58, p = 0.0003

## Holm-adjusted p-values

- H1: 0.0002
- H1b: 0.5923
- H2: 0.9504
- H3: 0.0009

Verdicts must be written by the researcher (Supported / Not supported / Inconclusive) with effect sizes and validity threats.


!!! SYNTHETIC DATA - PIPELINE CHECK ONLY - NOT A STUDY RESULT !!!
Built-in synthetic truth: TrustCode lowers acceptance of D1 strongly, D2 slightly, raises C2 rejection.
