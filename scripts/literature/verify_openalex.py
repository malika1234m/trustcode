"""Verify candidate literature against OpenAlex (https://openalex.org).

For each candidate title, query OpenAlex and record the best match with a
title-similarity score, so that every citation in the review is traceable to a
real bibliographic record. Matches with similarity < 0.85 are flagged as
UNVERIFIED and must not be cited until checked manually.

Usage: python3 scripts/literature/verify_openalex.py candidates.txt out.json
"""
import difflib, json, re, sys, time, urllib.parse, urllib.request

API = "https://api.openalex.org/works"

def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower())

def abstract(inv):
    if not inv:
        return None
    pos = {}
    for word, idxs in inv.items():
        for i in idxs:
            pos[i] = word
    return " ".join(pos[i] for i in sorted(pos))

def query(title, retries=4):
    # OpenAlex search chokes on some punctuation; strip it for the query only.
    q = urllib.parse.urlencode({"search": re.sub(r"[^\w\s-]", " ", title), "per-page": 5})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": "trustcode-litreview/0.1"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)["results"]
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)

def main(inp, out):
    titles = [l.strip() for l in open(inp) if l.strip()]
    records = []
    for t in titles:
        try:
            res = query(t)
        except Exception as e:  # network errors are recorded, not hidden
            records.append({"candidate": t, "status": "ERROR", "error": str(e)})
            continue
        best, score = None, 0.0
        for w in res:
            s = difflib.SequenceMatcher(None, norm(t), norm(w.get("title"))).ratio()
            if s > score:
                best, score = w, s
        if not best:
            records.append({"candidate": t, "status": "NOT_FOUND"})
            continue
        src = ((best.get("primary_location") or {}).get("source") or {})
        records.append({
            "candidate": t,
            "status": "VERIFIED" if score >= 0.85 else "UNVERIFIED",
            "similarity": round(score, 3),
            "title": best.get("title"),
            "year": best.get("publication_year"),
            "doi": best.get("doi"),
            "venue": src.get("display_name"),
            "type": best.get("type"),
            "authors": [a["author"]["display_name"] for a in best.get("authorships", [])],
            "cited_by": best.get("cited_by_count"),
            "openalex_id": best.get("id"),
            "abstract": abstract(best.get("abstract_inverted_index")),
        })
        time.sleep(0.4)
    json.dump(records, open(out, "w"), indent=2, ensure_ascii=False)
    for r in records:
        print(f"{r['status']:10} {r.get('similarity','-'):>5} {r.get('year','')} | {(r.get('title') or r['candidate'])[:85]} | {r.get('venue')} | {r.get('doi')}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
