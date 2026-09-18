"""Simulation-based power analysis for the primary hypothesis H1 (false acceptance of defective code).

Design simulated (as implemented): within-subjects, each participant sees 16 items, 8 per condition,
of which 4 per condition are defective (2 D1 + 2 D2). Outcome: accept (1) / not accept (0) on defective items.
Data-generating model: logit P(accept) = b0 + b1*TrustCode + u_participant + v_item,
u ~ N(0, sd_p), v ~ N(0, sd_i).  Analysis: GEE logistic (exchangeable, clustered by participant),
two-sided alpha = .05.  ASSUMPTIONS ARE PLACEHOLDERS informed by the literature (e.g. Perry et al. 2023;
Kabir et al. 2024 found misinformation overlooked ~39% of the time) - revisit after the pilot.
Also simulates a 32-item benchmark extension to show how more items per participant change power.
Usage: python research/analysis/power_simulation.py [n_sims]
"""
import sys
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf

warnings.filterwarnings("ignore")
rng = np.random.default_rng(20261103)


def logit(p):
    return np.log(p / (1 - p))


def simulate(n, p_base, p_tc, defective_per_cond, sd_p=1.0, sd_i=0.5):
    rows = []
    b0, b1 = logit(p_base), logit(p_tc) - logit(p_base)
    n_items = 2 * defective_per_cond
    v = rng.normal(0, sd_i, n_items)
    for pid in range(n):
        u = rng.normal(0, sd_p)
        swap = pid % 2  # counterbalanced item-block assignment
        for item in range(n_items):
            tc = int((item < defective_per_cond) ^ swap)
            p = 1 / (1 + np.exp(-(b0 + b1 * tc + u + v[item])))
            rows.append((pid, item, tc, rng.random() < p))
    return pd.DataFrame(rows, columns=["pid", "item", "tc", "accept"]).astype({"accept": int})


def power(n, p_base, p_tc, defective_per_cond, sims):
    hits = 0
    for _ in range(sims):
        df = simulate(n, p_base, p_tc, defective_per_cond)
        try:
            m = smf.gee("accept ~ tc", groups="pid", data=df, family=sm.families.Binomial(),
                        cov_struct=sm.cov_struct.Exchangeable()).fit()
            hits += m.pvalues["tc"] < 0.05 and m.params["tc"] < 0
        except Exception:
            pass
    return hits / sims


if __name__ == "__main__":
    sims = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    print(f"n_sims={sims}; baseline false-acceptance 0.45; participant SD 1.0, item SD 0.5 (logit)")
    print("| Defective items per condition | Effect (FA baseline -> TrustCode) | N=20 | N=30 | N=40 | N=60 |")
    print("|---|---|---|---|---|---|")
    for dpc in (4, 8):
        for p_tc in (0.30, 0.25, 0.20):
            res = [power(n, 0.45, p_tc, dpc, sims) for n in (20, 30, 40, 60)]
            print(f"| {dpc} | 0.45 -> {p_tc:.2f} | " + " | ".join(f"{r:.2f}" for r in res) + " |")
