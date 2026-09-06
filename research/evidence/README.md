# Literature evidence (reproducibility)

Raw outputs from the reference verification pipeline. Nothing in this folder is hand-edited.

| File | Produced by | Content |
|---|---|---|
| `openalex_round1.json`, `openalex_round2.json` | `scripts/literature/verify_openalex.py` | Best OpenAlex match per candidate title, similarity score, abstract |
| `openalex_round3.json` | same | Failed run: OpenAlex daily quota exhausted (HTTP 429). Kept as an honest record |
| `openalex_discovery.json` | `scripts/literature/discover_openalex.py` | Keyword discovery results, 2023+ |
| `crossref_arxiv_round3..5.json` | `scripts/literature/verify_crossref_arxiv.py` | Crossref + arXiv fallback verification |
| `metadata_cache.json` | `scripts/literature/build_outputs.py` | Authoritative metadata fetched by DOI / arXiv id, used to generate `references.bib` and `paper_comparison.csv` |

Verification rule: a reference is cited only if its DOI resolves on Crossref or its arXiv id resolves on the arXiv API. Title similarity ≥ 0.85 was required during candidate screening.

To rebuild:

```bash
python3 scripts/literature/build_outputs.py   # exits 1 if any identifier fails to resolve
```

Web searches (2026-11-03) used for discovery are summarised in `research/literature_review.md` §0. Search-engine snippets are not stored, because they are not stable evidence.
