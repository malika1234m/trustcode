# Experiment Tasks

Source of truth: `datasets/benchmark/items/*.json` (built and validated by `scripts/dataset_validation/build_benchmark.py`; 20/20 valid).

| Block A | Block B |
|---|---|
| PY-C1-01 median | PY-C1-02 parse_pairs |
| PY-C2-01 shuffled_questions (insecure-random FP) | PY-C2-02 cache_key (MD5 FP) |
| PY-D1-01 find_user (SQL injection; Semgrep) | PY-D1-02 last_n (n=0; failing test) |
| PY-D2-01 is_leap_year (century rule; tool-blind) | PY-D2-02 average (empty list; tool-blind) |
| JS-C1-01 titleCase | JS-C1-02 clamp |
| JS-C2-01 randomAvatarColour (Math.random FP) | JS-C2-02 checksum (MD5 FP) |
| JS-D1-01 getProduct (SQL injection; Semgrep) | JS-D1-02 sum (off-by-one; failing test) |
| JS-D2-01 isPalindrome (punctuation; tool-blind) | JS-D2-02 countWords (whitespace; tool-blind) |

Training (dev split, not analysed): PY-C1-D1, JS-D1-D1, PY-D2-D1, JS-C2-D1.

Participant instruction (read verbatim in both conditions):
> "You will see code that an AI assistant wrote for the task shown. Decide whether you would accept it into your project as is,
> modify it, or reject it. Use any information on screen. You may reason about the code but please do not run it or search the web.
> After each decision, say how confident you are that your decision is right."

Not disclosed: item classes, the number of defective items, which tool checks exist.
**Before the main study:** independent review of ground truth (KI-008) and, per the power analysis, extending to 32 eval items.
