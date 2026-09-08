"""Executes untrusted code + tests inside an isolated Docker container (ADR-003).

Isolation: no network, read-only root FS, noexec tmpfs, all capabilities dropped,
no-new-privileges, non-root UID, PID/memory/CPU limits, wall-clock timeout with
forced kill, and --rm cleanup. Input is passed on stdin: no host directory is mounted.
If Docker is unavailable the caller reports CHECK_FAILED - code is NEVER executed
on the host as a fallback.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass

IMAGE = os.environ.get("TRUSTCODE_SANDBOX_IMAGE", "trustcode-sandbox:0.1")
TIMEOUT = int(os.environ.get("TRUSTCODE_SANDBOX_TIMEOUT", "30"))


@dataclass
class SandboxOutcome:
    ok: bool
    data: dict | None = None
    error: str | None = None


def docker_available() -> tuple[bool, str]:
    exe = shutil.which("docker")
    if not exe:
        return False, "docker CLI not found"
    try:
        r = subprocess.run([exe, "image", "inspect", IMAGE], capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, OSError) as e:
        return False, f"docker unavailable: {e}"
    if r.returncode != 0:
        return False, f"sandbox image {IMAGE} not available (build it: see verification-worker/README.md)"
    return True, "ok"


def sandbox_command(name: str) -> list[str]:
    return ["docker", "run", "--rm", "-i", "--name", name,
            "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534:65534",
            "--pids-limit", "64", "--memory", "256m", "--memory-swap", "256m", "--cpus", "1",
            "--ulimit", "fsize=10485760:10485760", "--ulimit", "nofile=256:256",
            "-e", f"TRUSTCODE_RUN_TIMEOUT={max(TIMEOUT - 8, 5)}", IMAGE]


def run_in_sandbox(language: str, code: str, tests: str) -> SandboxOutcome:
    ok, why = docker_available()
    if not ok:
        return SandboxOutcome(False, error=why)
    name = f"trustcode-{uuid.uuid4().hex[:12]}"
    payload = json.dumps({"language": language, "code": code, "tests": tests})
    try:
        p = subprocess.run(sandbox_command(name), input=payload, capture_output=True, text=True, timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        subprocess.run(["docker", "kill", name], capture_output=True, timeout=15)
        return SandboxOutcome(False, error=f"sandbox exceeded {TIMEOUT}s and was killed")
    line = next((ln for ln in p.stdout.splitlines()[::-1] if ln.startswith("TRUSTCODE_RESULT=")), None)
    if not line:
        hint = "possibly out of memory" if p.returncode == 137 else f"exit code {p.returncode}"
        return SandboxOutcome(False, error=f"sandbox produced no result ({hint}): {p.stderr[-300:]}")
    return SandboxOutcome(True, data=json.loads(line.split("=", 1)[1]))
