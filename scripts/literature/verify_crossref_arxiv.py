"""Fallback verifier: Crossref (published works) + arXiv API (preprints).
Records the best title match from each source with a similarity score.
Usage: python3 verify_crossref_arxiv.py candidates.txt out.json"""
import difflib, json, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
UA = {"User-Agent": "trustcode-litreview/0.1"}
def norm(s): return re.sub(r"[^a-z0-9 ]", "", (s or "").lower())
def sim(a, b): return round(difflib.SequenceMatcher(None, norm(a), norm(b)).ratio(), 3)
def get(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except Exception as e:
            err = e; time.sleep(2 ** a + 1)
    raise err
def crossref(t):
    d = json.loads(get("https://api.crossref.org/works?" + urllib.parse.urlencode({"query.bibliographic": t, "rows": 5})))
    best = max(d["message"]["items"], key=lambda w: sim(t, (w.get("title") or [""])[0]), default=None)
    if not best: return None
    yr = (best.get("issued", {}).get("date-parts") or [[None]])[0][0]
    return {"source": "crossref", "similarity": sim(t, (best.get("title") or [""])[0]), "title": (best.get("title") or [""])[0],
            "year": yr, "doi": "https://doi.org/" + best["DOI"], "venue": (best.get("container-title") or [None])[0],
            "type": best.get("type"), "authors": [f"{a.get('given','')} {a.get('family','')}".strip() for a in best.get("author", [])],
            "abstract": re.sub(r"<[^>]+>", "", best.get("abstract") or "") or None}
def arxiv(t):
    q = re.sub(r"[^\w\s]", " ", t)
    x = get("http://export.arxiv.org/api/query?" + urllib.parse.urlencode({"search_query": f'ti:"{q}"', "max_results": 3}))
    ns = {"a": "http://www.w3.org/2005/Atom"}
    entries = ET.fromstring(x).findall("a:entry", ns)
    if not entries: return None
    e = max(entries, key=lambda e: sim(t, e.find("a:title", ns).text))
    title = " ".join(e.find("a:title", ns).text.split())
    return {"source": "arxiv", "similarity": sim(t, title), "title": title, "year": int(e.find("a:published", ns).text[:4]),
            "doi": None, "url": e.find("a:id", ns).text, "venue": "arXiv preprint", "type": "preprint",
            "authors": [a.find("a:name", ns).text for a in e.findall("a:author", ns)],
            "abstract": " ".join(e.find("a:summary", ns).text.split())}
recs = []
for t in [l.strip() for l in open(sys.argv[1]) if l.strip()]:
    rec = {"candidate": t}
    for name, fn in (("crossref", crossref), ("arxiv", arxiv)):
        try: rec[name] = fn(t)
        except Exception as e: rec[name] = {"error": str(e)}
        time.sleep(1.0 if name == "crossref" else 3.1)  # arXiv asks for >=3s between calls
    cands = [r for r in (rec["crossref"], rec["arxiv"]) if r and "similarity" in r]
    best = max(cands, key=lambda r: r["similarity"], default=None)
    rec["status"] = "VERIFIED" if best and best["similarity"] >= 0.85 else "UNVERIFIED"
    rec["best"] = best
    recs.append(rec)
    b = best or {}
    print(f"{rec['status']:10} {b.get('similarity','-'):>5} {b.get('year','')} [{b.get('source','')}] {(b.get('title') or t)[:80]} | {b.get('venue')} | {b.get('doi') or b.get('url')}")
json.dump(recs, open(sys.argv[2], "w"), indent=2, ensure_ascii=False)
