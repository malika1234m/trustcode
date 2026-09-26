"""Vercel entry point: exposes the TrustCode FastAPI app as a Python serverless function."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "verification-worker")]
os.environ.setdefault("TRUSTCODE_BENCHMARK_DIR", os.path.join(ROOT, "datasets", "benchmark"))

from app.main import app  # noqa: E402,F401
