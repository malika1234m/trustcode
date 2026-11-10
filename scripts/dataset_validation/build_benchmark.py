"""Build and validate the TrustCode benchmark from items_spec.py.

For every item this script ACTUALLY:
  1. runs the TrustCode verification engine with the visible tests (-> frozen evidence snapshot);
  2. runs the hidden ground-truth tests in the sandbox;
  3. checks the item behaves as its class requires (C1/C2/D1/D2);
  4. checks duplicates (sha256) and the eval-split block balance.
Writes datasets/benchmark/items/*.json, datasets/benchmark_metadata.csv and
datasets/benchmark_validation.md (results as observed; failures are reported, not hidden).
Usage: python scripts/dataset_validation/build_benchmark.py
"""
import csv
import hashlib
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from items_spec import ITEMS  # noqa: E402
from trustcode_worker.models import VerificationRequest  # noqa: E402
from trustcode_worker.pipeline import ENGINE_VERSION, verify  # noqa: E402
from trustcode_worker.analyzers.security import ruleset_digest  # noqa: E402
from trustcode_worker.sandbox.docker_runner import IMAGE, run_in_sandbox  # noqa: E402

OUT = ROOT / "datasets" / "benchmark" / "items"


def classify(item, result, hidden):
    checks = {c.kind.value: c for c in result.checks}
    sec = checks["security"].findings
    lint = [f for f in checks["lint"].findings if f.severity.value in ("medium", "high", "critical")]
    vis = checks["tests"].details
    vis_pass = checks["tests"].status.value == "passed"
    hidden_pass = hidden is not None and all(t["outcome"] == "passed" for t in hidden)
    problems = []
    if checks["syntax"].status.value != "passed":
        problems.append("syntax check not passed")
    if checks["tests"].status.value in ("check_failed", "not_run"):
        problems.append(f"visible tests could not run: {checks['tests'].error}")
    if hidden is None:
        problems.append("hidden tests could not run")
    cls = item["cls"]
    if cls == "C1":
        if sec or lint: problems.append(f"C1 expects no findings, got {[f.rule_id for f in sec + lint]}")
        if not vis_pass: problems.append("C1 visible tests must pass")
        if not hidden_pass: problems.append("C1 hidden tests must pass")
    elif cls == "C2":
        if not sec: problems.append("C2 expects a (spurious) security finding")
        if not vis_pass: problems.append("C2 visible tests must pass")
        if not hidden_pass: problems.append("C2 hidden tests must pass")
    elif cls == "D1":
        detectable = (not vis_pass) or any(f.severity.value in ("high", "critical") for f in sec)
        if not detectable: problems.append("D1 expects a failing visible test or a high-severity finding")
        if hidden_pass: problems.append("D1 hidden tests must fail (defect confirmed)")
    elif cls == "D2":
        if sec or lint: problems.append(f"D2 expects no findings, got {[f.rule_id for f in sec + lint]}")
        if not vis_pass: problems.append("D2 visible tests must pass")
        if hidden_pass: problems.append("D2 hidden tests must fail (defect confirmed)")
    observed = {"visible_tests": f"{vis.get('passed', 0)} passed / {vis.get('failed', 0)} failed",
                "security_findings": [f.rule_id for f in sec], "lint_findings": [f.rule_id for f in lint],
                "hidden_tests": "error" if hidden is None else f"{sum(t['outcome'] == 'passed' for t in hidden)}/{len(hidden)} passed"}
    return problems, observed


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows, report, hashes = [], [], Counter()
    for item in ITEMS:
        hashes[hashlib.sha256(item["code"].encode()).hexdigest()] += 1
        result = verify(VerificationRequest(code=item["code"], language=item["language"], task=item["task"],
                                            tests=item["visible_tests"]),
                        profile="study-v1")  # frozen check set: the benchmark must not change when the product engine grows
        h = run_in_sandbox(item["language"], item["code"], item["hidden_tests"])
        hidden = h.data["tests"] if h.ok and h.data.get("status") == "ok" else None
        problems, observed = classify(item, result, hidden)
        rec = {
            "id": item["id"], "language": item["language"], "class": item["cls"], "block": item["block"], "split": item["split"],
            "task": item["task"], "code": item["code"], "visible_tests": item["visible_tests"], "hidden_tests": item["hidden_tests"],
            "ground_truth": {"correct": item["cls"] in ("C1", "C2"), "defect": item["defect"], "explanation": item["explanation_gt"],
                             "label_source": "author (LLM-assisted); independent review pending"},
            "baseline_explanation": item["baseline_explanation"],
            "evidence_snapshot": result.model_dump(mode="json"),
            "provenance": {"engine": ENGINE_VERSION, "ruleset": ruleset_digest(), "sandbox_image": IMAGE, "built": str(date.today())},
            "source": "authored for TrustCode", "licence": "CC-BY-4.0",
            "validation": {"passed": not problems, "problems": problems, "observed": observed},
        }
        (OUT / f"{item['id']}.json").write_text(json.dumps(rec, indent=2))
        rows.append({"id": item["id"], "language": item["language"], "class": item["cls"], "block": item["block"] or "",
                     "split": item["split"], "ground_truth_correct": rec["ground_truth"]["correct"],
                     "known_defect": item["defect"] or "", "severity": "high" if item["cls"] == "D1" and "CWE" in (item["defect"] or "") else
                     ("medium" if item["cls"] in ("D1", "D2") else ""), "visible_tests": observed["visible_tests"],
                     "security_findings": ";".join(observed["security_findings"]), "hidden_tests": observed["hidden_tests"],
                     "validation_passed": not problems, "source": "authored", "licence": "CC-BY-4.0",
                     "validation_method": "engine run + sandboxed hidden tests"})
        report.append((item, problems, observed))
        print(f"{'OK  ' if not problems else 'FAIL'} {item['id']:10} {observed} {problems}")
    with open(ROOT / "datasets" / "benchmark_metadata.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    dups = [h for h, n in hashes.items() if n > 1]
    ev = [i for i in ITEMS if i["split"] == "eval"]
    balance = Counter((i["block"], i["language"], i["cls"]) for i in ev)
    balanced = len(balance) == 16 and set(balance.values()) == {1}
    n_ok = sum(not p for _, p, _ in report)
    lines = [f"# Benchmark Validation Report (generated {date.today()})", "",
             "Generated by `scripts/dataset_validation/build_benchmark.py`. Every number below comes from an actual run.", "",
             f"- Engine: `{ENGINE_VERSION}`, Semgrep ruleset `{ruleset_digest()}`, sandbox image `{IMAGE}`",
             f"- Items: {len(ITEMS)} ({len(ev)} eval, {len(ITEMS) - len(ev)} dev)",
             f"- Items passing class validation: **{n_ok}/{len(ITEMS)}**",
             f"- Duplicate code snippets: {len(dups)}",
             f"- Eval split balanced (1 item per block x language x class): **{balanced}**",
             "- Leakage control: dev items are used for training/practice only and are never shown in the eval blocks.", "",
             "| Item | Class | Block | Visible tests | Security findings | Hidden (ground-truth) tests | Valid | Problems |",
             "|---|---|---|---|---|---|---|---|"]
    for item, p, o in report:
        lines.append(f"| {item['id']} | {item['cls']} | {item['block'] or 'dev'} | {o['visible_tests']} | "
                     f"{', '.join(o['security_findings']) or '-'} | {o['hidden_tests']} | {'yes' if not p else 'NO'} | {'; '.join(p) or '-'} |")
    lines += ["", "## Limitations", "",
              "- Ground-truth labels were authored by the TrustCode developer with LLM assistance. **Independent review by at least one",
              "  other person (e.g. supervisor or a peer) is required before the main study**; record reviewer agreement here.",
              "- Items are short single-function snippets; the defect distribution is designed, not representative of real-world frequencies.",
              "- 'Tool-blind' (D2) is defined relative to this engine version, ruleset and the supplied tests; it changes if any of these change.",
              "- C2 spurious warnings come from deliberately low-confidence rules (insecure randomness, weak hash) applied out of context."]
    (ROOT / "datasets" / "benchmark_validation.md").write_text("\n".join(lines) + "\n")
    print(f"\n{n_ok}/{len(ITEMS)} valid; duplicates={len(dups)}; balanced={balanced}")
    return 0 if n_ok == len(ITEMS) and not dups and balanced else 1


if __name__ == "__main__":
    sys.exit(main())
