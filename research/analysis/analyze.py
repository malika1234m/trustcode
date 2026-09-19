"""Primary analysis pipeline (statistical_analysis_plan.md).

  python research/analysis/analyze.py path/to/trustcode_trials.csv  OUTDIR
  python research/analysis/analyze.py --synthetic OUTDIR     # pipeline self-check ONLY

--synthetic generates fake data with a KNOWN effect to verify the code recovers it. Its output is
watermarked SYNTHETIC and must NEVER be reported as a study result.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats

BANNER = "!!! SYNTHETIC DATA - PIPELINE CHECK ONLY - NOT A STUDY RESULT !!!"


def synthetic(n=40, seed=7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    classes = ["C1", "C2", "D1", "D2"] * 4
    rows = []
    for p in range(n):
        u = rng.normal(0, 1)
        for pos, cls in enumerate(classes):
            cond = "trustcode" if (pos < 8) ^ (p % 2 == 1) else "baseline"
            correct = cls in ("C1", "C2")
            if correct:
                lp = 1.5 + u - (0.6 if cls == "C2" and cond == "trustcode" else 0)
            else:
                lp = -0.2 + u - (1.4 if (cond == "trustcode" and cls == "D1") else 0.2 if cond == "trustcode" else 0)
            acc = rng.random() < 1 / (1 + np.exp(-lp))
            dc = int(acc == correct)
            conf = int(np.clip(rng.normal(70 if dc else 60, 15), 0, 100))
            rows.append(dict(participant_code=f"S-{p:03d}", condition=cond, item_class=cls, ground_truth_correct=correct,
                             accepted=int(acc), decision_correct=dc, confidence=conf, time_ms=int(rng.lognormal(10.5, .4)),
                             sequence_index=p, position=pos, decision="accept" if acc else "reject"))
    return pd.DataFrame(rows)


def analyse(df: pd.DataFrame, out: Path, synthetic_flag: bool):
    out.mkdir(parents=True, exist_ok=True)
    lines = [f"# {BANNER}\n" if synthetic_flag else "# TrustCode primary analysis\n"]
    df = df.dropna(subset=["decision"]).copy()
    df["ground_truth_correct"] = df["ground_truth_correct"].astype(str).str.lower().isin(["true", "1"])
    df["tc"] = (df["condition"] == "trustcode").astype(int)
    df["order"] = df.groupby("participant_code")["condition"].transform(lambda s: int(s.iloc[0] == "trustcode"))
    df["brier"] = (df["confidence"] / 100 - df["decision_correct"]) ** 2
    lines.append(f"Participants: {df.participant_code.nunique()}, trials: {len(df)}\n")
    desc = df.groupby(["condition", "item_class"]).agg(accept_rate=("accepted", "mean"), correct=("decision_correct", "mean"),
                                                        n=("accepted", "size")).round(3)
    lines.append("## Descriptives\n\n" + desc.to_markdown() + "\n")
    p = {}

    def gee(formula, data):
        return smf.gee(formula, groups="participant_code", data=data, family=sm.families.Binomial(),
                       cov_struct=sm.cov_struct.Exchangeable()).fit()
    d = df[~df.ground_truth_correct]
    m1 = gee("accepted ~ tc + order", d)
    p["H1"] = m1.pvalues["tc"]
    ci = np.exp(m1.conf_int().loc["tc"])
    lines.append(f"## H1 false acceptance (defective items)\nOR(TrustCode vs baseline) = {np.exp(m1.params['tc']):.2f} "
                 f"[{ci[0]:.2f}, {ci[1]:.2f}], p = {m1.pvalues['tc']:.4f}\n")
    c = df[df.ground_truth_correct].assign(rej=lambda x: 1 - x.accepted)
    rates = c.groupby(["participant_code", "condition"]).rej.mean().unstack()
    diff = (rates["trustcode"] - rates["baseline"])
    se = diff.std(ddof=1) / np.sqrt(len(diff))
    upper = diff.mean() + 1.645 * se
    p["H1b"] = stats.norm.sf((0.10 - diff.mean()) / se)
    lines.append(f"## H1b false rejection (correct items), non-inferiority margin +0.10\nmean diff = {diff.mean():.3f}, "
                 f"one-sided 95% upper bound = {upper:.3f} -> {'non-inferior' if upper < 0.10 else 'not shown'}\n")
    b = df.groupby(["participant_code", "condition"]).brier.mean().unstack()
    t = stats.ttest_rel(b["trustcode"], b["baseline"])
    dz = (b["trustcode"] - b["baseline"]).mean() / (b["trustcode"] - b["baseline"]).std(ddof=1)
    p["H2"] = t.pvalue
    lines.append(f"## H2 Brier score (lower = better calibrated)\nbaseline {b['baseline'].mean():.3f}, TrustCode "
                 f"{b['trustcode'].mean():.3f}, t = {t.statistic:.2f}, p = {t.pvalue:.4f}, d_z = {dz:.2f}\n")
    d = d.assign(d2=(d.item_class == "D2").astype(int))
    m3 = gee("accepted ~ tc * d2 + order", d)
    p["H3"] = m3.pvalues["tc:d2"]
    lines.append(f"## H3 condition x detectability\ninteraction OR = {np.exp(m3.params['tc:d2']):.2f}, p = {m3.pvalues['tc:d2']:.4f}\n")
    keys = sorted(p, key=p.get)
    holm, prev = {}, 0
    for i, k in enumerate(keys):
        prev = max(prev, min(1, p[k] * (len(keys) - i)))
        holm[k] = prev
    lines.append("## Holm-adjusted p-values\n\n" + "\n".join(f"- {k}: {holm[k]:.4f}" for k in sorted(holm)) + "\n")
    lines.append("Verdicts must be written by the researcher (Supported / Not supported / Inconclusive) with effect sizes and validity threats.\n")
    if synthetic_flag:
        lines.append(f"\n{BANNER}\nBuilt-in synthetic truth: TrustCode lowers acceptance of D1 strongly, D2 slightly, raises C2 rejection.\n")
    (out / ("SYNTHETIC_report.md" if synthetic_flag else "report.md")).write_text("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    if sys.argv[1] == "--synthetic":
        analyse(synthetic(), Path(sys.argv[2]), True)
    else:
        analyse(pd.read_csv(sys.argv[1]), Path(sys.argv[2]), False)
