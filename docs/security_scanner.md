# TrustCode project security scanner

`trustcode-scan` examines a whole project on the local machine and reports security anomalies with an exact
location, a severity and a separate confidence. The VS Code extension (Security tab), Git hooks and CI all run
this one program. It reads and parses files; it never executes project code, and nothing is uploaded.

Workflow: **scan → detect → highlight → review → allow or block.**

## Install

```bash
pip install "trustcode-worker[tools]"      # from verification-worker/, or the git URL in docs/ci/trustcode-scan.yml
trustcode-scan tools                        # shows which scanners are available
```

The extension never installs anything. If the scanner is missing, the Security tab says that nothing was scanned.

## Modes

| Mode | Command | What is examined | Gate |
|---|---|---|---|
| Full project | `trustcode-scan` | Every included file: tracked, untracked, old and new | report only |
| New files | `--mode new` | Files Git does not track yet | report only |
| Changed files | `--mode changed` | Files Git reports as changed or untracked (whole project if Git is absent) | report only |
| Before commit | `--mode staged` | The **staged content** of staged files (not the working tree) | commit policy |
| Before push | `--mode push` | Files changed in outgoing commits, at `HEAD` | push policy |
| Before production | `--mode production` | Full project, cache ignored | production policy; an incomplete scan blocks |
| CI | `--mode ci` | Full project, cache ignored | CI policy; an incomplete scan blocks |
| Continuous | extension setting `trustcode.scanner.automatic` | Rescan after file changes settle; unchanged files come from the cache | report only |

Output: `--format text | json | sarif | markdown`, `--output FILE`. Exit codes: 0 allowed, 1 blocked by policy,
2 failed or incomplete where the policy requires a complete scan, 3 set-up problem.

## Severity, confidence and state are three separate things

- **Severity** (critical, high, medium, low, info): impact if the finding is real.
- **Confidence**: `confirmed` only with independent verification (an advisory matching an exact locked version);
  `strongly suspected` for a data-flow, syntax-aware or provider-format match; `potential` for a name- or
  shape-based heuristic that needs a person. A pattern match is never "confirmed".
- **State** (needs a baseline): `new`, `existing`, `reintroduced`, `suppressed` (reviewed), plus the lists
  `resolved` and `not revalidated` (a file the run did not look at, or whose scanner failed).

## Baseline and reviewed findings

```bash
trustcode-scan baseline                                  # full scan; records current findings in .trustcode/baseline.json
trustcode-scan review <fingerprint> --reason "why"       # records one reviewed false positive in .trustcode/reviewed.json
```

Existing findings stay in every report and in the counts. A review covers one exact finding (rule + file + line
text) and records who, when and why; if the line changes, the finding is reported again.

## Policy (`.trustcode/config.json`)

```json
{
  "block": { "commit": "critical", "push": "critical", "ci": "high", "production": "high" },
  "block_confidence": "strongly_suspected",
  "block_existing": { "commit": false, "push": false, "ci": false, "production": true },
  "on_incomplete": { "commit": "warn", "push": "warn", "ci": "block", "production": "block" },
  "exclude": ["docs/**"], "disabled_rules": [], "max_file_kb": 512, "network": false
}
```

These are the defaults. Findings below `block_confidence` never block. At commit and push time only rules marked
BLOCK stop the operation, except critical findings, which always count; in CI and for production the severity
threshold alone decides. "Allow" means no finding met the policy — it is never a statement that the project is secure.

## Git hooks and CI

```bash
trustcode-scan hooks status
trustcode-scan hooks install          # pre-commit and pre-push
```

An existing hook is never replaced, and husky / pre-commit / lefthook configuration is never edited: you are shown
the line to add. If the scanner is missing when a hook runs, the hook says the check was **skipped** (set
`TRUSTCODE_REQUIRE_SCANNER=1` to fail instead). A hook can be bypassed with `--no-verify`; the pre-push scan
reports outgoing commits that were never checked at commit time, and CI (`docs/ci/trustcode-scan.yml`) is the backstop.

## What is scanned, and what is not

Included: source, configuration, environment files, dependency manifests and lockfiles, CI workflows, container
files, agent configuration. `.env*` files and agent configuration are examined even when Git ignores them.
Excluded, each counted with its reason in every report: files ignored by Git, dependency directories, build output,
generated and binary file types, files over `max_file_kb`, symbolic links (never followed), configured exclusions.

Language coverage: **language-aware rules** for Python, JavaScript, TypeScript, PHP and Java. Every other text file
gets **generic patterns only** (credentials, configuration); the report says so per language.

## What is deliberately not reported (scanner 1.1)

A match is only useful if it is what the rule is meant to find. After every scanner has run, each match is looked at
again with what a pattern cannot see: the kind of file and the text around the match. These are not suppressions and
cannot be switched on by the project being scanned.

| Match | Reported | Why |
|---|---|---|
| `import pytest`, `require('node:test')`, `process.exit()`, `os._exit()` | Never in a project scan | The "test-environment tampering" rule exists for snippet verification, where the code runs in the same process as its tests. In a project this is ordinary code |
| `assert` in a test file | No | `assert` is how tests state what they expect. In application code it is still reported |
| A secret-like *name* with an ordinary value (`token_type = "bearer"`, `secret_file = "~/.app/secret"`, `key="smith2024"`) | No | The value must look like a secret: not a placeholder, sentence, path, URL or variable reference, and long and random enough. Names that are about a secret (`_file`, `_type`, `_header`, `_format`, …) are not the secret |
| A hard-coded value in a test file | Yes, as **low**, never blocking | Usually a fixture. Provider-format credentials and private keys keep their severity everywhere |
| Secrets in an environment file that Git ignores | No | That is where secrets belong. A tracked or un-ignored environment file is still reported |
| Risky text inside a rule definition (a regular expression or a Semgrep `pattern:` line) | No | Defining a detector is not using what it detects |
| `Math.random()` / `random.*` | Only near security words (token, nonce, password, session, key, …) | Jitter, shuffling and animation do not need a cryptographic generator |
| `innerHTML = '<fixed string>'` | No | The rule is about dynamic content |
| Plain `http://` addresses in test files, in JSON data, or for single-label and reserved test hosts | No | They are test doubles or records, not endpoints the program talks to |
| A suppression marker word in prose (`nosemgrep` in a docstring) | No | Only a marker in a comment suppresses anything |
| `"private_key"` mentioned in documentation | No | Key material after the marker is required |
| Bandit B608 at low confidence | No | A string that contains SQL words but is not passed to a query call. Strings that reach `execute()` are covered by the data-flow rules |

Each row has a labelled safe case in `scripts/security_eval/dataset.py` (`ordinary-*`), next to vulnerable cases that
prove the same rules still fire where they should. These heuristics can be evaded on purpose (for example by writing
`re.compile(` on a line that disables TLS); the scanner looks for mistakes, not for an author who hides them.

## Scanners

| Scanner | Role | Status |
|---|---|---|
| Semgrep (1.50 or newer) | Code rules: patterns and intra-file data flow | Integrated; detected, version-checked, failures reported |
| Built-in pattern and configuration rules | Credentials, env files, agent / CI / container configuration | Integrated |
| Bandit (optional) | Second set of Python security rules, merged with Semgrep's by file, line and category | Integrated; detected and version-reported; runs when installed |
| OSV advisory database | Known-vulnerable and malicious dependency versions | Integrated, opt-in (`--online`): sends package names and versions only. Verified against the live service on 2026-11-12 |
| Git | Ignore rules, staged and outgoing content | Used when present; full scans work without it |
| Gitleaks (optional) | Second credential detector | Integrated and tested (8.30.1). Project-supplied Gitleaks config, ignore file and allow markers are not honoured |
| OSV-Scanner (optional) | Dependency advisories for more lockfile formats | Integrated and tested live (2.7.1). Used instead of the built-in lookup when advisory lookups are on |
| TruffleHog | Credentials | Not integrated: overlaps Gitleaks and the built-in rules; its distinguishing feature is live verification of secrets, which sends them to third parties |
| pip-audit, npm audit | Dependency advisories | Not integrated: same advisory data as OSV; `npm audit` also follows the project's own `.npmrc` registry setting |
| Trivy, Checkov | Infrastructure-as-code, images | Not integrated: the research report records a 2026 supply-chain compromise of Trivy and recommends pinned, verified binaries, which this project does not yet have a mechanism for; Checkov pulls in a large dependency tree for coverage only partly needed here |
| CodeQL | Deep data flow | Not integrated: licence restricts use on private code without GitHub Advanced Security, and it needs a build database per language |

Project-supplied Semgrep configuration and inline `nosemgrep` markers are ignored; suppression markers are reported (TC-REG-004).

## Rule catalogue

Central metadata: `verification-worker/trustcode_worker/scan/catalogue.py`. Rule IDs follow
`docs/AI_AGENT_SECURITY_RESEARCH.md` where a rule from that report was implemented.

| Rule | Category | Detects | Engine | Severity | Confidence (max) | Policy | Priority |
|---|---|---|---|---|---|---|---|
| `TC-SEC-001` | secrets | Provider credential in file | pattern | critical | strongly suspected | BLOCK | P0 |
| `TC-SEC-002` | secrets | Private key or service-account key in file | pattern | critical | strongly suspected | BLOCK | P0 |
| `TC-SEC-004` | secrets | Hardcoded secret value | pattern | high | potential | WARN | P1 |
| `TC-SEC-005` | secrets | Credentials embedded in a URL | pattern | high | strongly suspected | BLOCK | P1 |
| `TC-ENV-001` | environment | Environment file with real values is not ignored by Git | config | high | strongly suspected | BLOCK | P0 |
| `TC-ENV-003` | environment | Secret exposed through a public (frontend) variable | config | critical | strongly suspected | BLOCK-CI | P1 |
| `TC-ENV-004` | environment | Hardcoded fallback for a secret environment variable | semgrep | high | strongly suspected | WARN | P1 |
| `TC-ENV-005` | configuration | Debug mode or wildcard host enabled | config | high | strongly suspected | WARN | P1 |
| `TC-ENV-006` | environment | Default or trivial password | config | high | strongly suspected | WARN | P1 |
| `TC-AGT-001` | agent-config | Coding agent allowed to run tools without approval | config | critical | strongly suspected | BLOCK | P0 |
| `TC-AGT-002` | agent-config | MCP server command in agent configuration | config | high | potential | BLOCK | P0 |
| `TC-AGT-003` | agent-config | Command runs automatically (agent hook or folder-open task) | config | high | potential | BLOCK | P0 |
| `TC-AGT-004` | agent-config | Hidden Unicode characters | pattern | high | strongly suspected | BLOCK | P0 |
| `TC-AGT-005` | agent-config | Coding agent started with safety checks disabled | pattern | high | strongly suspected | BLOCK | P0 |
| `TC-REG-002` | cryptography | TLS certificate verification disabled | pattern | high | strongly suspected | BLOCK | P0 |
| `TC-REG-004` | suppression | Security check suppressed inline | pattern | low | potential | WARN | P1 |
| `TC-DEP-003` | dependencies | Install script downloads or executes code | config | high | strongly suspected | BLOCK | P0 |
| `TC-DEP-004` | dependencies | Dependency version with a published vulnerability | osv | high | confirmed | BLOCK-CI | P1 |
| `TC-CICD-001` | ci-cd | Privileged workflow checks out untrusted pull-request code | config | critical | strongly suspected | BLOCK | P0 |
| `TC-CICD-002` | ci-cd | Untrusted event data interpolated into a workflow script | config | high | strongly suspected | BLOCK | P0 |
| `TC-DB-001` | database | Row-level security disabled or opened to everyone | pattern | critical | strongly suspected | BLOCK | P0 |
| `TC-DESTR-001` | destructive-command | Destructive command in a script | pattern | high | potential | BLOCK | P0 |
| `TC-DOCKER-001` | infrastructure | Container runs privileged or pipes a download into a shell | config | medium | strongly suspected | WARN | P2 |
| `TC-DOCKER-002` | infrastructure | Database port published to the host | config | low | potential | INFO | P3 |

### Code rules (Semgrep, `rules/scan/`)

| Rule | Languages | Category | Detects | Method | Severity |
|---|---|---|---|---|---|
| `java-sql-concat` | java | sql-injection | SQL built by concatenation | syntax pattern | high |
| `java-command-concat` | java | command-injection | Command built by concatenation | syntax pattern | high |
| `java-weak-hash` | java | cryptography | Weak hash algorithm | syntax pattern | medium |
| `java-reflected-parameter` | java | xss | Request parameter reflected in response | syntax pattern | high |
| `java-unsafe-deserialization` | java | unsafe-deserialization | Java native deserialization | syntax pattern | high |
| `java-trust-all-certificates` | java | cryptography | TLS certificate validation disabled | syntax pattern | high |
| `js-taint-sql` | javascript, typescript | sql-injection | Request data in SQL statement | data flow (taint) | critical |
| `js-taint-command` | javascript, typescript | command-injection | Request data in shell command | data flow (taint) | critical |
| `js-taint-ssrf` | javascript, typescript | ssrf | Request-controlled URL fetched by the server | data flow (taint) | high |
| `js-taint-path` | javascript, typescript | path-traversal | Request-controlled file path | data flow (taint) | high |
| `js-taint-xss` | javascript, typescript | xss | Request data in HTML output | data flow (taint) | high |
| `js-taint-redirect` | javascript, typescript | api-security | Open redirect | data flow (taint) | medium |
| `js-jwt-none-algorithm` | javascript, typescript | authentication | JWT accepts unsigned tokens | syntax pattern | critical |
| `js-jwt-decode-without-verify` | javascript, typescript | authentication | JWT read without signature check | syntax pattern | high |
| `js-cors-wildcard-credentials` | javascript, typescript | cors | CORS open to every origin with credentials | syntax pattern | high |
| `js-cors-wildcard-header` | javascript, typescript | cors | CORS allows every origin | syntax pattern | low |
| `js-session-cookie-insecure` | javascript, typescript | authentication | Insecure session cookie | syntax pattern | medium |
| `js-sensitive-route-without-middleware` | javascript, typescript | authorization | Sensitive route without auth middleware | syntax pattern | medium |
| `js-env-secret-fallback` | javascript, typescript | environment | Hardcoded fallback for a secret environment variable | syntax pattern | high |
| `js-tls-reject-unauthorized-false` | javascript, typescript | cryptography | TLS certificate verification disabled | syntax pattern | high |
| `js-taint-nosql` | javascript, typescript | sql-injection | Request data used as a NoSQL query filter | data flow (taint) | high |
| `js-localstorage-token` | javascript, typescript | authentication | Token stored in localStorage | syntax pattern | low |
| `php-taint-sql` | php | sql-injection | Request data in SQL statement | data flow (taint) | critical |
| `php-taint-xss` | php | xss | Request data echoed without escaping | data flow (taint) | high |
| `php-taint-command` | php | command-injection | Request data in shell command | data flow (taint) | critical |
| `php-taint-file` | php | path-traversal | Request-controlled file include or read | data flow (taint) | critical |
| `php-taint-deserialize` | php | unsafe-deserialization | Request data unserialized | data flow (taint) | critical |
| `php-weak-password-hash` | php | cryptography | Weak password hash | syntax pattern | high |
| `php-eval` | php | command-injection | Dynamic code execution | syntax pattern | high |
| `py-taint-sql` | python | sql-injection | Request data in SQL statement | data flow (taint) | critical |
| `py-taint-command` | python | command-injection | Request data in shell command | data flow (taint) | critical |
| `py-taint-ssrf` | python | ssrf | Request-controlled URL fetched by the server | data flow (taint) | high |
| `py-taint-path` | python | path-traversal | Request-controlled file path | data flow (taint) | high |
| `py-taint-template` | python | xss | Request data rendered without escaping | data flow (taint) | high |
| `py-taint-deserialize` | python | unsafe-deserialization | Request data deserialized unsafely | data flow (taint) | critical |
| `py-jwt-verification-disabled` | python | authentication | JWT signature not verified | syntax pattern | critical |
| `py-debug-enabled` | python | configuration | Debug mode enabled | syntax pattern | high |
| `py-cors-wildcard-credentials` | python | cors | CORS wildcard with credentials | syntax pattern | high |
| `py-plaintext-password-compare` | python | authentication | Password compared in plain text | syntax pattern | high |
| `py-env-secret-fallback` | python | environment | Hardcoded fallback for a secret environment variable | syntax pattern | high |
| `py-yaml-unsafe-load` | python | unsafe-deserialization | Unsafe YAML loader | syntax pattern | high |

The 21 frozen study rules and the extended rule file also run and are mapped to the same categories.

## Also available

- `--history`: looks for provider-format credentials on lines added in the last 500 commits (opt-in; extension setting `trustcode.scanner.scanGitHistory`).
- `trustcode-scan config` prints the default policy; the extension's **Rules & exclusions…** button creates and opens `.trustcode/config.json`.
- Added since the first version: credential-like values in logs, stack traces in responses, XXE, `postMessage` to any origin, uploads stored under a client-supplied name, Kubernetes privileged workloads (TC-K8S-001), wildcard IAM policies (TC-IAM-001).

## Weakened controls (compared with the last commit)

When Git is available the scanner also reads the change itself (`git diff`) and reports controls that were
removed or switched off: an authentication guard removed (TC-REG-001), a test skipped or deleted (TC-REG-003),
a secret-protecting `.gitignore` rule removed (TC-REG-005), a CI security step removed or made unable to fail
(TC-REG-008). A guard that is replaced by another guard in the same hunk is not reported.

## Protecting the gate itself

- A change to `.trustcode/config.json`, `reviewed.json` or `baseline.json` is reported as TC-REG-009. It cannot be
  disabled or marked as reviewed. In CI pass `--base <target branch>` so pull requests are compared with the
  branch they merge into; after a maintainer has reviewed the change, run once with `--allow-policy-change`.
- Scanners run isolated from the project: Python tools start in isolated mode from a neutral directory, file
  names are passed so they cannot be read as options, and project-supplied scanner configuration is ignored.
- Evidence copied from a source line is redacted before it is stored or shown.
- The extension starts the scanner only in trusted workspaces and only from an absolute path outside the workspace.

## Monorepos, build output and more credential formats

- Repositories with several package manifests get a per-package summary (files, findings, critical, high).
- Production and CI scans (or `--artifacts`) check build output directories for credential formats (TC-SEC-007).
- Dedicated detection for mail-server passwords, OAuth client secrets, Google OAuth and Mailgun keys, and secrets
  baked into Docker `ENV` / `ARG`. Dockerfiles are also checked for a missing non-root `USER`, `ADD` from a URL,
  world-writable permissions and privileged mode.
- Sensitive Django views without a decorator are flagged for review (`py-django-destructive-view-without-guard`).

## Not implemented

Authorization of individual routes (IDOR / object-level access, role escalation), rate limiting, missing input
validation, excessive data exposure, missing environment-variable validation, second-order SQL injection, Kubernetes / Terraform
rules beyond the two above, secrets in build artifacts, cross-file data flow, live verification of secrets, and languages other than
the five above. Every report lists the first three and "runtime behaviour" as checks that were not performed.
