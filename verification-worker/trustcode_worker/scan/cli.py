"""trustcode-scan: local project security scanner (used by the VS Code extension, Git hooks and CI).

Exit codes: 0 = allowed / report only, 1 = blocked by policy, 2 = scan failed or incomplete where the policy
requires a complete scan, 3 = usage or set-up problem (for example an existing Git hook that was not replaced).
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import stat
import sys
from pathlib import Path

from .catalogue import RULES
from .engine import ENGINE, STATE_DIR, _git, mark_reviewed, scan, tools_status

HOOK_MARK = "# trustcode-scan hook v1"
HOOKS = {"pre-commit": "staged", "pre-push": "push"}


def hook_script(name: str) -> str:
    return f"""#!/bin/sh
{HOOK_MARK} ({name}). Installed by `trustcode-scan hooks install`. Remove this file to uninstall.
if ! command -v trustcode-scan >/dev/null 2>&1; then
  echo "TrustCode: trustcode-scan is not installed - the {name} security check was SKIPPED." >&2
  [ "$TRUSTCODE_REQUIRE_SCANNER" = "1" ] && exit 1
  exit 0
fi
exec trustcode-scan --mode {HOOKS[name]} --format text
"""


def _hooks_dir(root: Path) -> Path | None:
    out = _git(root, "rev-parse", "--git-path", "hooks")
    return (root / out.strip()).resolve() if out else None


def hooks_status(root: Path) -> dict:
    d = _hooks_dir(root)
    if d is None:
        return {"git": False, "hooks": {}}
    res = {}
    for name in HOOKS:
        p = d / name
        if not p.exists():
            state = "not installed"
        elif HOOK_MARK in p.read_text(errors="replace"):
            state = "installed" if os.access(p, os.X_OK) else "installed but not executable"
        else:
            state = "another hook exists (not modified)"
        res[name] = {"state": state, "path": str(p)}
    managers = [m for m, f in (("husky", ".husky"), ("pre-commit framework", ".pre-commit-config.yaml"), ("lefthook", "lefthook.yml")) if (root / f).exists()]
    return {"git": True, "hooks": res, "hooks_path": str(d), "managers": managers}


def hooks_install(root: Path, names: list[str]) -> int:
    d = _hooks_dir(root)
    if d is None:
        print("Not a Git repository: hooks cannot be installed here. Full-project scans work without Git.", file=sys.stderr)
        return 3
    status = hooks_status(root)
    if status["managers"]:
        print(f"This repository uses {', '.join(status['managers'])}. TrustCode does not edit its configuration. Add this command to your "
              "pre-commit / pre-push step yourself:\n  trustcode-scan --mode staged   (pre-commit)\n  trustcode-scan --mode push     (pre-push)", file=sys.stderr)
        return 3
    rc = 0
    d.mkdir(parents=True, exist_ok=True)
    for name in names:
        p = d / name
        if p.exists() and HOOK_MARK not in p.read_text(errors="replace"):
            print(f"{name}: an existing hook was found at {p} and was NOT changed. Add this line to it to run the check:\n"
                  f"  trustcode-scan --mode {HOOKS[name]} --format text || exit 1", file=sys.stderr)
            rc = 3
            continue
        p.write_text(hook_script(name))
        p.chmod(p.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        if not os.access(p, os.X_OK):
            print(f"{name}: written to {p} but it is not executable - the hook will not run.", file=sys.stderr)
            rc = 3
        else:
            print(f"{name}: installed at {p}")
    return rc


def to_sarif(report: dict) -> dict:
    level = {"critical": "error", "high": "error", "medium": "warning", "low": "note", "info": "note"}
    score = {"critical": "9.5", "high": "8.0", "medium": "5.5", "low": "3.0", "info": "1.0"}
    rules, results = {}, []
    for f in report["findings"]:
        if f["state"] == "suppressed":
            continue
        rules.setdefault(f["rule_id"], {"id": f["rule_id"], "name": f["rule_id"], "shortDescription": {"text": f["title"]},
                                        "help": {"text": f["remediation"]},
                                        "properties": {"security-severity": score[f["severity"]], "precision": "high" if f["confidence"] != "potential" else "medium",
                                                       "tags": ["security", f["category"], *f["cwe"]]}})
        results.append({"ruleId": f["rule_id"], "level": level[f["severity"]], "message": {"text": f"{f['title']}: {f['reason']} [{f['confidence']}]"},
                        "partialFingerprints": {"trustcode/v1": f["fingerprint"]},
                        "locations": [{"physicalLocation": {"artifactLocation": {"uri": f["path"]},
                                                            "region": {"startLine": f["line"], "startColumn": f["col"], "endLine": f["end_line"], "endColumn": max(f["end_col"], f["col"])}}}]})
    return {"$schema": "https://json.schemastore.org/sarif-2.1.0.json", "version": "2.1.0",
            "runs": [{"tool": {"driver": {"name": "TrustCode", "informationUri": "https://github.com/malika1234m/trustcode", "version": ENGINE.split()[-1],
                                          "rules": list(rules.values())}}, "results": results,
                      "invocations": [{"executionSuccessful": report["status"] == "complete",
                                       "toolExecutionNotifications": [{"level": "warning", "message": {"text": c["detail"]}} for c in report["checks"] if c["status"] == "failed"]}]}]}


def to_text(report: dict, markdown: bool = False) -> str:
    s, g, b = report["summary"], report["gate"], report["baseline"]
    h = (lambda t: f"\n## {t}\n") if markdown else (lambda t: f"\n{t}\n{'-' * len(t)}")
    out = [("# TrustCode security report" if markdown else "TrustCode security scan"),
           f"Mode: {report['mode']} · status: {report['status'].upper()} · {report['files']['scanned']} file(s) scanned "
           f"({report['files']['from_cache']} from cache) in {report['duration_ms'] / 1000:.1f} s · {report['generated_at']}"]
    if report["status"] != "complete":
        out.append("!! This scan is NOT complete. Missing checks are listed below; the absence of findings means nothing for them.")
    out.append(h("Findings by severity"))
    out.append("  ".join(f"{k}: {v}" for k, v in s["by_severity"].items()) + f"   (files with findings: {s['files_with_findings']})")
    st = s["by_state"]
    out.append(f"New: {st.get('new', 0) + st.get('unclassified', 0)} · existing (in baseline): {st.get('existing', 0)} · reintroduced: {st.get('reintroduced', 0)} · "
               f"reviewed/suppressed: {st.get('suppressed', 0)} · resolved since baseline: {len(b['resolved'])} · not revalidated: {len(b['not_revalidated'])}"
               + ("" if b["present"] else "   (no baseline: every finding is unclassified)"))
    shown = [f for f in report["findings"] if f["state"] != "suppressed"]
    if shown:
        out.append(h("Findings"))
        for f in shown[:200]:
            loc = f"{f['path']}:{f['line']}:{f['col']}" if not f["file_level"] else f"{f['path']} (file-level)"
            out.append(f"[{f['severity'].upper()}] {f['title']}  ({f['rule_id']}, {f['confidence'].replace('_', ' ')}, {f['state']})\n"
                       f"    {loc}\n    {f['reason']}\n    evidence: {f['evidence']}\n    source: {f['source']}")
        if len(shown) > 200:
            out.append(f"... and {len(shown) - 200} more (use --format json for the full list)")
    out.append(h("Checks"))
    for c in report["checks"]:
        out.append(f"[{c['status']}] {c['name']}" + (f" - {c['detail']}" if c["detail"] else ""))
    out.append(h("Coverage"))
    for c in report["coverage"]:
        out.append(f"{c['language']}: {c['files']} file(s) - {c['analysis']}")
    ex = report["files"]["excluded"]
    out.append(h("Excluded files"))
    out.append("\n".join(f"{n} - {reason}" for reason, n in ex.items()) or "none")
    for n in report["notes"]:
        out.append(f"note: {n}")
    out.append(h("Gate decision"))
    out.append(f"{g['decision'].upper()}: " + " ".join(g["reasons"]))
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="trustcode-scan", description=__doc__.splitlines()[0])
    ap.add_argument("command", nargs="?", default="scan", choices=["scan", "baseline", "review", "hooks", "tools", "rules", "config"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--root", default=".")
    ap.add_argument("--mode", default="full", choices=["full", "changed", "new", "staged", "push", "production", "ci"])
    ap.add_argument("--format", default="text", choices=["text", "json", "sarif", "markdown"])
    ap.add_argument("--output", help="write the report to this file instead of standard output")
    ap.add_argument("--online", action="store_true", default=None, help="look pinned dependency versions up in the OSV advisory database (sends names and versions)")
    ap.add_argument("--no-cache", action="store_true", help="ignore and rebuild the incremental cache")
    ap.add_argument("--history", action="store_true", help="also look for credentials on lines added in the last 500 commits")
    ap.add_argument("--paths-from", help="file with one path per line ('-' = standard input): scan exactly these files (mode 'changed')")
    ap.add_argument("--reason", help="why a finding is a false positive (command: review)")
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 3
    if a.command == "tools":
        print(json.dumps(tools_status(), indent=1))
        return 0
    if a.command == "config":
        from .engine import DEFAULT_CONFIG
        print(json.dumps(DEFAULT_CONFIG, indent=2))
        return 0
    if a.command == "rules":
        print(json.dumps(RULES, indent=1))
        return 0
    if a.command == "hooks":
        sub = a.args[0] if a.args else "status"
        if sub == "install":
            return hooks_install(root, [n for n in (a.args[1:] or list(HOOKS)) if n in HOOKS])
        if sub == "print":
            print(hook_script(a.args[1] if len(a.args) > 1 and a.args[1] in HOOKS else "pre-commit"))
            return 0
        print(json.dumps(hooks_status(root), indent=1))
        return 0
    if a.command == "review":
        if not a.args or not a.reason:
            print("usage: trustcode-scan review <fingerprint> --reason \"why this is a false positive\"", file=sys.stderr)
            return 3
        try:
            entry = mark_reviewed(root, a.args[0], a.reason, os.environ.get("GIT_AUTHOR_NAME") or getpass.getuser())
        except ValueError as e:
            print(f"review failed: {e}", file=sys.stderr)
            return 3
        print(json.dumps(entry, indent=1))
        return 0
    paths = None
    if a.paths_from:
        raw = sys.stdin.read() if a.paths_from == "-" else Path(a.paths_from).read_text()
        paths = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    baseline = a.command == "baseline"
    report = scan(root, "full" if baseline else ("changed" if paths is not None else a.mode), paths=paths, use_cache=not a.no_cache and not baseline,
                  online=a.online, update_baseline=baseline, history=a.history)
    text = {"json": lambda: json.dumps(report, indent=1), "sarif": lambda: json.dumps(to_sarif(report), indent=1),
            "markdown": lambda: to_text(report, True), "text": lambda: to_text(report)}[a.format]()
    if a.output:
        Path(a.output).write_text(text + ("" if text.endswith("\n") else "\n"))
    else:
        sys.stdout.write(text + ("" if text.endswith("\n") else "\n"))
    if baseline:
        n = sum(1 for f in report["findings"] if f["state"] != "suppressed")
        print(f"Baseline written to {STATE_DIR}/baseline.json with {n} existing finding(s). They stay visible in every report; only new ones are treated as introduced.", file=sys.stderr)
        return 0 if report["status"] == "complete" else 2
    decision = report["gate"]["decision"]
    if decision == "block":
        print("\nTrustCode BLOCKED this " + {"staged": "commit", "push": "push", "production": "release", "ci": "pipeline"}.get(report["mode"], "operation") + ": "
              + " ".join(report["gate"]["reasons"]) + "\nReview the findings above. To record a reviewed false positive: trustcode-scan review <fingerprint> --reason \"...\"",
              file=sys.stderr)
        return 1 if report["status"] != "failed" and any(report["gate"]["blocking"]) else 2
    if decision == "warn":
        print("\nTrustCode WARNING: " + " ".join(report["gate"]["reasons"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
