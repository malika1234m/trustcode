"""Runs inside the sandbox container. Reads {"language","code","tests"} JSON on stdin,
writes files into the tmpfs, runs the tests, and prints one JSON result line prefixed
with TRUSTCODE_RESULT=. Everything here is untrusted-input handling; no network exists."""
import json
import os
import re
import signal
import subprocess
import sys
import xml.etree.ElementTree as ET  # parses our own junit file only

RUN_TIMEOUT = int(os.environ.get("TRUSTCODE_RUN_TIMEOUT", "20"))


_NONCE = ""  # per-run secret from the host (stdin only); never passed to the code under test


def emit(obj):
    # The host accepts only a line carrying the per-run nonce, so code under test cannot forge
    # a result by writing to this process's stdout (e.g. via /proc/1/fd/1).
    sys.stdout.write(f"TRUSTCODE_RESULT_{_NONCE}=" + json.dumps(obj) + "\n")
    sys.stdout.flush()
    sys.exit(0)


UNTRUSTED_UID = 65534


def _drop_privileges():
    os.setgroups([])
    os.setgid(UNTRUSTED_UID)
    os.setuid(UNTRUSTED_UID)


def run(cmd, env=None):
    """Run untrusted work as uid 65534 in a new session; kill the whole group afterwards."""
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, text=True,
                         cwd="/tmp/w", env={"PATH": os.environ["PATH"], "HOME": "/tmp/w", "PYTHONDONTWRITEBYTECODE": "1",
                                            **(env or {})},
                         preexec_fn=_drop_privileges, start_new_session=True)
    timed_out = False
    try:
        out, err = p.communicate(timeout=RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        timed_out = True
        out, err = "", ""
    finally:
        try:
            os.killpg(p.pid, signal.SIGKILL)  # removes any background processes left by the code under test
        except ProcessLookupError:
            pass
        if timed_out:
            p.communicate()
    return (-1 if timed_out else p.returncode), (out or "")[-20000:], (err or "")[-20000:], timed_out


def python_tests(code, tests):
    open("/tmp/w/solution.py", "w").write(code)
    open("/tmp/w/test_solution.py", "w").write(tests)
    rc, out, err, to = run([sys.executable, "-m", "coverage", "run", "--data-file=/tmp/w/.cov", "--include=/tmp/w/solution.py",
                            "-m", "pytest", "-q", "-p", "no:cacheprovider", "--junitxml=/tmp/w/junit.xml",
                            "/tmp/w/test_solution.py"], env={"PYTHONPATH": "/tmp/w"})
    if to:
        emit({"status": "timeout", "output": out})
    results = []
    try:
        root = ET.parse("/tmp/w/junit.xml").getroot()
        for tc in root.iter("testcase"):
            outcome, msg = "passed", None
            for tag in ("failure", "error", "skipped"):
                el = tc.find(tag)
                if el is not None:
                    outcome = {"failure": "failed", "error": "error", "skipped": "skipped"}[tag]
                    msg = ((el.get("message") or "") + "\n" + (el.text or ""))[-1500:]
            results.append({"name": tc.get("name"), "outcome": outcome, "message": msg})
    except (OSError, ET.ParseError):
        emit({"status": "error", "output": (out + err)[-3000:], "tests": []})
    executed = None
    rc2, _, _, _ = run([sys.executable, "-m", "coverage", "json", "--data-file=/tmp/w/.cov", "-o", "/tmp/w/cov.json"])
    if rc2 == 0 and os.path.exists("/tmp/w/cov.json"):
        files = json.load(open("/tmp/w/cov.json")).get("files", {})
        f = next(iter(files.values()), None)
        if f:
            executed = {"executed": f["executed_lines"], "missing": f["missing_lines"]}
    emit({"status": "ok", "tests": results, "coverage": executed, "output": (out + err)[-3000:]})


TAP_LINE = re.compile(r"^(\s*)(not ok|ok) \d+ - (.+?)(\s+#\s*(SKIP|TODO).*)?$")


def js_tests(code, tests):
    open("/tmp/w/solution.js", "w").write(code)
    open("/tmp/w/test_solution.js", "w").write(tests)
    rc, out, err, to = run(["node", "--test", "--test-reporter=tap", "/tmp/w/test_solution.js"])
    if to:
        emit({"status": "timeout", "output": out})
    results, lines = [], out.splitlines()
    for i, ln in enumerate(lines):
        m = TAP_LINE.match(ln)
        if not m or m.group(3).strip().endswith("test_solution.js"):
            continue
        # skip suite summary lines that have nested children (indent deeper lines before)
        outcome = "skipped" if m.group(5) else ("passed" if m.group(2) == "ok" else "failed")
        msg = None
        if outcome == "failed":
            block = "\n".join(lines[i + 1:i + 25])
            em = re.search(r"error: \|?-?\s*\n?\s*(.+)", block)
            msg = (em.group(1).strip() if em else block)[:1500]
        results.append({"name": m.group(3).strip(), "outcome": outcome, "message": msg, "depth": len(m.group(1))})
    if not results and rc != 0:
        emit({"status": "error", "output": (out + err)[-3000:], "tests": []})
    emit({"status": "ok", "tests": results, "coverage": None, "output": (out + err)[-3000:]})


def main():
    global _NONCE
    req = json.loads(sys.stdin.read(5_000_000))
    _NONCE = req.pop("nonce")
    os.makedirs("/tmp/w", exist_ok=True)
    os.chmod("/tmp/w", 0o777)
    if req["language"] == "python":
        python_tests(req["code"], req["tests"])
    else:
        js_tests(req["code"], req["tests"])


if __name__ == "__main__":
    main()
