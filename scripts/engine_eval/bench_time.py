"""Wall-clock comparison on the 20 benchmark items WITH sandboxed tests (needs Docker + the sandbox image).

  before = the 0.1.0 behaviour: frozen check set, stages one after another
  after  = extended check set (more checks), stages concurrent
Usage: python scripts/engine_eval/bench_time.py [--reps 3]
"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "verification-worker"))
from trustcode_worker.models import VerificationRequest  # noqa: E402
from trustcode_worker.pipeline import verify  # noqa: E402

CONFIGS = {"before (study-v1, sequential)": ("study-v1", False), "study-v1, parallel": ("study-v1", True),
           "extended, sequential": ("extended", False), "after (extended, parallel)": ("extended", True)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=3)
    reps = ap.parse_args().reps
    items = [json.loads(p.read_text()) for p in sorted((ROOT / "datasets" / "benchmark" / "items").glob("*.json"))]
    reqs = [VerificationRequest(code=i["code"], language=i["language"], task=i["task"], tests=i["visible_tests"]) for i in items]
    verify(reqs[0], profile="extended")  # warm caches (tool versions, docker image lookup)
    out = {}
    for name, (profile, parallel) in CONFIGS.items():
        times, failed = [], 0
        for _ in range(reps):
            for r in reqs:
                t0 = time.perf_counter()
                res = verify(r, run_tests=True, profile=profile, parallel=parallel)
                times.append((time.perf_counter() - t0) * 1000)
                failed += sum(c.status.value == "check_failed" for c in res.checks)
        times.sort()
        out[name] = {"runs": len(times), "median_ms": round(statistics.median(times)), "mean_ms": round(statistics.mean(times)),
                     "p95_ms": round(times[int(len(times) * 0.95) - 1]), "failed_checks": failed}
        print(f"{name:34} {out[name]}")
    (ROOT / "datasets" / "engine_eval" / "timing.json").write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
