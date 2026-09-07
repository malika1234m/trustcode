"""Language detection for submitted snippets (Python vs JavaScript).

Uses parse success first (authoritative), then lexical cues. Returns the language
and a human-readable reason so the UI can show *why* a language was chosen.
"""
from __future__ import annotations

import ast
import re

from .models import Language

_JS_CUES = [r"\bfunction\b", r"\bconst\b", r"\blet\b", r"=>", r"\brequire\(", r"module\.exports",
            r"\bconsole\.", r";\s*$", r"\{\s*$", r"===", r"\bexport\s+(default|function|const)"]
_PY_CUES = [r"^\s*def\s+\w+\(.*\)\s*:", r"^\s*import\s+\w+", r"^\s*from\s+\w+\s+import", r"\bself\b",
            r"\bNone\b", r"\bTrue\b|\bFalse\b", r"^\s*class\s+\w+.*:\s*$", r"\belif\b"]


def detect_language(code: str, hint: str | None = None) -> tuple[Language, str]:
    if hint:
        h = hint.lower()
        if h in ("python", "py"):
            return Language.PYTHON, "declared"
        if h in ("javascript", "js", "javascriptreact", "node"):
            return Language.JAVASCRIPT, "declared"
    py_parses = True
    try:
        ast.parse(code)
    except SyntaxError:
        py_parses = False
    js_score = sum(len(re.findall(p, code, re.M)) for p in _JS_CUES)
    py_score = sum(len(re.findall(p, code, re.M)) for p in _PY_CUES)
    if py_parses and py_score >= js_score:
        return Language.PYTHON, f"detected: parses as Python (cues py={py_score}, js={js_score})"
    if js_score > py_score:
        return Language.JAVASCRIPT, f"detected: JavaScript cues (js={js_score}, py={py_score})"
    return Language.PYTHON, f"detected: defaulted to Python (cues py={py_score}, js={js_score}); low confidence"
