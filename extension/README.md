# TrustCode for VS Code

Verify AI-generated code with **evidence**, not a confidence score. TrustCode runs independent checks
(syntax, static analysis, security patterns, sandboxed unit tests, dependency existence) and shows:

- **what each check found**, with the raw tool evidence and why it matters;
- **what each check can and cannot tell you** (its scope);
- **what was NOT verified** (untested functions and lines, requirement match, assumptions);
- explanations at **beginner / intermediate / advanced** depth — the evidence never changes between levels.

There is deliberately **no overall "safe" score**. You decide: accept, modify or reject, and record how confident you are.
TrustCode never edits your files.

## Use
1. Start a backend (see the repository's `deployment/README.md`; local mode needs no account).
2. Select AI-generated Python or JavaScript in the editor → right-click → **TrustCode: Verify Selected Code**.
3. Optionally describe the task and paste unit tests (`from solution import ...` / `require('./solution')`).
4. Confirm the consent prompt (nothing is sent before you confirm).

## Settings
| Setting | Default | Meaning |
|---|---|---|
| `trustcode.backendUrl` | `http://127.0.0.1:8000` | Where code is sent after you confirm |
| `trustcode.mode` | `local` | `local` (reads `~/.trustcode/local-secret`) or `account` (sign in) |
| `trustcode.requestTimeoutSeconds` | 30 | Per-request timeout |
| `trustcode.useLlmExplanations` | false | Ask for LLM-worded explanations (also needs the server and your profile to allow it) |

Commands: Verify Selected Code · Sign In/Out · Set Experience Level · Privacy & History Settings · Join Research Study · Ask Before Sending Code Again.

## Privacy
Code is sent only after explicit confirmation, is deleted on the server as soon as analysis ends, and results expire
(24 h by default, 30 days if you enable history). Research-study data uses a pseudonymous participant code.
