"""Measure the verification engine against the labelled cases in cases.py (static checks only).

Usage:  python scripts/engine_eval/run_eval.py [--profile extended|study-v1] [--sequential] [--jobs N]
                                               [--registry] [--write] [--json OUT]

Definitions (per case):
  flagged   = at least one finding of severity medium or higher from a deterministic check
  detected  = flagged by one of the rules/checks listed in the case's `expect` (the labelled defect was found,
              not merely "something")
  TP/FN     = defective case flagged / not flagged;  FP/TN = non-defective case flagged / not flagged
Low-severity findings (unused import, empty catch ...) are advisory and counted separately as "noise".
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "verification-worker"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cases import CASES  # noqa: E402
from trustcode_worker.models import SEVERITY_ORDER, Severity, VerificationRequest  # noqa: E402
from trustcode_worker.pipeline import verify  # noqa: E402

FLAG_AT = SEVERITY_ORDER[Severity.MEDIUM]


def run_case(c: dict, profile: str, parallel: bool) -> dict:
    t0 = time.perf_counter()
    r = verify(VerificationRequest(code=c["code"], language=c["lang"]), run_tests=False, profile=profile, parallel=parallel)
    ms = (time.perf_counter() - t0) * 1000
    findings = [f for ch in r.checks for f in ch.findings]
    strong = [f for f in findings if SEVERITY_ORDER[f.severity] <= FLAG_AT]
    rules = sorted({f.rule_id or f.check.value for f in findings})
    expect = c["expect"]
    hit = bool(expect) and any((f.rule_id in expect or f.check.value in expect) for f in findings)
    return {"id": c["id"], "lang": c["lang"], "category": c["category"], "defective": c["defective"],
            "flagged": bool(strong), "detected": hit, "expected_detectable": bool(expect),
            "rules": rules, "strong_rules": sorted({f.rule_id or f.check.value for f in strong}),
            "noise": len(findings) - len(strong), "ms": round(ms, 1),
            "checks": {ch.kind.value: ch.status.value for ch in r.checks},
            "failed_checks": [ch.kind.value for ch in r.checks if ch.status.value == "check_failed"]}


def metrics(rows: list[dict]) -> dict:
    tp = sum(r["defective"] and r["flagged"] for r in rows)
    fn = sum(r["defective"] and not r["flagged"] for r in rows)
    fp = sum((not r["defective"]) and r["flagged"] for r in rows)
    tn = sum((not r["defective"]) and not r["flagged"] for r in rows)
    div = lambda a, b: round(a / b, 3) if b else None  # noqa: E731
    precision, recall = div(tp, tp + fp), div(tp, tp + fn)
    f1 = round(2 * precision * recall / (precision + recall), 3) if precision and recall else None
    defective = [r for r in rows if r["defective"]]
    n_checks = sum(len(r["checks"]) for r in rows)
    times = sorted(r["ms"] for r in rows)
    return {"cases": len(rows), "tp": tp, "fp": fp, "tn": tn, "fn": fn,
            "precision": precision, "recall": recall, "f1": f1,
            "false_positive_rate": div(fp, fp + tn), "false_negative_rate": div(fn, fn + tp),
            "targeted_recall": div(sum(r["detected"] for r in defective), len(defective)),
            "noise_findings_on_clean_code": sum(r["noise"] for r in rows if not r["defective"]),
            "tool_failure_rate": div(sum(len(r["failed_checks"]) for r in rows), n_checks),
            "time_ms": {"median": round(statistics.median(times), 1), "p95": round(times[max(0, int(len(times) * 0.95) - 1)], 1),
                        "max": times[-1], "total_s": round(sum(times) / 1000, 1)}}


def evaluate(profile: str = "extended", parallel: bool = True, jobs: int = 1) -> dict:
    if jobs > 1:
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            rows = list(pool.map(lambda c: run_case(c, profile, parallel), CASES))
    else:
        rows = [run_case(c, profile, parallel) for c in CASES]
    by_cat = {}
    for cat in sorted({r["category"] for r in rows}):
        sub = [r for r in rows if r["category"] == cat]
        d = [r for r in sub if r["defective"]]
        by_cat[cat] = {"cases": len(sub), "defective": len(d), "flagged": sum(r["flagged"] for r in sub),
                       "detected_labelled_defect": sum(r["detected"] for r in d)}
    return {"profile": profile, "stage_execution": "parallel" if parallel else "sequential",
            "registry_lookup": os.environ.get("TRUSTCODE_REGISTRY_CHECK", "0") == "1",
            "overall": metrics(rows), "by_category": by_cat,
            "false_positives": [{"id": r["id"], "rules": r["strong_rules"]} for r in rows if r["flagged"] and not r["defective"]],
            "false_negatives": [r["id"] for r in rows if r["defective"] and not r["flagged"]],
            "missed_but_expected": [r["id"] for r in rows if r["defective"] and r["expected_detectable"] and not r["detected"]],
            "cases": rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="extended", choices=["extended", "study-v1"])
    ap.add_argument("--sequential", action="store_true", help="run pipeline stages one after another (the 0.1.0 behaviour)")
    ap.add_argument("--jobs", type=int, default=1, help="cases evaluated concurrently (use 1 for meaningful timings)")
    ap.add_argument("--registry", action="store_true", help="enable PyPI/npm existence lookups (network)")
    ap.add_argument("--write", action="store_true", help="write datasets/engine_eval/results_<profile>.json")
    ap.add_argument("--json", help="write the full result to this path")
    a = ap.parse_args()
    if a.registry:
        os.environ["TRUSTCODE_REGISTRY_CHECK"] = "1"
    verify(VerificationRequest(code="x = 1\n", language="python"), run_tests=False, profile=a.profile)  # warm tool caches
    res = evaluate(a.profile, not a.sequential, a.jobs)
    o = res["overall"]
    print(f"profile={res['profile']} stages={res['stage_execution']} registry={res['registry_lookup']} cases={o['cases']}")
    print(f"  TP={o['tp']} FP={o['fp']} TN={o['tn']} FN={o['fn']}  precision={o['precision']} recall={o['recall']} F1={o['f1']}")
    print(f"  FPR={o['false_positive_rate']} FNR={o['false_negative_rate']} targeted_recall={o['targeted_recall']} "
          f"tool_failure_rate={o['tool_failure_rate']} noise_on_clean={o['noise_findings_on_clean_code']}")
    print(f"  time per case: median={o['time_ms']['median']}ms p95={o['time_ms']['p95']}ms max={o['time_ms']['max']}ms total={o['time_ms']['total_s']}s")
    for cat, v in res["by_category"].items():
        print(f"  {cat:20} cases={v['cases']:2} defective={v['defective']:2} flagged={v['flagged']:2} labelled-defect-detected={v['detected_labelled_defect']:2}")
    print("  false positives:", res["false_positives"])
    print("  false negatives:", res["false_negatives"])
    print("  expected but missed:", res["missed_but_expected"])
    out = a.json or (ROOT / "datasets" / "engine_eval" / f"results_{a.profile}{'_registry' if a.registry else ''}.json" if a.write else None)
    if out:
        Path(out).write_text(json.dumps(res, indent=1) + "\n")
        print("wrote", out)


if __name__ == "__main__":
    main()
