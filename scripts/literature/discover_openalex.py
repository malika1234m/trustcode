"""Discovery search over OpenAlex for recent (>= FROM_DATE) work on a set of
queries. Saves raw results so the screening step is reproducible.
Usage: python3 discover_openalex.py queries.txt out.json [from_date]"""
import json, sys, time, urllib.parse, urllib.request
API = "https://api.openalex.org/works"
def run(q, from_date):
    params = {"search": q, "per-page": 12,
              "filter": f"from_publication_date:{from_date}"}
    url = f"{API}?{urllib.parse.urlencode(params)}"
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "trustcode-litreview/0.1"}), timeout=30) as r:
                return json.load(r)["results"]
        except Exception:
            time.sleep(2 ** a)
    return []
qs = [l.strip() for l in open(sys.argv[1]) if l.strip()]
fd = sys.argv[3] if len(sys.argv) > 3 else "2023-01-01"
out = {}
for q in qs:
    res = run(q, fd)
    out[q] = [{"title": w["title"], "year": w["publication_year"], "doi": w.get("doi"),
               "venue": ((w.get("primary_location") or {}).get("source") or {}).get("display_name"),
               "cited_by": w.get("cited_by_count")} for w in res]
    print(f"\n## {q}")
    for w in out[q]:
        print(f"  {w['year']} [{w['cited_by']}] {w['title'][:110]} | {w['venue']} | {w['doi']}")
    time.sleep(0.4)
json.dump(out, open(sys.argv[2], "w"), indent=2, ensure_ascii=False)
