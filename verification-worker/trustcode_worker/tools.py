"""Helpers for invoking external analysis tools safely.

Static tools (ruff, semgrep, node --check) only *parse* the submitted code; they never
execute it. They still run with a timeout, no shell, and inside a private temp dir.
"""
from __future__ import annotations

import functools
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ToolRun:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


def run(cmd: list[str], cwd: str | None = None, timeout: float = 60, env: dict | None = None) -> ToolRun:
    base_env = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "/tmp"),
                "LANG": "C.UTF-8", "SEMGREP_SEND_METRICS": "off", "SEMGREP_ENABLE_VERSION_CHECK": "0"}
    if env:
        base_env.update(env)
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=base_env, shell=False)
        return ToolRun(p.returncode, p.stdout, p.stderr)
    except subprocess.TimeoutExpired as e:
        return ToolRun(-1, e.stdout or "", e.stderr or "", timed_out=True)
    except FileNotFoundError as e:
        return ToolRun(-2, "", str(e))


def _venv_script(name: str) -> str | None:
    p = Path(sys.executable).parent / name
    return str(p) if p.exists() else None


@functools.lru_cache
def semgrep_cmd() -> list[str] | None:
    """Return the command prefix for semgrep.

    The pip 'semgrep' launcher has a shebang that breaks when the venv path contains
    spaces, so we prefer invoking 'pysemgrep' through the current interpreter (ADR-004).
    """
    if os.environ.get("TRUSTCODE_SEMGREP_CMD"):
        return os.environ["TRUSTCODE_SEMGREP_CMD"].split()
    py = _venv_script("pysemgrep")
    if py:
        return [sys.executable, py]
    exe = shutil.which("semgrep")
    return [exe] if exe else None


@functools.lru_cache
def ruff_cmd() -> list[str] | None:
    exe = _venv_script("ruff") or shutil.which("ruff")
    return [exe] if exe else None


@functools.lru_cache
def node_cmd() -> list[str] | None:
    exe = shutil.which("node")
    return [exe] if exe else None


@functools.lru_cache
def tool_version(name: str) -> str | None:
    cmd = {"semgrep": semgrep_cmd(), "ruff": ruff_cmd(), "node": node_cmd()}.get(name)
    if not cmd:
        return None
    r = run(cmd + ["--version"], timeout=60)
    out = (r.stdout or r.stderr).strip().splitlines()
    return out[-1].strip() if out else None
