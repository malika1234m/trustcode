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

## Everything runs on your computer
TrustCode analyses code locally, and your code is not uploaded. TrustCode is free; **you sign in with a free
TrustCode account** to use it (sign-in happens in your browser). After sign-in it keeps working offline for up to
30 days and confirms your account when you are online. The first time you use
it, TrustCode asks to set up its local engine: a private Python environment in VS Code's storage with the
analysis tools (Ruff, Pyflakes, mypy, Bandit, Semgrep) downloaded from PyPI, about 300 MB. You need Python 3.11
or newer. Nothing is installed into your project or your system Python. Until the engine is set up, nothing is
checked, and TrustCode says so.

## Scan the whole project for security issues (local)
1. Open the **Security** tab. If the engine is not set up yet, choose **Set up the local engine**.
2. Choose **Scan entire project** — no account needed, nothing is uploaded.
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
1. Select AI-generated Python, JavaScript or TypeScript in the editor → right-click → **TrustCode: Verify Selected Code**
   (`Ctrl/Cmd+K Alt+V`), or verify the whole file with **TrustCode: Verify Current File** (`Ctrl/Cmd+K Alt+F`).
2. Optionally describe the task and paste unit tests (`from solution import ...` / `require('./solution')`). Tests
   run only inside the Docker sandbox; without Docker they are reported as not run.
3. Read the result in the panel, or in the editor: hover a marked line for the evidence, use the lightbulb to open its
   explanation, and watch the dotted *not verified* markers on lines your tests never ran. After you edit, run the
   checks again (`Ctrl/Cmd+K Alt+R`) to see what is new and what is no longer reported.

A check whose tool is unavailable is listed as **Not run** or **Check failed**, never as passed.
**TrustCode: Check Local Engine** lists which tools are available.

## Settings
| Setting | Default | Meaning |
|---|---|---|
| `trustcode.analysis.location` | `local` | `local`: Verify and Session run on this computer. `server`: they send the code you choose to the TrustCode server after you confirm (needs an account) |
| `trustcode.engine.registryLookups` | false | Look imported package names up on PyPI / npm (names only) to detect packages that do not exist |
| `trustcode.engine.runTests` | true | Run the unit tests you supply inside the Docker sandbox |
| `trustcode.engine.pythonPath` | empty | Advanced: an interpreter that already has the engine installed |
| `trustcode.backendUrl` | `https://trustcode-api.vercel.app` | The TrustCode server, for the optional account and for server analysis |
| `trustcode.useLlmExplanations` | false | Server analysis only: ask for LLM-worded explanations |

Commands: Verify Selected Code · Verify Current File · Run the Checks Again · Clear Findings from Editor · Set Up / Check / Remove Local Engine · Sign In/Out · Set Experience Level · Privacy & History Settings · Join Research Study.

## Privacy
- With local analysis (the default) no code, file name or finding is sent anywhere. History, decisions and ratings
  stay in VS Code's storage on this computer; **Delete my TrustCode data** removes them.
- The only downloads are the one-time engine setup from PyPI and a daily check of the public release list
  (`trustcode.updates.check`). There is no telemetry.
- If you select server analysis, nothing is sent until you confirm in a dialog that shows how much is sent and where.
  The code is deleted on the server when analysis ends.
- An account is optional: it is used for server analysis, a paid plan and the research study.

## Feedback
Issues and feature requests: https://github.com/malika1234m/trustcode/issues
