"""Central rule catalogue for the project scanner.

One entry per rule: what it detects, how sure a match can be, what to do about it and whether it may block.
Detection logic lives next to its engine (rules/scan/*.yml for Semgrep, patterns.py for text/config rules);
everything a report, policy or UI needs lives here, so adding a rule never means touching the scanner.

severity   = impact if the finding is real: critical | high | medium | low | info
confidence = how likely it is real - a separate axis:
             confirmed          only with independent verification (an advisory matching an exact locked version)
             strongly_suspected a syntax-aware or data-flow match, or a provider-specific credential format
             potential          a name- or shape-based heuristic that needs a human
block      = BLOCK (commit, push, CI, production) | BLOCK-CI (CI and production only) | WARN | INFO
priority   = P0..P3 (docs/AI_AGENT_SECURITY_RESEARCH.md section 12)
"""
from __future__ import annotations

SEVERITIES = ["info", "low", "medium", "high", "critical"]
CONFIDENCES = ["potential", "strongly_suspected", "confirmed"]


def R(category, title, severity, confidence, engine, priority, block, remediation, fp, cwe=()):
    return {"category": category, "title": title, "severity": severity, "confidence": confidence, "engine": engine,
            "priority": priority, "block": block, "remediation": remediation, "false_positives": fp, "cwe": list(cwe)}


S, P = "strongly_suspected", "potential"
RULES: dict[str, dict] = {
    # ---- secrets
    "TC-SEC-001": R("secrets", "Provider credential in file", "critical", S, "pattern", "P0", "BLOCK",
                    "Remove it, load it from the environment or a secret manager, and rotate the credential.",
                    "Documented example keys and placeholders are filtered.", ["CWE-798"]),
    "TC-SEC-002": R("secrets", "Private key or service-account key in file", "critical", S, "pattern", "P0", "BLOCK",
                    "Remove the key from the repository and rotate it.", "Test certificates.", ["CWE-321"]),
    "TC-SEC-004": R("secrets", "Hardcoded secret value", "high", P, "pattern", "P1", "WARN",
                    "Move the value to the environment or a secret manager.", "Placeholders and development values.", ["CWE-798"]),
    "TC-SEC-005": R("secrets", "Credentials embedded in a URL", "high", S, "pattern", "P1", "BLOCK",
                    "Take the password out of the connection string and rotate it.", "Template variables are filtered.", ["CWE-798"]),
    # ---- environment
    "TC-ENV-001": R("environment", "Environment file with real values is not ignored by Git", "high", S, "config", "P0", "BLOCK",
                    "Add the file to .gitignore, remove it from the index (git rm --cached) and rotate what it contains.",
                    ".env.example / .sample / .template files with placeholders are not reported."),
    "TC-ENV-003": R("environment", "Secret exposed through a public (frontend) variable", "critical", S, "config", "P1", "BLOCK-CI",
                    "Do not give a server secret a NEXT_PUBLIC_/VITE_/REACT_APP_ name: those values are shipped to the browser.",
                    "Publishable keys that are meant to be public.", ["CWE-200"]),
    "TC-ENV-004": R("environment", "Hardcoded fallback for a secret environment variable", "high", S, "semgrep", "P1", "WARN",
                    "Fail at start-up when the variable is missing instead of falling back to a literal.",
                    "Non-secret defaults such as ports are excluded by name.", ["CWE-1188"]),
    "TC-ENV-005": R("configuration", "Debug mode or wildcard host enabled", "high", S, "config", "P1", "WARN",
                    "Switch debug off and list the allowed hosts explicitly for production.", "Development-only settings files.", ["CWE-489"]),
    "TC-ENV-006": R("environment", "Default or trivial password", "high", S, "config", "P1", "WARN",
                    "Replace it with a generated secret that is not stored in the repository.", "Local-only examples.", ["CWE-1392"]),
    # ---- agent configuration and behaviour
    "TC-AGT-001": R("agent-config", "Coding agent allowed to run tools without approval", "critical", S, "config", "P0", "BLOCK",
                    "Remove the auto-approve / allow-all setting; approve tool use per action.", "A developer enabling it knowingly.", ["CWE-94"]),
    "TC-AGT-002": R("agent-config", "MCP server command in agent configuration", "high", P, "config", "P0", "BLOCK",
                    "Confirm a person added this server; MCP commands run when the agent starts.", "Reviewed team servers.", ["CWE-94"]),
    "TC-AGT-003": R("agent-config", "Command runs automatically (agent hook or folder-open task)", "high", P, "config", "P0", "BLOCK",
                    "Confirm the command is intended; these run without being asked.", "TrustCode's own completion hook is recognised.", ["CWE-94"]),
    "TC-AGT-004": R("agent-config", "Hidden Unicode characters", "high", S, "pattern", "P0", "BLOCK",
                    "Delete the invisible characters; they can hide instructions or change how code reads.", "Emoji variation selectors in prose.", ["CWE-116"]),
    "TC-AGT-005": R("agent-config", "Coding agent started with safety checks disabled", "high", S, "pattern", "P0", "BLOCK",
                    "Remove the permission-bypass flag from scripts and CI.", "Documentation that only mentions the flag (Markdown is not scanned for this)."),
    # ---- regressions / weakened controls
    "TC-REG-002": R("cryptography", "TLS certificate verification disabled", "high", S, "pattern", "P0", "BLOCK",
                    "Remove the option; fix the certificate chain instead.", "Test fixtures.", ["CWE-295"]),
    "TC-REG-001": R("regression", "Access-control guard removed", "high", S, "diff", "P0", "BLOCK",
                    "Restore the guard, or confirm the route is now protected another way.", "A guard moved to router level in the same change.", ["CWE-862"]),
    "TC-REG-003": R("regression", "Test disabled or deleted", "medium", S, "diff", "P1", "WARN",
                    "Re-enable the test; fix the code rather than silencing the check.", "Tests skipped for a documented, temporary reason.", ["CWE-1164"]),
    "TC-REG-005": R("regression", "Secret-protecting ignore rule removed", "high", S, "diff", "P1", "BLOCK-CI",
                    "Put the ignore rule back before a secrets file is committed.", "Rules replaced by an equivalent pattern."),
    "TC-REG-008": R("regression", "Security step weakened in CI", "high", S, "diff", "P1", "BLOCK-CI",
                    "Restore the scanner step and let it fail the build.", "A scanner moved to another workflow."),
    "TC-NET-001": R("configuration", "Unencrypted HTTP endpoint", "low", P, "pattern", "P3", "INFO",
                    "Use https:// for anything that is not local development.", "Local, example and schema URLs are filtered."),
    "TC-CLOUD-001": R("infrastructure", "Cloud resource open to the public", "high", P, "config", "P2", "WARN",
                      "Restrict the ACL or source range to what is needed.", "Intentionally public websites and load balancers.", ["CWE-284"]),
    "TC-REG-009": R("regression", "Scanner policy, baseline or review records changed", "high", S, "diff", "P0", "BLOCK-CI",
                    "Have a maintainer review the change to .trustcode/: it decides what the gate reports and blocks.",
                    "Intended policy updates (pass --allow-policy-change for that run after review)."),
    "TC-REG-004": R("suppression", "Security check suppressed inline", "low", P, "pattern", "P1", "WARN",
                    "Confirm the suppression is justified; it hides findings from other tools.", "Long-standing, reviewed suppressions."),
    # ---- dependencies
    "TC-DEP-003": R("dependencies", "Install script downloads or executes code", "high", S, "config", "P0", "BLOCK",
                    "Remove the network call from the install script or pin and verify what it fetches.", "Native build steps (node-gyp).", ["CWE-829"]),
    "TC-DEP-004": R("dependencies", "Dependency version with a published vulnerability", "high", "confirmed", "osv", "P1", "BLOCK-CI",
                    "Upgrade to a fixed version listed in the advisory.", "Advisories that do not affect how the package is used.", ["CWE-1395"]),
    # ---- CI/CD
    "TC-CICD-001": R("ci-cd", "Privileged workflow checks out untrusted pull-request code", "critical", S, "config", "P0", "BLOCK",
                     "Do not check out the PR head in a pull_request_target / workflow_run workflow.", "Checkout into a path that is never executed.", ["CWE-829"]),
    "TC-CICD-002": R("ci-cd", "Untrusted event data interpolated into a workflow script", "high", S, "config", "P0", "BLOCK",
                     "Pass the value through an environment variable and quote it.", "Trusted contexts.", ["CWE-78"]),
    # ---- data layer
    "TC-DB-001": R("database", "Row-level security disabled or opened to everyone", "critical", S, "pattern", "P0", "BLOCK",
                   "Keep row-level security enabled and restrict the policy.", "Schemas that are not exposed.", ["CWE-284"]),
    # ---- destructive commands
    "TC-DESTR-001": R("destructive-command", "Destructive command in a script", "high", P, "pattern", "P0", "BLOCK",
                      "Confirm the target; guard variables against being empty.", "Clean-up of known build directories."),
    # ---- containers
    "TC-DOCKER-001": R("infrastructure", "Container runs privileged or pipes a download into a shell", "medium", S, "config", "P2", "WARN",
                       "Drop privileged mode; download, verify, then execute.", "Trusted installers.", ["CWE-250"]),
    "TC-K8S-001": R("infrastructure", "Kubernetes workload runs privileged or as root", "high", S, "config", "P2", "WARN",
                    "Drop privileged / host access and run as a non-root user.", "System components that need host access.", ["CWE-250"]),
    "TC-IAM-001": R("infrastructure", "IAM policy allows every action on every resource", "high", S, "config", "P2", "BLOCK-CI",
                    "Grant only the actions and resources that are needed.", "Break-glass administrator roles.", ["CWE-732"]),
    "TC-SEC-006": R("secrets", "Credential in Git history", "critical", S, "pattern", "P1", "BLOCK-CI",
                    "Rotate the credential: removing it from the current files does not remove it from history.", "Revoked or example keys.", ["CWE-798"]),
    "TC-DOCKER-002": R("infrastructure", "Database port published to the host", "low", P, "config", "P3", "INFO",
                       "Publish database ports only when needed and bind them to 127.0.0.1.", "Local development stacks.", ["CWE-668"]),
}

# Semgrep rule id -> (category, confidence). Rules in rules/scan/ carry their own metadata; this table covers
# the frozen and extended rule files, whose metadata must not be edited (ADR-005).
LEGACY_SEMGREP: dict[str, tuple[str, str]] = {
    "sql-string-formatting": ("sql-injection", S), "js-sql-concat": ("sql-injection", S), "js-sql-concat-any-position": ("sql-injection", S),
    "shell-command-injection": ("command-injection", S), "js-child-process-exec": ("command-injection", S),
    "eval-exec-use": ("command-injection", P), "js-eval": ("command-injection", P),
    "unsafe-deserialization": ("unsafe-deserialization", S), "weak-password-hash": ("cryptography", S), "js-weak-hash": ("cryptography", S),
    "insecure-random": ("cryptography", P), "js-insecure-random": ("cryptography", P),
    "hardcoded-secret": ("secrets", P), "js-hardcoded-secret": ("secrets", P),
    "tls-verification-disabled": ("cryptography", S), "path-traversal-open": ("path-traversal", P), "js-path-traversal": ("path-traversal", P),
    "assert-for-validation": ("api-security", P), "js-innerhtml": ("xss", P), "js-prototype-pollution-merge": ("api-security", P),
    "runtime-or-test-tampering": ("agent-config", P), "js-runtime-or-test-tampering": ("agent-config", P),
}
# Scan-rule metadata uses confirmed | strong | review; a pattern or data-flow match is never "confirmed".
SEMGREP_CONFIDENCE = {"confirmed": S, "strong": S, "review": P}
SEMGREP_BLOCK = {"sql-injection": "BLOCK-CI", "command-injection": "BLOCK-CI", "unsafe-deserialization": "BLOCK-CI", "authentication": "BLOCK-CI",
                 "xss": "WARN", "ssrf": "WARN", "path-traversal": "WARN"}
REMEDIATION = {
    "sql-injection": "Use parameterised queries / bind parameters instead of building SQL text.",
    "command-injection": "Pass arguments as a list without a shell, or validate against an allow-list.",
    "xss": "Escape on output or use the framework's auto-escaping; avoid raw HTML sinks.",
    "ssrf": "Validate the URL against an allow-list of hosts before fetching.",
    "path-traversal": "Resolve the path and check it stays inside the intended directory.",
    "unsafe-deserialization": "Use a safe format (JSON) or a safe loader.",
    "authentication": "Verify the signature and pin the accepted algorithms.",
    "authorization": "Add authentication and an ownership / role check, or confirm it is applied at router level.",
    "cors": "List allowed origins explicitly; never combine a wildcard with credentials.",
    "cryptography": "Use a current algorithm or library default (bcrypt/argon2 for passwords, secrets module for tokens).",
    "configuration": "Disable for production.", "api-security": "Validate input on the server.",
    "secrets": "Move the value to the environment or a secret manager and rotate it.",
}
