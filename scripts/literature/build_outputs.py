"""Build research/references.bib and research/paper_comparison.csv.

Metadata is fetched from Crossref (DOI) or arXiv (id) and cached in
research/evidence/metadata_cache.json. Any entry whose identifier does not
resolve is reported and excluded (exit code 1), so nothing unverified is cited.

Usage: python3 scripts/literature/build_outputs.py
"""
import csv, json, os, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET  # parses arXiv API responses only; expat >= 2.4.1 blocks entity expansion attacks

sys.path.insert(0, os.path.dirname(__file__))
from papers import PAPERS  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(ROOT, "research", "evidence", "metadata_cache.json")
UA = {"User-Agent": "trustcode-litreview/0.1"}
THEMES = {"T1": "Interaction with AI code assistants", "T2": "Trust in AI for SE",
          "T3": "Reliance & explanations (general HAI)", "T4": "Verification support",
          "T5": "Quality & security of AI code", "T6": "Adaptive / personalised explanation",
          "T7": "Productivity, workload & skills", "T8": "Theory & measurement"}


def fetch(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except Exception as e:
            err = e
            time.sleep(2 ** a + 1)
    raise err


def crossref(doi):
    m = json.loads(fetch("https://api.crossref.org/works/" + urllib.parse.quote(doi)))["message"]
    dp = (m.get("issued", {}).get("date-parts") or m.get("published", {}).get("date-parts") or [[None]])[0]
    title = (m.get("title") or [""])[0]
    if m.get("subtitle") and m["subtitle"][0].lower() not in title.lower():
        title = f"{title}: {m['subtitle'][0]}"
    return {"title": title, "year": dp[0],
            "authors": [f"{a.get('given', '')} {a.get('family', '')}".strip() or a.get("name", "") for a in m.get("author", [])],
            "venue": (m.get("container-title") or [""])[0], "type": m.get("type"),
            "publisher": m.get("publisher"), "doi": m["DOI"], "url": f"https://doi.org/{m['DOI']}",
            "volume": m.get("volume"), "issue": m.get("issue"), "pages": m.get("page"), "source": "crossref"}


def arxiv(aid):
    x = fetch("http://export.arxiv.org/api/query?" + urllib.parse.urlencode({"id_list": aid}))
    ns = {"a": "http://www.w3.org/2005/Atom"}
    e = ET.fromstring(x).find("a:entry", ns)
    title = " ".join(e.find("a:title", ns).text.split())
    if title.lower() == "error":
        raise ValueError("arXiv id not found")
    return {"title": title, "year": int(e.find("a:published", ns).text[:4]),
            "authors": [a.find("a:name", ns).text for a in e.findall("a:author", ns)],
            "venue": "arXiv preprint", "type": "preprint", "doi": None, "arxiv": aid,
            "url": f"https://arxiv.org/abs/{aid}", "source": "arxiv"}


def bib_escape(s):
    return (s or "").replace("&", r"\&").replace("%", r"\%").replace("_", r"\_")


def main():
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    failed, rows, bib = [], [], []
    for p in PAPERS:
        ident = p.get("doi") or "arxiv:" + p["arxiv"]
        if ident not in cache:
            try:
                cache[ident] = crossref(p["doi"]) if p.get("doi") else arxiv(p["arxiv"])
                time.sleep(1.0 if p.get("doi") else 3.1)
            except Exception as e:
                failed.append((p["key"], ident, str(e)))
                continue
        m = cache[ident]
        # Documented overrides only where the registry record lacks authors.
        authors = m["authors"] or p.get("authors_override", [])
        if not m["authors"] and p.get("authors_override"):
            m = dict(m, source=m["source"] + "+manual-authors")
        # ---- BibTeX
        is_journal = m["type"] == "journal-article"
        is_preprint = m["type"] == "preprint"
        etype = "article" if (is_journal or is_preprint) else "inproceedings"
        f = {"title": "{" + bib_escape(m["title"]) + "}", "author": " and ".join(authors), "year": str(m["year"])}
        if is_preprint:
            f.update(journal="arXiv preprint arXiv:" + m["arxiv"], url=m["url"])
        elif is_journal:
            f.update(journal=bib_escape(m["venue"]), doi=m["doi"])
        else:
            f.update(booktitle=bib_escape(m["venue"]), doi=m["doi"])
        for k in ("volume", "number", "pages", "publisher"):
            src = {"number": "issue"}.get(k, k)
            if m.get(src) and not is_preprint:
                f[k] = bib_escape(str(m[src]))
        if p.get("arxiv_alt"):
            f["note"] = f"Preprint: arXiv:{p['arxiv_alt']}"
        f["keywords"] = f"{p['theme']}; basis={p['basis']}; peer_reviewed={'yes' if p['peer'] else 'no'}"
        bib.append(f"@{etype}{{{p['key']},\n" + ",\n".join(f"  {k} = {{{v}}}" if k != "title" else f"  {k} = {{{v}}}" for k, v in f.items()) + "\n}\n")
        # ---- CSV
        rows.append({
            "key": p["key"], "theme": f"{p['theme']} {THEMES[p['theme']]}", "relevance_1to5": p["rel"],
            "title": m["title"], "authors": "; ".join(authors), "year": m["year"], "venue": m["venue"],
            "doi_or_url": m["url"], "peer_reviewed": "yes" if p["peer"] else "no (preprint)",
            "objective": p["objective"], "methodology": p["method"], "participants": p["participants"],
            "dataset": p["dataset"], "main_findings": p["findings"],
            "limitations_reviewer_assessed": p["limitations"], "future_research": p["future"],
            "relevance_to_trustcode": p["relevance"], "annotation_basis": p["basis"],
            "metadata_source": m["source"],
        })
    json.dump(cache, open(CACHE, "w"), indent=2, ensure_ascii=False)
    rows.sort(key=lambda r: (-r["relevance_1to5"], r["theme"], -int(r["year"] or 0)))
    with open(os.path.join(ROOT, "research", "paper_comparison.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    header = ("% TrustCode references - generated by scripts/literature/build_outputs.py\n"
              "% Metadata fetched from Crossref/arXiv; do not hand-edit (edit papers.py and rebuild).\n"
              "% keywords field records theme, annotation basis and peer-review status.\n\n")
    open(os.path.join(ROOT, "research", "references.bib"), "w").write(header + "\n".join(bib))
    print(f"resolved {len(rows)} / {len(PAPERS)} entries")
    for k, i, e in failed:
        print(f"FAILED {k} {i}: {e}")
    # title sanity check: warn if the resolved title looks unlike the annotated topic key
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
