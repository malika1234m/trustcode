"""Measure the project scanner on the labelled dataset (dataset.py). Nothing here is estimated.

A vulnerable case counts as detected only when a finding of the expected category sits on the expected line
of that file (exact-location recall). A safe case is a false positive when any finding of its category is
reported in that file. Usage: python scripts/security_eval/evaluate_scanner.py [--json OUT] [--keep DIR]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "verification-worker"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dataset import CASES  # noqa: E402
from trustcode_worker.scan.engine import scan  # noqa: E402


def build(dest: Path) -> None:
    for c in CASES:
        p = dest / c["path"]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(c["content"])
    subprocess.run(["git", "init", "-q"], cwd=dest, check=True)


def evaluate(dest: Path) -> dict:
    report = scan(dest, "full", use_cache=False)
    by_file: dict[str, list[dict]] = {}
    for f in report["findings"]:
        by_file.setdefault(f["path"], []).append(f)
    rows = []
    for c in CASES:
        found = by_file.get(c["path"], [])
        same = [f for f in found if f["category"] == c["category"]]
        if c["at"]:
            line = next(i for i, ln in enumerate(c["content"].splitlines(), 1) if c["at"] in ln)
            hit = [f for f in same if f["line"] <= line <= f["end_line"] or f["file_level"]]
            rows.append({"id": c["id"], "category": c["category"], "vulnerable": True, "detected": bool(hit), "wrong_line": bool(same) and not hit,
                         "rule": hit[0]["rule_id"] if hit else None, "severity": hit[0]["severity"] if hit else None, "confidence": hit[0]["confidence"] if hit else None,
                         "other": sorted({f["rule_id"] for f in found if f not in hit})})
        else:
            rows.append({"id": c["id"], "category": c["category"], "vulnerable": False, "flagged": bool(same), "rules": sorted({f["rule_id"] for f in same}),
                         "other": sorted({f["rule_id"] for f in found if f not in same})})

    def metrics(sub):
        tp = sum(r["vulnerable"] and r["detected"] for r in sub)
        fn = sum(r["vulnerable"] and not r["detected"] for r in sub)
        fp = sum((not r["vulnerable"]) and r["flagged"] for r in sub)
        tn = sum((not r["vulnerable"]) and not r["flagged"] for r in sub)
        d = lambda a, b: round(a / b, 3) if b else None  # noqa: E731
        p, r = d(tp, tp + fp), d(tp, tp + fn)
        return {"cases": len(sub), "tp": tp, "fp": fp, "tn": tn, "fn": fn, "precision": p, "recall": r,
                "f1": round(2 * p * r / (p + r), 3) if p and r else None, "false_positive_rate": d(fp, fp + tn), "false_negative_rate": d(fn, fn + tp)}

    cats = sorted({r["category"] for r in rows})
    return {"engine": report["engine"], "status": report["status"], "duration_ms": report["duration_ms"], "files_scanned": report["files"]["scanned"],
            "overall": metrics(rows), "by_category": {c: metrics([r for r in rows if r["category"] == c]) for c in cats},
            "missed": [r["id"] for r in rows if r["vulnerable"] and not r["detected"]],
            "false_positives": [{"id": r["id"], "rules": r["rules"]} for r in rows if not r["vulnerable"] and r["flagged"]],
            "noise_on_safe_files": [{"id": r["id"], "rules": r["other"]} for r in rows if not r["vulnerable"] and r["other"]],
            "failed_checks": [c for c in report["checks"] if c["status"] == "failed"], "cases": rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--keep", help="build the dataset project in this directory and leave it there")
    a = ap.parse_args()
    with tempfile.TemporaryDirectory(prefix="trustcode-eval-") as tmp:
        dest = Path(a.keep) if a.keep else Path(tmp)
        dest.mkdir(parents=True, exist_ok=True)
        build(dest)
        res = evaluate(dest)
    o = res["overall"]
    print(f"{res['engine']} status={res['status']} files={res['files_scanned']} time={res['duration_ms']}ms")
    print(f"overall: TP={o['tp']} FP={o['fp']} TN={o['tn']} FN={o['fn']} precision={o['precision']} recall={o['recall']} F1={o['f1']} FPR={o['false_positive_rate']}")
    for c, m in res["by_category"].items():
        print(f"  {c:24} cases={m['cases']:2} TP={m['tp']} FP={m['fp']} TN={m['tn']} FN={m['fn']} P={m['precision']} R={m['recall']}")
    print("missed:", res["missed"]); print("false positives:", res["false_positives"]); print("noise on safe files:", res["noise_on_safe_files"])
    print("failed checks:", res["failed_checks"])
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
