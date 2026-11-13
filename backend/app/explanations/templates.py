"""Explanation templates live in the engine package so the local engine and the server produce the same text."""
from trustcode_worker.present.templates import *  # noqa: F401,F403
from trustcode_worker.present.templates import GUIDANCE, LEVELS, explain_check, explain_finding, explain_unverified

__all__ = ["GUIDANCE", "LEVELS", "explain_check", "explain_finding", "explain_unverified"]
