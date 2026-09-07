# Existing System Comparison (Phase 2)

**Status:** v0.1, 2026-11-03. Product features change quickly; the claims below were checked via web search on 2026-11-03 against vendor documentation where possible. Re-verify them before the dissertation is submitted.

## 1. Feature matrix

Legend: ● yes · ◐ partial · ○ no · ? not documented

| Capability | Copilot (chat/agent + code review) | Cursor / Claude Code (agents) | CodeRabbit | SonarQube (+AI Code Assurance) | Semgrep (+Assistant) | Snyk Code (+DeepCode AI Fix) | **TrustCode** |
|---|---|---|---|---|---|---|---|
| Generates code | ● | ● | ○ | ○ | ○ | ◐ (fixes) | ○ (verifies user-submitted code) |
| Deterministic static analysis | ● CodeQL default in Copilot code review; ESLint/PMD optional (preview) [1] | ◐ via user-configured hooks/tools | ● 20–40 linters/SAST in sandbox [3] | ● | ● | ● | ● ruff, Semgrep, syntax |
| Executes tests | ○ in review | ◐ agent may run tests | ? | ○ (imports coverage) | ○ | ◐ tests generated fixes | ● sandboxed, per-test evidence |
| LLM explanation of findings | ● | ● | ● | ◐ (AI CodeFix) | ● Assistant | ● | ● grounded; must cite evidence IDs |
| AI filters/hides findings | ? | — | ● "judge model" removes nitpicks/FPs [3] | ○ | ● auto-triage (vendor: ~60% of findings) [4] | ○ | ○ **never hides evidence**; may mark it "low confidence" |
| Explicit "not tested / unverified" status | ○ | ○ | ○ | ◐ coverage metrics | ○ | ○ | ● first-class status |
| Single aggregate verdict / badge | ◐ review summary | ○ | ◐ summary | ● quality gate pass/fail; AI Code Assurance is a label on a gate, with no extra checks [2] | ○ | ◐ score | ○ deliberately none |
| Adapts explanation to user expertise | ○ | ◐ via prompting | ○ | ○ | ○ | ○ | ● explicit, user-controlled; evidence invariant |
| Captures accept/reject + confidence | ◐ telemetry (accept) | ◐ | ◐ thumbs | ○ | ● triage memory | ○ | ● for research (consented) |
| Measures user calibration | ○ | ○ | ○ | ○ | ○ (measures AI–user agreement) | ○ | ● experiment mode |
| Works on code from any assistant | ◐ PR-level | ○ | ◐ PR-level | ● | ● | ● | ● snippet-level, user-initiated |
| Local/private mode | ○ | ○ | ○ | ● self-hosted | ● CLI | ◐ | ● local mode, LLM optional |

## 2. Strongest research systems (from Phase 1)

| System | What it does better than TrustCode | What TrustCode adds |
|---|---|---|
| Live Programming validation [ferdowsi2024live] | Continuous runtime values: very low validation cost | Multi-source evidence + explicit coverage gaps + calibration metrics |
| Trust-calibrated review prototype [heander2026trustcalibrated] | Multi-file, agent-scale review; risk-per-line | Working tool + controlled behavioural evaluation |
| XAI code review [gao2026xai] | Real-world change requests | Tool-grounded evidence; ground-truth benchmark |
| TARS [todisco2026tars] | Richer profiling (role, style), RAG over docs | Adaptation that keeps evidence invariant; applied to verification decisions |

## 3. Conclusion

Industry has already converged on **"deterministic tools + LLM explanation"** (Copilot code review with CodeQL, CodeRabbit, Semgrep Assistant). So TrustCode **must not** claim novelty for combining Semgrep with an LLM. The differentiators that remain are interaction-level and measurable:

1. **Epistemic-status presentation**: "not tested" and "unverified assumption" are first-class, and nothing is hidden by AI triage.
2. **Grounding constraint**: the LLM may only explain evidence it can cite, and cannot add verdicts.
3. **Evaluation of calibrated reliance** against ground truth, including tool-blind defects. No product publishes this.

Industry practice also gives the study practical relevance. CodeRabbit and Semgrep both use AI to *suppress* findings, which raises the question TrustCode can partly inform: does showing everything with status labels calibrate users better than AI pre-filtering? (A future-work condition.)

## Sources
1. GitHub Docs, "Copilot code review": https://docs.github.com/en/copilot/concepts/agents/code-review ; GitHub changelog 2025-10-28: https://github.blog/changelog/2025-10-28-new-public-preview-features-in-copilot-code-review-ai-reviews-that-see-the-full-picture/
2. Sonar docs, "Quality gates for AI code": https://docs.sonarsource.com/sonarqube-server/2026.2/quality-standards-administration/ai-code-assurance/quality-gates-for-ai-code ; Sonar community clarification (2026.1): https://community.sonarsource.com/t/clarification-needed-on-ai-code-assurance-in-sonarqube-2026-1-0/181186
3. CodeRabbit docs, static analyzers & linters: https://docs.coderabbit.ai/changelog/static-analyzers-and-linters-integration ; https://www.coderabbit.ai/supported-linters
4. Semgrep blog (vendor claim): https://semgrep.dev/blog/2025/semgrep-is-confidently-handling-60-of-all-triage-for-users-without-reducing-coverage ; Assistant overview: https://semgrep.dev/docs/semgrep-assistant/overview
5. Independent evaluation of Copilot code review security (PMLR v318): https://proceedings.mlr.press/v318/amro26a.html
