"""Text, credential and configuration rules of the project scanner (parse only; nothing is executed).

Every function yields raw findings: (rule_id, line, col, end_line, end_col, evidence, reason, extra) with
1-based lines and columns. Secret values never appear in `evidence`: they are masked.
"""
from __future__ import annotations

import json
import math
import posixpath
import re
from typing import Iterator

Raw = tuple  # (rule_id, line, col, end_line, end_col, evidence, reason, extra dict)

PROVIDER_TOKENS: list[tuple[str, str, re.Pattern]] = [
    ("aws-access-key-id", "AWS access key ID", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github-token", "GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b")),
    ("gitlab-token", "GitLab token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b")),
    ("slack-token", "Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("stripe-live-key", "Stripe live key", re.compile(r"\b[sr]k_live_[0-9A-Za-z]{20,}\b")),
    ("google-api-key", "Google / Firebase API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("anthropic-api-key", "Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("openai-api-key", "OpenAI API key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]*T3BlbkFJ[A-Za-z0-9_-]{10,}\b")),
    ("sendgrid-api-key", "SendGrid API key", re.compile(r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b")),
    ("npm-token", "npm access token", re.compile(r"\bnpm_[A-Za-z0-9]{36}\b")),
    ("google-oauth-client-secret", "Google OAuth client secret", re.compile(r"\bGOCSPX-[A-Za-z0-9_-]{28}\b")),
    ("mailgun-api-key", "Mailgun API key", re.compile(r"\bkey-[0-9a-f]{32}\b")),
    ("twilio-api-key", "Twilio API key", re.compile(r"\bSK[0-9a-f]{32}\b")),
    ("azure-storage-key", "Azure storage account key", re.compile(r"AccountKey=[A-Za-z0-9+/]{60,}={0,2}")),
]
PRIVATE_KEY = re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----")
URL_CREDS = re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/:@'\"]+:([^\s/@'\"{}$<>%]{3,})@[^\s'\"]+")
PLACEHOLDER = re.compile(r"(?i)(example|placeholder|changeme|change[-_]me|your[-_ ]?\w*|x{4,}|\*{3,}|<[^>]+>|\$\{[^}]*\}|\{\{[^}]*\}\}|dummy|redacted|todo|"
                         r"user:pass(word)?@|insert[-_ ]|replace[-_ ]|sample|fake|test[-_]?key|not[-_]?set|none|null|undefined)")
SECRET_NAME = re.compile(r"(?i)(pass(word|wd)?|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|auth[-_]?key|access[-_]?key|credential|signing[-_]?key|smtp[-_]?pass)")
GENERIC_ASSIGN = re.compile(r"""(?ix)\b([A-Za-z_][\w.-]*)\s*[:=]\s*(['"])([^'"\n]{8,200})\2""")
WEAK_PASSWORDS = {"admin", "password", "passw0rd", "123456", "12345678", "root", "secret", "admin123", "letmein", "qwerty", "default", "changeit", "toor"}
PUBLIC_PREFIX = re.compile(r"^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)\w*(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|PASSWD)\w*$")
HIDDEN_UNICODE = re.compile("[​-‏‪-‮⁠-⁤⁦-⁩\U000e0000-\U000e007f]|(?<!^)﻿")
AGENT_INSTRUCTIONS = re.compile(r"(?i)(^|/)(\.cursorrules|\.windsurfrules|claude\.md|agents\.md|gemini\.md|\.clinerules|copilot-instructions\.md)$|(^|/)\.cursor/rules/")
AGENT_FLAGS = re.compile(r"--dangerously-skip-permissions|--yolo\b|--trust-all-tools|--dangerously-bypass-approvals-and-sandbox|--full-auto\b")
TLS_OFF = re.compile(r"NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['\"]?0|\bcurl\b[^\n|;]*\s(-k|--insecure)\b|http\.sslVerify\s+false|GIT_SSL_NO_VERIFY\s*=\s*(1|true)|"
                     r"--trusted-host\b|strict-ssl\s*[=:]?\s*false|InsecureSkipVerify:\s*true|ssl\._create_unverified_context")
SUPPRESSION = re.compile(r"#\s*nosec\b|\bnosemgrep\b|gitleaks:allow|pragma:\s*allowlist secret|#\s*trivy:ignore|#checkov:skip=|//\s*NOSONAR|zizmor:\s*ignore")
DESTRUCTIVE = re.compile(r"\brm\s+-[A-Za-z]*r[A-Za-z]*f?[A-Za-z]*\s+(-[A-Za-z-]+\s+)*(/(\s|\*|$)|~/?(\s|\*|$)|\$HOME/?(\s|\*|$)|\$\{?[A-Za-z_]+\}?/(\s|\*|$))|"
                         r"\bgit\s+push\b[^\n]*\s(--force\b|-f\b)|\bterraform\s+destroy\b[^\n]*-auto-approve|\bkubectl\s+delete\s+(ns|namespace)\b|\bDROP\s+DATABASE\b")
RLS = re.compile(r"(?i)DISABLE\s+ROW\s+LEVEL\s+SECURITY|(USING|WITH\s+CHECK)\s*\(\s*true\s*\)")
ENV_FILE = re.compile(r"(^|/)\.env(\.[\w.-]+)?$")
ENV_TEMPLATE = re.compile(r"(?i)\.(example|sample|template|dist|defaults?)$")
SCRIPT_LIKE = re.compile(r"(?i)(\.(sh|bash|zsh|ps1|ya?ml)$|(^|/)(makefile|dockerfile[^/]*|package\.json|justfile)$)")
GH_UNTRUSTED = re.compile(r"\$\{\{\s*(github\.event\.(issue|pull_request|comment|review|head_commit|discussion)\.[\w.]*(title|body|message|name|ref|label|email)[\w.]*|github\.head_ref)\s*\}\}")


DEDICATED_SECRET = re.compile(r"(?i)(smtp|mail|email)[\w.-]*pass|client[-_]?secret|oauth[\w.-]*secret")


def entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = {c: s.count(c) for c in set(s)}
    return -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())


def mask(line: str, start: int, end: int) -> str:
    value = line[start:end]
    keep = min(6, max(2, len(value) // 5))
    return (line[:start] + value[:keep] + "…[masked]" + line[end:]).strip()[:200]


def _is_placeholder(value: str) -> bool:
    v = value.strip()
    return not v or bool(PLACEHOLDER.search(v)) or len(set(v)) <= 2


def secrets(path: str, text: str) -> Iterator[Raw]:
    """Provider-format credentials, private keys, credentials in URLs and name+entropy secrets."""
    is_env = bool(ENV_FILE.search(path))
    for i, line in enumerate(text.splitlines(), 1):
        if len(line) > 4000:
            continue
        hit = False
        for rule, title, pat in PROVIDER_TOKENS:
            m = pat.search(line)
            if m and not _is_placeholder(m.group(0)):
                yield ("TC-SEC-001", i, m.start() + 1, i, m.end() + 1, mask(line, m.start(), m.end()),
                       f"Text in the format of a {title}.", {"detector": rule})
                hit = True
                break
        if hit:
            continue
        m = PRIVATE_KEY.search(line)
        if m:
            yield ("TC-SEC-002", i, m.start() + 1, i, m.end() + 1, line[:m.end()].strip()[:80] + " …[masked]", "A private key block starts here.", {"detector": "private-key"})
            continue
        if '"private_key"' in line and "PRIVATE KEY" in line:
            yield ("TC-SEC-002", i, 1, i, len(line) + 1, '"private_key": …[masked]', "Service-account key material.", {"detector": "service-account"})
            continue
        m = URL_CREDS.search(line)
        if m and not _is_placeholder(m.group(1)) and not _is_placeholder(m.group(0)):
            yield ("TC-SEC-005", i, m.start(1) + 1, i, m.end(1) + 1, mask(line, m.start(1), m.end(1)), "A password is embedded in a connection URL.", {"detector": "url-credentials"})
            continue
        if is_env:
            continue  # env files are judged as a whole by env_file()
        for m in GENERIC_ASSIGN.finditer(line):
            name, value = m.group(1), m.group(3)
            if not SECRET_NAME.search(name) or _is_placeholder(value) or " " in value.strip():
                continue
            if re.search(r"(?i)(env|getenv|process\.|config\[|settings\.|\$\(|os\.)", value) or value.startswith(("http://", "https://", "/", "./")):
                continue
            dedicated = DEDICATED_SECRET.search(name)
            if dedicated and value.lower() not in WEAK_PASSWORDS and len(value) >= 6:
                kind = "smtp-password" if re.search(r"(?i)smtp|mail", name) else "oauth-client-secret"
                yield ("TC-SEC-004", i, m.start(3) + 1, i, m.end(3) + 1, mask(line, m.start(3), m.end(3)),
                       f"`{name}` holds a literal {'mail server password' if kind == 'smtp-password' else 'OAuth client secret'}.", {"detector": kind, "confidence": "strongly_suspected"})
                continue
            if value.lower() in WEAK_PASSWORDS:
                yield ("TC-ENV-006", i, m.start(3) + 1, i, m.end(3) + 1, mask(line, m.start(3), m.end(3)), f"`{name}` is set to a default or trivial password.", {"detector": "weak-password"})
            elif entropy(value) >= 3.5 and len(value) >= 12:
                yield ("TC-SEC-004", i, m.start(3) + 1, i, m.end(3) + 1, mask(line, m.start(3), m.end(3)),
                       f"`{name}` is assigned a high-entropy literal.", {"detector": "generic-secret"})


def env_file(path: str, text: str, git_state: str) -> Iterator[Raw]:
    """`git_state`: tracked | untracked (would be added by `git add`) | ignored | no-git."""
    template = bool(ENV_TEMPLATE.search(path))
    real: list[int] = []
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not m or line.lstrip().startswith("#"):
            continue
        key, value = m.group(1), m.group(2).split(" #")[0].strip().strip("'\"")
        col, end = m.start(2) + 1, len(line) + 1
        if PUBLIC_PREFIX.match(key) and not _is_placeholder(value):
            yield ("TC-ENV-003", i, 1, i, len(key) + 1, f"{key}=…[masked]", "A secret-named variable has a prefix that ships its value to the browser.", {})
        if not SECRET_NAME.search(key) or _is_placeholder(value):
            continue
        if value.lower() in WEAK_PASSWORDS:
            yield ("TC-ENV-006", i, col, i, end, f"{key}=…[masked]", f"`{key}` is a default or trivial password.", {})
        if len(value) >= 8:
            real.append(i)
            if template:
                yield ("TC-SEC-004", i, col, i, end, f"{key}=…[masked]", "A template environment file contains a real-looking value instead of a placeholder.", {})
    if real and not template and git_state in ("tracked", "untracked", "no-git"):
        why = {"tracked": "is tracked by Git", "untracked": "is not ignored by Git and would be committed by `git add`",
               "no-git": "is in a project without Git ignore rules"}[git_state]
        yield ("TC-ENV-001", real[0], 1, real[0], 1, f"{posixpath.basename(path)}: {len(real)} secret-like value(s) …[masked]",
               f"This environment file holds real-looking values and {why}.",
               {"file_level": True, "confidence": "strongly_suspected" if git_state != "no-git" else "potential"})


def text_rules(path: str, text: str) -> Iterator[Raw]:
    low = path.lower()
    base = posixpath.basename(low)
    agent_file = bool(AGENT_INSTRUCTIONS.search(path))
    script = bool(SCRIPT_LIKE.search(path))
    sql = low.endswith(".sql")
    settings_py = base.startswith("settings") and low.endswith(".py")
    for i, line in enumerate(text.splitlines(), 1):
        if len(line) > 4000:
            continue
        m = HIDDEN_UNICODE.search(line)
        if m:
            yield ("TC-AGT-004", i, m.start() + 1, i, m.end() + 1, f"U+{ord(m.group(0)[0]):04X} at column {m.start() + 1}",
                   "An invisible Unicode character is present" + (" in an agent instruction file." if agent_file else "."),
                   {"severity": "critical" if agent_file else "medium"})
        if not low.endswith((".md", ".mdx", ".rst", ".txt")):
            m = AGENT_FLAGS.search(line)
            if m and script:
                yield ("TC-AGT-005", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "A coding agent is invoked with its permission checks disabled.", {})
            m = TLS_OFF.search(line)
            if m:
                yield ("TC-REG-002", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "TLS certificate verification is switched off.", {})
            m = SUPPRESSION.search(line)
            if m:
                yield ("TC-REG-004", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "An inline marker tells a security tool to ignore this line.", {})
        if script:
            m = DESTRUCTIVE.search(line)
            if m and not line.lstrip().startswith("#"):
                yield ("TC-DESTR-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "A destructive command with a broad or variable target.", {})
        if sql:
            m = RLS.search(line)
            if m:
                yield ("TC-DB-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "Row-level security is disabled or the policy allows every row.", {})
        if settings_py:
            m = re.match(r"\s*DEBUG\s*=\s*True\b", line) or re.search(r"ALLOWED_HOSTS\s*=\s*\[\s*['\"]\*['\"]\s*\]", line)
            if m:
                yield ("TC-ENV-005", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "Debug mode or a wildcard host is enabled in a settings file.", {})


def _find_line(text: str, needle: str, start: int = 0) -> tuple[int, int]:
    idx = text.find(needle, start)
    if idx < 0:
        return 1, 1
    line = text.count("\n", 0, idx) + 1
    return line, idx - (text.rfind("\n", 0, idx) + 1) + 1


def json_config(path: str, text: str) -> Iterator[Raw]:
    """Agent configuration and package manifests (JSON parse; a file that does not parse is reported by the caller)."""
    low = path.lower()
    base = posixpath.basename(low)
    try:
        data = json.loads(re.sub(r"^\s*//.*$", "", text, flags=re.M)) if text.strip() else None
    except Exception:
        return
    if not isinstance(data, dict):
        return

    def at(needle: str) -> tuple[int, int, int, int]:
        ln, col = _find_line(text, needle)
        return ln, col, ln, col + len(needle)

    if base == "package.json":
        for name, cmd in (data.get("scripts") or {}).items():
            if name in ("preinstall", "install", "postinstall", "prepare") and isinstance(cmd, str) and re.search(r"\bcurl\b|\bwget\b|node\s+-e|base64|npm\s+i(nstall)?\s+-g|\|\s*(ba)?sh\b", cmd):
                yield ("TC-DEP-003", *at(f'"{name}"'), f'"{name}": "{cmd[:120]}"', f"The `{name}` script downloads or executes code when the package is installed.", {})
    agent_cfg = bool(re.search(r"(^|/)(\.vscode/(settings|tasks|mcp)\.json|\.claude/settings(\.local)?\.json|\.cursor/(mcp|hooks)\.json|\.mcp\.json|\.gemini/settings\.json|"
                               r"\.codex/hooks\.json|\.windsurf/hooks\.json|\.roo/mcp\.json)$", low)) or low.endswith(".code-workspace")
    if not agent_cfg:
        return
    flat = json.dumps(data)
    for key in ("chat.tools.autoApprove", "enableAllProjectMcpServers", "chat.tools.global.autoApprove"):
        if re.search(rf'"{re.escape(key)}":\s*true', flat):
            yield ("TC-AGT-001", *at(key), f'"{key}": true', "The coding agent may run tools without asking.", {})
    allow = ((data.get("permissions") or {}).get("allow") or []) if isinstance(data.get("permissions"), dict) else []
    for entry in allow if isinstance(allow, list) else []:
        if isinstance(entry, str) and re.fullmatch(r"(Bash|Shell|Execute)(\(\*?\))?|\*", entry.strip()):
            yield ("TC-AGT-001", *at(entry), f'allow: "{entry}"', "Every shell command is pre-approved for the agent.", {})
    servers = data.get("mcpServers") or data.get("servers") or {}
    if isinstance(servers, dict) and ("mcp" in low or "mcpServers" in data):
        for name, cfg in servers.items():
            if isinstance(cfg, dict) and (cfg.get("command") or cfg.get("url")):
                shown = f'{name}: {str(cfg.get("command") or cfg.get("url"))[:80]} {" ".join(map(str, cfg.get("args") or []))[:80]}'.strip()
                risky = bool(re.search(r"curl|wget|\|\s*(ba)?sh|base64|bash\s+-c|powershell", json.dumps(cfg)))
                yield ("TC-AGT-002", *at(f'"{name}"'), shown, "An MCP server is started with this command whenever the agent runs.",
                       {"severity": "critical" if risky else "high", "confidence": "strongly_suspected" if risky else "potential"})
    hooks = data.get("hooks")
    if isinstance(hooks, dict):
        for event, cfg in hooks.items():
            for cmd in re.findall(r'"command":\s*"((?:[^"\\]|\\.)*)"', json.dumps(cfg)):
                if "agent-signal.json" in cmd and ".trustcode" in cmd:
                    continue  # TrustCode's own completion signal hook
                yield ("TC-AGT-003", *at(event), f"{event}: {cmd[:120]}", "A shell command runs automatically on this agent event.", {})
    for task in data.get("tasks") or []:
        if isinstance(task, dict) and (task.get("runOptions") or {}).get("runOn") == "folderOpen":
            yield ("TC-AGT-003", *at("folderOpen"), f'{task.get("label", "task")}: {str(task.get("command", ""))[:100]}', "A task runs as soon as the folder is opened.", {})


def workflow(path: str, text: str) -> Iterator[Raw]:
    """GitHub Actions workflows (line model: triggers, checkout refs, run blocks)."""
    if not re.search(r"(^|/)\.github/workflows/[^/]+\.ya?ml$", path.lower()):
        return
    lines = text.splitlines()
    privileged = bool(re.search(r"(?m)^\s*(on:\s*\[?[^\n]*\b|-\s*|\s+)(pull_request_target|workflow_run)\b", text))
    run_indent = None
    for i, line in enumerate(lines, 1):
        indent = len(line) - len(line.lstrip())
        if privileged:
            m = re.search(r"ref:\s*.*(github\.event\.pull_request\.head\.(sha|ref)|refs/pull/)", line)
            if m:
                yield ("TC-CICD-001", i, m.start() + 1, i, len(line) + 1, line.strip()[:160],
                       "A workflow with access to secrets checks out code from the pull request.", {})
        m = re.match(r"\s*(-\s*)?run:\s*(.*)$", line)
        if m:
            run_indent = indent if m.group(2).strip() in ("|", ">", "|-", ">-", "") else None
            body = m.group(2)
        elif run_indent is not None and (indent > run_indent or not line.strip()):
            body = line
        else:
            run_indent, body = None, ""
        g = GH_UNTRUSTED.search(body) if body else None
        if g:
            col = line.find(g.group(0)) + 1
            yield ("TC-CICD-002", i, col, i, col + len(g.group(0)), line.strip()[:160],
                   "Attacker-controllable event data is pasted into a shell script.", {"severity": "critical" if privileged else "high"})


def container(path: str, text: str) -> Iterator[Raw]:
    base = posixpath.basename(path.lower())
    docker = base.startswith("dockerfile") or base.endswith(".dockerfile")
    compose = bool(re.match(r"(docker-)?compose[\w.-]*\.ya?ml$", base))
    if not docker and not compose:
        return
    lines = text.splitlines()
    if docker and any(re.match(r"\s*FROM\s", ln, re.I) for ln in lines) and not any(re.match(r"\s*USER\s+(?!root\b|0\b)\S", ln, re.I) for ln in lines):
        n = next(i for i, ln in enumerate(lines, 1) if re.match(r"\s*FROM\s", ln, re.I))
        yield ("TC-DOCKER-001", n, 1, n, 1, "no non-root USER instruction", "The image runs as root because no unprivileged USER is set.", {"severity": "low", "confidence": "potential", "file_level": True})
    for i, line in enumerate(lines, 1):
        if docker:
            m = re.search(r"\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b", line)
            if m:
                yield ("TC-DOCKER-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "A download is piped straight into a shell during the image build.", {})
            m = re.match(r"\s*ADD\s+https?://\S+", line, re.I) or re.search(r"\bchmod\s+(-R\s+)?0?777\b", line) or re.search(r"--privileged\b", line)
            if m:
                yield ("TC-DOCKER-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "Unverified remote content, world-writable permissions or privileged mode in the image build.", {"severity": "low", "confidence": "potential"})
            m = re.match(r"\s*(ENV|ARG)\s+(\w*(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)\w*)[=\s]+(\S+)", line, re.I)
            if m and not _is_placeholder(m.group(4)) and not m.group(4).startswith("$") and len(m.group(4).strip('"\'')) >= 6:
                yield ("TC-SEC-004", i, m.start(4) + 1, i, m.end(4) + 1, mask(line, m.start(4), m.end(4)), f"`{m.group(2)}` is baked into the image as a build argument or environment value.",
                       {"detector": "docker-secret", "confidence": "strongly_suspected"})
        if compose:
            m = re.search(r"privileged:\s*true", line)
            if m:
                yield ("TC-DOCKER-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "The container runs in privileged mode.", {})
            m = re.search(r"""['"]?(?:0\.0\.0\.0:)?(5432|3306|27017|6379|1433|9200):\d+['"]?""", line)
            if m and "127.0.0.1" not in line:
                yield ("TC-DOCKER-002", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "A database port is published on every network interface.", {})


def infrastructure(path: str, text: str) -> Iterator[Raw]:
    """Kubernetes manifests and IAM policy documents (line rules on files that are clearly of that kind)."""
    low = path.lower()
    if low.endswith((".yml", ".yaml")) and re.search(r"(?m)^apiVersion:", text) and re.search(r"(?m)^kind:", text):
        for i, line in enumerate(text.splitlines(), 1):
            m = re.search(r"\b(privileged:\s*true|hostNetwork:\s*true|hostPID:\s*true|allowPrivilegeEscalation:\s*true|runAsUser:\s*0\b)", line)
            if m:
                yield ("TC-K8S-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "The workload is given host-level or root privileges.", {})
    if low.endswith((".json", ".tf", ".yml", ".yaml")) and re.search(r"""["']?Resource["']?\s*[:=]\s*\[?\s*["']\*["']""", text):
        for i, line in enumerate(text.splitlines(), 1):
            m = re.search(r"""["']?Action["']?\s*[:=]\s*\[?\s*["']\*["']""", line)
            if m:
                yield ("TC-IAM-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "The policy grants every action, and the same document grants every resource.", {})


GUARD = re.compile(r"@login_required|@permission_required|@jwt_required|@requires_auth|Depends\(\s*get_current_user|@PreAuthorize|@Secured|@RolesAllowed|"
                   r"\[Authorize|@UseGuards|\brequireAuth\b|\bisAuthenticated\b|\bensureLoggedIn\b|\bauthenticate\(|\bverifyToken\b|\bauthMiddleware\b")
OPEN_ACCESS = re.compile(r"\bAllowAny\b|@PermitAll|\[AllowAnonymous\]|\bauth:\s*false\b|@csrf_exempt")
TEST_SKIP = re.compile(r"\b(it|test|describe)\.(skip|only)\(|\bx(it|describe)\(|@pytest\.mark\.(skip|xfail)|@unittest\.skip|@Disabled\b|\bt\.Skip\(|--passWithNoTests")
TEST_PATH = re.compile(r"(?i)(^|/)(tests?|__tests__|spec)/|(^|/)test_[^/]+\.py$|_test\.(py|go)$|\.(test|spec)\.[cm]?[jt]sx?$")
IGNORE_SECRET = re.compile(r"\.env|\.pem|\.key\b|tfstate|secrets?|id_rsa|credentials")
CI_SCANNER = re.compile(r"codeql-action|trivy-action|semgrep|dependency-review-action|gitleaks|trustcode-scan|snyk|bandit")


def regressions(diff_text: str) -> Iterator[tuple[str, str, int, str, str, dict]]:
    """Weakened security controls in a unified diff (`git diff -U0`): (rule, path, line, evidence, reason, extra).
    A removed guard is not reported when the same hunk adds one back (a guard that was only reworded or moved)."""
    path = old_path = ""
    hunk_line = 1
    removed: list[str] = []
    added: list[str] = []

    def flush() -> Iterator[tuple]:
        if not path and not old_path:
            return
        p = path or old_path
        low = p.lower()
        add_text = "\n".join(added)
        for ln in removed:
            if GUARD.search(ln) and not GUARD.search(add_text):
                yield ("TC-REG-001", p, hunk_line, "removed: " + ln.strip()[:150], "An authentication or authorization guard was removed in this change.", {})
            if low.endswith(".gitignore") and IGNORE_SECRET.search(ln) and ln.strip() not in add_text:
                yield ("TC-REG-005", p, hunk_line, "removed: " + ln.strip()[:150], "An ignore rule that keeps secret files out of Git was removed.", {})
            if "/workflows/" in low and CI_SCANNER.search(ln) and not CI_SCANNER.search(add_text):
                yield ("TC-REG-008", p, hunk_line, "removed: " + ln.strip()[:150], "A security scanning step was removed from the pipeline.", {})
        for i, ln in enumerate(added):
            if OPEN_ACCESS.search(ln):
                yield ("TC-REG-001", p, hunk_line + i, ln.strip()[:150], "Access was opened to unauthenticated callers in this change.", {"confidence": "potential"})
            if TEST_PATH.search(p) and TEST_SKIP.search(ln):
                yield ("TC-REG-003", p, hunk_line + i, ln.strip()[:150], "A test was skipped or narrowed in this change.", {})
            if low.endswith(".gitignore") and re.match(r"\s*!\s*\.env(\s|$)", ln):
                yield ("TC-REG-005", p, hunk_line + i, ln.strip()[:150], "An environment file was explicitly un-ignored.", {})
            if "/workflows/" in low and re.search(r"continue-on-error:\s*true|\bif:\s*false\b|\|\|\s*true\b", ln):
                yield ("TC-REG-008", p, hunk_line + i, ln.strip()[:150], "A pipeline step was made unable to fail the build.", {"confidence": "potential", "severity": "medium"})

    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            pm = re.search(r" b/(\.trustcode/(config|reviewed|baseline)\.json)$", line)
            if pm:
                yield ("TC-REG-009", pm.group(1), 1, f"changed: {pm.group(1)}", "The file that controls what the security gate reports or blocks was changed.", {"file_level": True, "policy": True})
            yield from flush()
            path = old_path = ""
            removed, added = [], []
        elif line.startswith("--- "):
            old_path = line[6:] if line.startswith("--- a/") else ""
        elif line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else ""
            if not path and old_path and TEST_PATH.search(old_path):
                yield ("TC-REG-003", old_path, 1, f"deleted: {old_path}", "A test file was deleted in this change.", {"file_level": True, "confidence": "potential"})
        elif line.startswith("@@"):
            yield from flush()
            removed, added = [], []
            m = re.search(r"\+(\d+)", line)
            hunk_line = max(1, int(m.group(1))) if m else 1
        elif line.startswith("-") and not line.startswith("---"):
            removed.append(line[1:])
        elif line.startswith("+") and not line.startswith("+++"):
            added.append(line[1:])
    yield from flush()


HTTP_URL = re.compile(r"""['"](http://[A-Za-z0-9.-]+(?::\d+)?[^'"\s]*)['"]""")
HTTP_OK = re.compile(r"(?i)^http://(localhost|127\.|0\.0\.0\.0|\[?::1|[\w.-]*\.(local|test|internal|example)(/|:|$)|example\.|www\.w3\.org|schemas\.|xmlns|json-schema\.org|"
                     r"maven\.apache\.org|(xml\.|www\.)?apache\.org/xml|xml\.org/sax|javax\.xml|java\.sun\.com|purl\.org|ns\.adobe\.com|docbook\.org|www\.apache\.org/licenses|169\.254\.)")


def network(path: str, text: str) -> Iterator[Raw]:
    """Plain-HTTP endpoints in code and configuration, and publicly open cloud resources in Terraform."""
    low = path.lower()
    if low.endswith((".py", ".js", ".jsx", ".ts", ".tsx", ".php", ".java", ".json", ".yml", ".yaml", ".toml", ".env", ".properties")) or ENV_FILE.search(path):
        if not low.endswith(("package-lock.json", ".lock")):
            for i, line in enumerate(text.splitlines(), 1):
                if len(line) > 2000:
                    continue
                m = HTTP_URL.search(line)
                if m and not HTTP_OK.search(m.group(1)):
                    yield ("TC-NET-001", i, m.start(1) + 1, i, m.end(1) + 1, line.strip()[:160], "Traffic to this address is not encrypted.", {})
    if low.endswith((".tf", ".tf.json")):
        for i, line in enumerate(text.splitlines(), 1):
            m = re.search(r"""acl\s*=\s*"public-read(-write)?"|cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0/0"\s*\]|publicly_accessible\s*=\s*true""", line)
            if m and not re.search(r"(?i)egress", "\n".join(text.splitlines()[max(0, i - 6):i])):
                yield ("TC-CLOUD-001", i, m.start() + 1, i, m.end() + 1, line.strip()[:160], "The resource is readable or reachable from the whole internet.", {})


def redact(line: str) -> str:
    """Masks anything credential-like in a source line before it is shown as evidence."""
    for _rule, _title, pat in PROVIDER_TOKENS:
        line = pat.sub(lambda m: m.group(0)[:4] + "…[masked]", line)
    line = URL_CREDS.sub(lambda m: m.group(0).replace(m.group(1), "…[masked]"), line)
    def hide(m):
        return m.group(0) if not SECRET_NAME.search(m.group(1)) or _is_placeholder(m.group(3)) else m.group(0).replace(m.group(3), m.group(3)[:2] + "…[masked]")
    line = GENERIC_ASSIGN.sub(hide, line)
    # unquoted KEY=value (environment files, Docker ENV, shell exports)
    return re.sub(r"(?i)^(\s*(?:export\s+|ENV\s+|ARG\s+)?\w*(?:SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL)\w*\s*[=:]\s*)(?!…)(\S{4})\S+", r"\1\2…[masked]", line)


def history_secrets(log_text: str, limit: int = 200) -> Iterator[tuple[str, str, str, str]]:
    """(commit, path, detector, masked line) for provider-format credentials on lines ADDED in `git log -p` output."""
    commit = path = ""
    seen = set()
    for line in log_text.splitlines():
        if line.startswith("commit "):
            commit = line[7:15]
        elif line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("+") and not line.startswith("+++") and len(line) < 4000:
            body = line[1:]
            for rule, _title, pat in PROVIDER_TOKENS:
                m = pat.search(body)
                if m and not _is_placeholder(m.group(0)):
                    key = (path, rule, m.group(0))
                    if key not in seen:
                        seen.add(key)
                        yield (commit, path, rule, mask(body, m.start(), m.end()))
                    break
            else:
                if PRIVATE_KEY.search(body) and (path, "private-key") not in seen:
                    seen.add((path, "private-key"))
                    yield (commit, path, "private-key", "-----BEGIN … PRIVATE KEY----- …[masked]")
            if len(seen) >= limit:
                return


def lockfile_packages(path: str, text: str) -> list[tuple[str, str, str]]:
    """(ecosystem, name, exact version) from lockfiles and pinned requirement files."""
    base = posixpath.basename(path.lower())
    out: list[tuple[str, str, str]] = []
    try:
        if base == "package-lock.json":
            data = json.loads(text)
            for key, info in (data.get("packages") or {}).items():
                name = key.split("node_modules/")[-1]
                if name and isinstance(info, dict) and info.get("version") and not info.get("link"):
                    out.append(("npm", name, str(info["version"])))
        elif base.startswith("requirements") and base.endswith(".txt"):
            for ln in text.splitlines():
                m = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([A-Za-z0-9.!+*-]+)", ln.split("#")[0])
                if m:
                    out.append(("PyPI", m.group(1), m.group(2)))
        elif base in ("poetry.lock", "uv.lock"):
            for m in re.finditer(r'(?m)^name = "([^"]+)"\nversion = "([^"]+)"', text):
                out.append(("PyPI", m.group(1), m.group(2)))
    except Exception:
        return []
    return out
