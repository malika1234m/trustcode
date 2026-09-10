"""Executes untrusted code + tests inside an isolated Docker container (ADR-003).

Isolation: no network, read-only root FS, noexec tmpfs, all capabilities dropped except
SETUID/SETGID/KILL for the trusted runner, no-new-privileges, untrusted tests as uid 65534, PID/memory/CPU limits, wall-clock timeout with
forced kill, and --rm cleanup. Input is passed on stdin: no host directory is mounted.
If Docker is unavailable the caller reports CHECK_FAILED - code is NEVER executed
on the host as a fallback.
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass

IMAGE = os.environ.get("TRUSTCODE_SANDBOX_IMAGE", "trustcode-sandbox:0.1")
TIMEOUT = int(os.environ.get("TRUSTCODE_SANDBOX_TIMEOUT", "30"))
MAX_OUTPUT = 1_000_000  # bytes read from the sandbox; beyond this the container is killed


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
            "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "KILL",
            "--security-opt", "no-new-privileges", "--user", "0:0",
            "--pids-limit", "64", "--memory", "256m", "--memory-swap", "256m", "--cpus", "1",
            "--ulimit", "fsize=10485760:10485760", "--ulimit", "nofile=256:256",
            "-e", f"TRUSTCODE_RUN_TIMEOUT={max(TIMEOUT - 8, 5)}", IMAGE]


def _read_capped(stream, buf: bytearray, overflow: threading.Event):
    while True:
        chunk = stream.read(65536)
        if not chunk:
            return
        if len(buf) + len(chunk) > MAX_OUTPUT:
            overflow.set()
            return
        buf.extend(chunk)


def run_in_sandbox(language: str, code: str, tests: str) -> SandboxOutcome:
    ok, why = docker_available()
    if not ok:
        return SandboxOutcome(False, error=why)
    name = f"trustcode-{uuid.uuid4().hex[:12]}"
    nonce = secrets.token_hex(16)
    payload = json.dumps({"language": language, "code": code, "tests": tests, "nonce": nonce}).encode()
    p = subprocess.Popen(sandbox_command(name), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err, overflow = bytearray(), bytearray(), threading.Event()
    readers = [threading.Thread(target=_read_capped, args=(p.stdout, out, overflow), daemon=True),
               threading.Thread(target=_read_capped, args=(p.stderr, err, overflow), daemon=True)]
    for t in readers:
        t.start()
    try:
        p.stdin.write(payload)
        p.stdin.close()
    except BrokenPipeError:
        pass
    killed_reason = None
    start = time.monotonic()
    try:
        while p.poll() is None:
            if overflow.is_set():
                killed_reason = f"sandbox output exceeded {MAX_OUTPUT} bytes"
                break
            try:
                p.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass
            if time.monotonic() - start > TIMEOUT:
                killed_reason = f"sandbox exceeded {TIMEOUT}s and was killed"
                break
    finally:
        if killed_reason or overflow.is_set():
            subprocess.run(["docker", "kill", name], capture_output=True, timeout=15)
            p.kill()
            killed_reason = killed_reason or f"sandbox output exceeded {MAX_OUTPUT} bytes"
        p.wait(timeout=15)
        for t in readers:
            t.join(timeout=5)
    if killed_reason:
        return SandboxOutcome(False, error=killed_reason)
    marker = f"TRUSTCODE_RESULT_{nonce}="
    line = next((ln for ln in out.decode(errors="replace").splitlines()[::-1] if ln.startswith(marker)), None)
    if not line:
        hint = "possibly out of memory" if p.returncode == 137 else f"exit code {p.returncode}"
        return SandboxOutcome(False, error=f"sandbox produced no authenticated result ({hint}): {err.decode(errors='replace')[-300:]}")
    try:
        return SandboxOutcome(True, data=json.loads(line[len(marker):]))
    except json.JSONDecodeError:
        return SandboxOutcome(False, error="sandbox result was not valid JSON")

