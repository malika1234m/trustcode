"""Language detection for submitted snippets (Python, JavaScript, TypeScript).

A declared language (from the editor) wins. Otherwise detection uses parse success first (authoritative),
then lexical cues. Returns the language and a human-readable reason so the UI can show *why* it was chosen.
"""
from __future__ import annotations

import ast
import re

from .models import Language

_JS_CUES = [r"\bfunction\b", r"\bconst\b", r"\blet\b", r"=>", r"\brequire\(", r"module\.exports",
            r"\bconsole\.", r";\s*$", r"\{\s*$", r"===", r"\bexport\s+(default|function|const)"]
_PY_CUES = [r"^\s*def\s+\w+\(.*\)\s*:", r"^\s*import\s+\w+\s*$", r"^\s*from\s+\w+\s+import", r"\bself\b",
            r"\bNone\b", r"\bTrue\b|\bFalse\b", r"^\s*class\s+\w+.*:\s*$", r"\belif\b"]
_TS_CUES = [r"\binterface\s+\w+", r"\btype\s+\w+\s*(<[^>]*>)?\s*=", r"\bdeclare\s+(function|const|class|module|namespace|global)",
            r"\)\s*:\s*[\w<\[{]", r"\b(let|const|var)\s+\w+\s*:\s*\w", r"\bas\s+(const|any|unknown|string|number)\b",
            r"\b(public|private|protected|readonly)\s+\w+", r"\bimplements\s+\w+", r"\benum\s+\w+\s*\{", r"\w+\?:\s*\w"]
_HINTS = {"python": Language.PYTHON, "py": Language.PYTHON,
          "javascript": Language.JAVASCRIPT, "js": Language.JAVASCRIPT, "javascriptreact": Language.JAVASCRIPT,
          "jsx": Language.JAVASCRIPT, "node": Language.JAVASCRIPT,
          "typescript": Language.TYPESCRIPT, "ts": Language.TYPESCRIPT, "typescriptreact": Language.TYPESCRIPT,
          "tsx": Language.TYPESCRIPT}


def _count(cues: list[str], code: str) -> int:
    return sum(len(re.findall(p, code, re.M)) for p in cues)


def _parses(code: str, lang: Language) -> bool:
    from .analyzers.syntax import parse_tree
    tree = parse_tree(code, lang)
    return tree is not None and not tree.root_node.has_error


def detect_language(code: str, hint: str | None = None) -> tuple[Language, str]:
    if hint and hint.lower() in _HINTS:
        return _HINTS[hint.lower()], "declared"
    try:
        ast.parse(code)
        py_parses = True
    except SyntaxError:
        py_parses = False
    js, py, ts = _count(_JS_CUES, code), _count(_PY_CUES, code), _count(_TS_CUES, code)
    if py_parses and py >= js + ts:
        return Language.PYTHON, f"detected: parses as Python (cues py={py}, js={js}, ts={ts})"
    if ts and not _parses(code, Language.JAVASCRIPT) and _parses(code, Language.TYPESCRIPT):
        return Language.TYPESCRIPT, f"detected: valid TypeScript but not JavaScript (ts cues={ts})"
    if js + ts > py:
        return Language.JAVASCRIPT, f"detected: JavaScript cues (js={js}, py={py})"
    return Language.PYTHON, f"detected: defaulted to Python (cues py={py}, js={js}, ts={ts}); low confidence"
