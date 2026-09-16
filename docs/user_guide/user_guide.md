# TrustCode User Guide

**Install:** `code --install-extension trustcode-0.1.0.vsix`, then start a backend (deployment/README.md §A for local use).
**Verify:** select AI-generated Python/JS → right-click → *TrustCode: Verify Selected Code* → optionally add the task and tests
(`from solution import …` / `require('./solution')`) → **Verify** → confirm the consent dialog.
**Read the result:** *Findings* (what/where/how detected/why/evidence/not verified/next step) → *Not verified* (where hidden bugs
can still be) → *Checks run* (each with its scope). Status labels: ✓ No findings (within scope) · ! Issue detected · ✕ Check failed ·
– Not tested · ? Requires human review. There is no overall safety score by design.
**Decide:** set your confidence, then Accept / Modify / Reject. TrustCode never edits your files.
**Settings:** *Set Experience Level*; *Privacy & History Settings* (history, LLM wording, level suggestions; all off by default);
*Ask Before Sending Code Again*. **Delete account and data:** `DELETE /api/v1/me/data` (button to be added; KI-013).
**Research study:** *TrustCode: Join Research Study* with the participant code from the researcher.
