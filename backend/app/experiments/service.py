"""Experiment mode: benchmark loading, counterbalancing, trial presentation and export.

Design (research/experimental_protocol.md): within-subjects condition (baseline vs trustcode),
counterbalanced order x item-block assignment (4-cell Latin square), plus an exploratory
between-subjects adaptation factor (fixed vs adapted) within the TrustCode condition.
Evidence shown to participants is the FROZEN snapshot stored with each benchmark item,
so every participant sees identical evidence.
"""
from __future__ import annotations

import csv
import io
import json
import random
import secrets
from collections import Counter
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..adaptation.engine import AdaptationDecision
from ..config import get_settings
from ..explanations.engine import build_explanation
from ..models import ExperimentEvent, ExperimentSession, ExperimentTrial

SOFTWARE_VERSION = "trustcode-experiment 0.1.0"
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


@lru_cache
def load_items(benchmark_dir: str | None = None) -> dict[str, dict]:
    d = Path(benchmark_dir or get_settings().benchmark_dir)
    items = {}
    for p in sorted((d / "items").glob("*.json")):
        it = json.loads(p.read_text())
        items[it["id"]] = it
    return items


def eval_items() -> list[dict]:
    return [i for i in load_items().values() if i.get("split") == "eval"]


def new_participant_code() -> str:
    return "P-" + "".join(secrets.choice(_ALPHABET) for _ in range(8))


def create_session(db: Session, study_id: str) -> ExperimentSession:
    items = eval_items()
    if not items:
        raise ValueError("no evaluation-split benchmark items available")
    seq = db.scalar(select(func.count()).select_from(ExperimentSession).where(ExperimentSession.study_id == study_id)) or 0
    order = ["baseline", "trustcode"] if seq % 2 == 0 else ["trustcode", "baseline"]
    blocks = {"A": [i["id"] for i in items if i.get("block") == "A"], "B": [i["id"] for i in items if i.get("block") == "B"]}
    first, second = ("A", "B") if (seq // 2) % 2 == 0 else ("B", "A")
    s = ExperimentSession(participant_code=new_participant_code(), study_id=study_id, sequence_index=seq,
                          condition_order=order, item_blocks=[blocks[first], blocks[second]],
                          adaptation="fixed" if (seq // 4) % 2 == 0 else "adapted", software_version=SOFTWARE_VERSION)
    db.add(s)
    db.flush()
    pos = 0
    rng = random.Random(s.participant_code)  # reproducible per-participant order
    for cond, block in zip(order, s.item_blocks):
        ids = list(block)
        rng.shuffle(ids)
        for iid in ids:
            db.add(ExperimentTrial(session_id=s.id, position=pos, item_id=iid, condition=cond))
            pos += 1
    db.commit()
    return s


def present(trial: ExperimentTrial, session: ExperimentSession) -> dict:
    item = load_items()[trial.item_id]
    base = {"trial_id": trial.id, "position": trial.position, "condition": trial.condition, "language": item["language"],
            "task": item["task"], "code": item["code"], "tests": item.get("visible_tests")}
    if trial.condition == "baseline":
        base["assistant_explanation"] = item["baseline_explanation"]
        return base
    level = "intermediate" if session.adaptation == "fixed" else (session.experience_level or "intermediate")
    view = build_explanation(item["evidence_snapshot"], AdaptationDecision(level=level, reasons=[f"experiment:{session.adaptation}"]))
    base["assistant_explanation"] = item["baseline_explanation"]  # same AI explanation in both conditions
    base["evidence"] = view
    return base


def decision_correct(decision: str, ground_truth_correct: bool) -> int:
    accepted = decision == "accept"
    return int(accepted == ground_truth_correct)


def export_csv(db: Session, study_id: str | None = None) -> str:
    items = load_items()
    q = select(ExperimentSession)
    if study_id:
        q = q.where(ExperimentSession.study_id == study_id)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["participant_code", "study_id", "sequence_index", "software_version", "adaptation", "experience_level",
                "years_experience", "position", "condition", "item_id", "item_class", "language", "ground_truth_correct",
                "decision", "accepted", "decision_correct", "confidence", "time_ms", "n_evidence_expand",
                "n_unverified_view", "n_request_more_checks"])
    for s in db.scalars(q.order_by(ExperimentSession.sequence_index)):
        if not s.consent_at:
            continue  # never export data without recorded consent
        for t in db.scalars(select(ExperimentTrial).where(ExperimentTrial.session_id == s.id).order_by(ExperimentTrial.position)):
            it = items.get(t.item_id, {})
            gt = it.get("ground_truth", {}).get("correct")
            ev = Counter(e.type for e in db.scalars(select(ExperimentEvent).where(ExperimentEvent.trial_id == t.id)))
            ms = int((t.decided_at - t.shown_at).total_seconds() * 1000) if t.decided_at and t.shown_at else None
            w.writerow([s.participant_code, s.study_id, s.sequence_index, s.software_version, s.adaptation, s.experience_level,
                        s.years_experience, t.position, t.condition, t.item_id, it.get("class"), it.get("language"), gt,
                        t.decision, int(t.decision == "accept") if t.decision else None,
                        decision_correct(t.decision, gt) if t.decision and gt is not None else None,
                        t.confidence, ms, ev["evidence_expand"], ev["unverified_view"], ev["request_more_checks"]])
    return out.getvalue()
