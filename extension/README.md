# TrustCode for VS Code

Verify AI-generated code with **evidence**, not a confidence score. TrustCode runs independent checks
(syntax, static analysis, type checking, security patterns, hardcoded-secret formats, sandboxed unit tests,
dependency existence) and shows:

- **what each check found**, with the raw tool evidence and why it matters;
- **what each check can and cannot tell you** (its scope);
- **what was NOT verified** (untested functions and lines, requirement match, assumptions);
- explanations at **beginner / intermediate / advanced** depth — the evidence never changes between levels.

There is deliberately **no overall "safe" score**. You decide: accept, modify or reject, and record how confident you are.
TrustCode never edits your files.

## Scan the whole project for security issues (local)
1. Install the scanner once: `pip install "trustcode-worker[tools]"` (TrustCode never installs it for you).
2. Open the **Security** tab and choose **Scan entire project** — no account needed, nothing is uploaded.
3. Findings appear in the tab, in the Problems panel and underlined at the exact code. Step through them with
   `Ctrl/Cmd+K Alt+N` / `Alt+P`.
4. Use **Before commit**, **Before push** and **Before production** to apply your blocking policy, or install the
   Git hooks and the CI workflow so it happens without you.

A report never says a project is secure: it lists the checks that ran, the ones that were skipped or failed, and
the files that were excluded. Rules, policy and limits: `docs/security_scanner.md`.

## Verify what your coding agent changed
1. Run **TrustCode: Start Tracking Session** (or use the **Session** tab) before you give the agent its task.
2. Let the agent work. Created, modified, renamed and deleted files appear in the Session tab as they happen.
3. Choose **Verify all changes**. You get one report for the whole change: findings per file, problems between
   files, what is new versus already present, and what was not executed or not analysed.
4. Use **Copy fix prompt for your agent**, let it fix, and verify again to compare the runs.

TrustCode cannot see inside an agent. Unless the agent signals completion through a hook (**TrustCode: Agent Hook
Setup**), "possibly finished" is an estimate based on files no longer changing. Project tests are not run for
multi-file changes; that is stated in every report. Details and limits: `docs/project/session_tracking_report.md`.

## Verify a selection or a file
1. Click **Sign In with browser** in the TrustCode panel (or run **TrustCode: Sign In**). Log in or create an account on the
   TrustCode website; your browser returns you to VS Code (choose **Open** if asked).
2. Select AI-generated Python, JavaScript or TypeScript in the editor → right-click → **TrustCode: Verify Selected Code**
   (`Ctrl/Cmd+K Alt+V`), or verify the whole file with **TrustCode: Verify Current File** (`Ctrl/Cmd+K Alt+F`).
3. Optionally describe the task and paste unit tests (`from solution import ...` / `require('./solution')`).
4. Confirm the consent prompt (nothing is sent before you confirm).
5. Read the result in the panel, or in the editor: hover a marked line for the evidence, use the lightbulb to open its
   explanation, and watch the dotted *not verified* markers on lines your tests never ran. After you edit, run the
   checks again (`Ctrl/Cmd+K Alt+R`) to see what is new and what is no longer reported.

Which checks run depends on the server: a check that is unavailable is listed as **Not run** or **Check failed**, never as passed.

## Settings
| Setting | Default | Meaning |
|---|---|---|
| `trustcode.backendUrl` | `https://trustcode-api.vercel.app` | Where code is sent after you confirm |
| `trustcode.mode` | `account` | `account` (sign in) or `local` (own backend on this machine, reads `~/.trustcode/local-secret`) |
| `trustcode.requestTimeoutSeconds` | 30 | Per-request timeout |
| `trustcode.useLlmExplanations` | false | Ask for LLM-worded explanations (also needs the server and your profile to allow it) |

Commands: Verify Selected Code · Verify Current File · Run the Checks Again · Clear Findings from Editor · Sign In/Out · Set Experience Level · Privacy & History Settings · Join Research Study · Ask Before Sending Code Again.

## Privacy
- **Nothing is sent until you confirm** in a dialog that shows how many lines will be sent and where.
- The hosted server runs static checks only (it never executes your code). To keep code entirely on your machine,
  run your own backend and set `trustcode.mode` to `local` (see the GitHub repository).
Code is sent only after explicit confirmation, is deleted on the server as soon as analysis ends, and results expire
(24 h by default, 30 days if you enable history). Research-study data uses a pseudonymous participant code.

## Feedback
Issues and feature requests: https://github.com/malika1234m/trustcode/issues
