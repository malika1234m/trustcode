# Threat Model (STRIDE-oriented), v0.1.0

Assets: developers' source code; integrity of verification evidence; research data; credentials; host running the worker.

| ID | Threat | Mitigation (implemented) | Residual risk |
|---|---|---|---|
| T-1 | Malicious submitted code attacks the server | API never executes code (`worker_mode=queue` enforced in production); static tools only parse | Parser vulnerabilities in ruff/Semgrep/Node |
| T-2 | Sandbox escape / resource exhaustion | `--network none`, read-only root, noexec tmpfs, cap-drop ALL (+SETUID/SETGID/KILL for the runner only), no-new-privileges, pids 64, 256 MB, 1 CPU, fsize/nofile ulimits, timeout + kill, `--rm` | Container escape via kernel bugs; consider gVisor/Firecracker for public deployment |
| T-3 | Forged test results (writing fake result lines, reading the nonce) | Per-run nonce over stdin; tests run as uid 65534 that cannot open `/proc/1/*`; process group killed before emit; tests for forged lines | — |
| T-4 | Host memory exhaustion by output flood | 1 MB capped reader; container killed | — |
| T-5 | Prompt injection via code/comments into the LLM | Code wrapped as untrusted data; LLM can only re-word existing finding IDs; schema + banned-claim validation; evidence immutable; template fallback | LLM wording could still be misleading within an existing finding (labelled "AI-worded") |
| T-6 | Credential attacks | scrypt hashes; 15-min access JWT; single-use refresh rotation; per-account login limiter; 20/min/IP on auth endpoints | Single-instance limiter |
| T-7 | Code under test tampers with the test framework in-process | Semgrep rules `runtime-or-test-tampering` flag it as critical/human review; scope text discloses | Determined in-process tampering cannot be fully excluded |
| T-8 | Privilege escalation to researcher | No role at self-registration; `create-researcher` admin CLI; promoting existing accounts needs interactive confirmation | No e-mail verification yet |
| T-9 | Worker has Docker socket (root-equivalent on host) | Worker container never executes code itself; run the worker on a dedicated VM | Compromise of worker = host compromise; rootless Docker recommended |
| T-10 | Local mode CSRF / DNS rebinding | Per-install 0600 secret, Host allow-list, Origin rejected | — |
| T-11 | IDOR on jobs/trials | Ownership checks return 404; participant tokens scoped to their session | — |
| T-12 | Information disclosure in logs/errors | No bodies logged; validation errors stripped of input; generic 500s with request id | — |
| T-13 | Webview XSS from tool output | All values escaped; CSP `default-src 'none'`, nonce scripts only | — |
| T-14 | Hallucinated / typosquatted packages | Dependency check marks unknown packages "needs review", never OK | Registry lookup off by default (offline) |
| T-15 | Research data re-identification | No FK to users; pseudonymous codes; export excludes unconsented sessions | Free-text rationales may contain identifiers — screen before sharing |

Automated security reviews during development raised six issues (TEST_REPORT S-1…S-6); all were fixed and regression-tested.
