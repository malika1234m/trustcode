# Anticipated viva questions (answers grounded in project evidence)

**Why is this HAI research and not just a code-analysis tool?** The manipulated variable is the *presentation of evidence to a
human*, and the outcomes are human decision correctness and calibration. The D2 (tool-blind) items exist specifically to
separate human calibration from tool accuracy (research_gap_analysis §3).

**Isn't combining Semgrep and an LLM what CodeRabbit and Copilot already do?** Yes, and the thesis says so
(existing_system_comparison.md). The contribution is the epistemic-status interaction design and its controlled evaluation, which no product publishes.

**How do you know your ground truth is right?** Hidden tests executed in the sandbox confirm each defect (20/20 validated);
labels still need independent human review (KI-008), and I report that limitation.

**Why within-subjects?** Power with a limited pool (power_simulation.py); learning and order effects are handled by counterbalancing and an order covariate.

**Isn't confidence different from trust?** Yes. Trust (questionnaire), reliance (behaviour) and calibration (Brier/AUROC against
ground truth) are measured separately, following Baltes et al. (TSE 2026).

**What if TrustCode makes people worse on tool-blind defects?** That is H3-exp, a pre-specified finding about automation complacency, and it is reportable either way.

**Is executing untrusted code safe?** Only in the sandbox; six security-review findings were fixed and attack tests are automated (threat_model.md).

**Why are LLM explanations not used in the experiment?** Reproducibility and the risk of explanation-induced over-reliance (ADR-007/008); all participants see identical, frozen evidence.

**Biggest limitations?** Short snippets, author-labelled benchmark, likely student sample, lab setting, and power for the secondary hypotheses.
