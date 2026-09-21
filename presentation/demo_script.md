# Demo script (≈ 6 min)
1. (Pre-start the backend: deployment/README.md §A with the worker in queue mode.) Open `demo/average.py` containing the PY-D2-02 code.
2. Select it → Verify. Point out the consent dialog: nothing is sent before you confirm.
3. Add the task "average, 0.0 for empty list" and the visible tests → result: tests ✓, security ✓, **Matches the task? ? Requires human review**.
   Ask the audience: accept? Show that the empty-list defect is invisible to the tools: this is the D2/complacency case.
4. Verify the PY-D1-01 SQL code → SEC-1 CWE-89; switch Beginner ↔ Advanced and show that the evidence text is identical.
5. Verify PY-C2-01 → insecure-random warning with its "often a false alarm" note: the tool can be wrong too.
6. Record a decision with confidence; show the file is unchanged.
7. Researcher view: create a session (`python -m app.admin create-researcher`), join with the participant code, show one trial, export the CSV.
