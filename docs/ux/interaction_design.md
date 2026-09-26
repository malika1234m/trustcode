# Interaction & UX Design (Phase 4)

## Principles (from the literature)
1. **Evidence before verdicts.** No green "safe" badge; per-check status chips with text + icon (`✓ No findings (within scope)`, `! Issue detected`, `✕ Check failed — result unknown`, `– Not tested`, `? Requires human review`).
2. **Make gaps salient.** "Not verified" is a first-class section placed *before* the list of checks, because tool-blind defects live there (H3).
3. **Lower verification cost** (Vasconcelos 2023): each finding answers what / where / detected by / why / evidence / not verified / next step.
4. **Adapt wording, never evidence.** Level switch changes text only (tested invariant).
5. **Human control.** Accept / Modify / Reject plus confidence; files are never modified.

## Interaction flow
```
Select code → Verify (command/context menu) → Consent modal → Progress (cancellable)
  → Result view: [Level switch] → Findings → Not verified → Checks run → Guidance
  → Decision (confidence slider + Accept/Modify/Reject) → optional feedback per finding
```

## Wireframe — result view (sidebar, ~300 px)
```
┌───────────────────────────────┐
│ Verification evidence         │
│ [Beginner][Intermediate][Adv.]│
│ Findings (2)                  │
│ ▌HIGH SQL injection risk (SEC-1)
│   Where: line 3 `conn.execute(f"…")`
│   Detected by: Semgrep rule   │
│   Why it matters: …           │
│   Evidence: ┌───────────────┐ │
│             │tool output    │ │
│   Not verified: input reach…  │
│   Next step: use parameters   │
│   [Helpful][Too technical]…   │
│ Not verified (3)              │
│  • Function 'helper' never ran│
│  • Match with the task        │
│ Checks run                    │
│  Syntax        ✓ No findings  │
│  Unit tests    ! Issue        │
│  Matches task? ? Human review │
│ There is no overall "safe"…   │
│ ┌ Your decision ────────────┐ │
│ │ Confidence: ───●── 70%     │ │
│ │ [Accept][Modify][Reject]   │ │
│ └────────────────────────────┘ │
└───────────────────────────────┘
```

## Explanation levels (same finding SEC-1)
| Level | "Why it matters" (actual template output) |
|---|---|
| Beginner | "If a user types special characters (like a quote), they can change what the database command does…" + rule-confidence note + verification steps |
| Intermediate | "Untrusted input concatenated into SQL can alter query structure (SQL injection)." + code excerpt + fix |
| Advanced | `SEC-1 semgrep:sql-string-formatting (CWE-89)` + one-line rationale |

## Design system
VS Code theme tokens only (`--vscode-*`), so light, dark and high-contrast themes work; 4 px radius; severity shown
by left border **and** text label; focus ring `--vscode-focusBorder`; respects `prefers-reduced-motion`.

## Accessibility checklist
- [x] Status conveyed by text, not colour alone (unit-tested)
- [x] Buttons are real `<button>`s; level switch uses `aria-pressed`; regions have headings and `aria-labelledby`
- [x] Live region (`aria-live="polite"`) for progress updates
- [ ] Screen-reader walkthrough (NVDA/VoiceOver) — pending (docs/project/known_issues.md)
- [ ] Usability validation with users — Phase 13 pilot

High-fidelity mockups: the implemented webview *is* the high-fidelity prototype; screenshots to be captured
in the pilot for the dissertation (Figure list in `dissertation/`).
