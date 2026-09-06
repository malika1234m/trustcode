# TrustCode — Phase 1 Literature Review

**Status:** Draft v0.1 (Phase 1), 2026-11-03. For supervisor review.
**Scope:** Human–AI interaction in software engineering, with emphasis on 2021–2026 work on trust, reliance, verification and explanation for AI-generated code.
**Citations:** `[key]` refers to entries in `research/references.bib`. Final dissertation will render these in IEEE style.

---

## 0. How this review was conducted (and its limits)

This is a **structured narrative review**, not yet a systematic review. Being explicit about the method matters for the dissertation's validity section.

| Step | What was done | Evidence |
|---|---|---|
| Seed set | 60 candidate titles from domain knowledge (HCI, SE, security venues) | `scripts/literature/candidates*.txt` |
| Bibliographic verification | Every candidate was matched against OpenAlex, Crossref and/or the arXiv API; title similarity ≥ 0.85 required | `research/evidence/openalex_round*.json`, `crossref_arxiv_round*.json` |
| Discovery search | 12 keyword queries on OpenAlex (2023–2026) + targeted web searches for 2025–2026 work | `research/evidence/openalex_discovery.json` |
| Metadata for citation | Fetched by DOI from Crossref or by id from arXiv; nothing typed by hand except two documented author overrides | `scripts/literature/build_outputs.py`, `research/evidence/metadata_cache.json` |
| Annotation | Written from **abstracts** (and landing pages for a few 2026 preprints) | `annotation_basis` column in `paper_comparison.csv` |

**Limitations of this review (must be addressed before Chapter 2 is final):**

1. **Abstract-level reading.** Full texts were not read. Findings below are stated at the level of detail the abstracts support. The 12 papers marked ★ in §8 must be read in full.
2. **Database coverage.** IEEE Xplore, ACM DL, Scopus and Web of Science were not queried directly (they need institutional access). OpenAlex and Crossref index most ACM/IEEE content, but a **Scopus or Web of Science search through your university library** is needed before the review can be called systematic. A search string is proposed in §9.
3. **Five entries were annotated without an abstract** (`annotation_basis` = `title` or `snippet`: `fan2026whenhelp`, `brown2024factors`, `tambon2025bugs`, `schemmer2022meta`, `lewis2018sus`). The first four are cited only for their existence and topic until read. Eight classic works (`prior`) were annotated from reviewer knowledge and should be checked against the full text.
4. **Preprints.** 16 of 84 entries are arXiv preprints (marked in the CSV). Several 2026 preprints are central to the gap argument; their status must be re-checked before submission.

**Corpus summary:** 84 verified references; 74 from 2021 or later (31 from 2025–2026); 67 annotated from abstracts.

---

## 1. Context: verification has become the developer's main job with AI

AI coding assistants change programming from writing code to inspecting it. Early usability studies found that Copilot did not necessarily improve completion time or success, and participants struggled to understand, edit and debug generated code [vaithilingam2022expectation]. Grounded-theory work describes two interaction modes, *acceleration* and *exploration* [barke2023grounded]. Telemetry-informed modelling shows that a substantial share of session time goes into verifying suggestions [mozannar2024reading]. A survey of 410 developers found that a main reason for not using these tools is that the output fails functional or non-functional requirements [liang2024survey].

Longitudinal evidence suggests the shift is lasting. In a six-month two-wave survey, engineers reported a move from creation to verification, which the authors call "supervisory engineering work". The share reporting a worse developer experience in at least one dimension nearly doubled, from 14% to 27% [vella2026longitudinal]. Productivity evidence is mixed. Field RCTs at three companies with 4,867 developers estimated a 26.08% increase in completed tasks, with larger gains for less experienced developers [cui2026effects]. A small RCT with experienced open-source developers found AI *increased* completion time by 19%, even though developers believed it reduced time by 20% [becker2025measuring]. A 2026 systematic review concludes that whether LLM assistants improve or degrade code quality "remains unresolved" [mohamed2026productivity].

**Implication for TrustCode:** the bottleneck is human verification, not code generation, and developers' self-perceptions of AI benefit are unreliable. TrustCode should therefore be evaluated with behavioural measures, not only self-report.

## 2. AI-generated code is often wrong, insecure, or hallucinated

There are many reasons for developers to verify generated code:

- **Functional correctness is overestimated by weak tests.** EvalPlus expanded HumanEval's tests 80× and found much previously undetected wrong code, reducing pass@k by up to 19.3–28.9% [liu2023evalplus]. *Passing a few tests is weak evidence.*
- **Security.** About 40% of 1,689 Copilot programs in CWE-relevant scenarios were vulnerable [pearce2022asleep]. In real GitHub projects, 29.5% of Python and 24.2% of JavaScript AI-generated snippets had security weaknesses across 43 CWE categories [fu2025weaknesses].
- **Hallucination.** Package hallucination rates averaged at least 5.2% for commercial and 21.7% for open-source models [spracklen2024package]. Taxonomies cover mapping, naming, resource and logic hallucinations [tian2025codehalu], and repository-level hallucinations [zhang2025hallucinations].
- **Fluent text hides errors.** 52% of ChatGPT answers to 517 Stack Overflow questions contained incorrect information, yet study participants overlooked the misinformation 39% of the time [kabir2024stackoverflow].
- **Verification tools disagree with each other.** A 2026 C++ study found that static analysis flags warnings without confirming runtime violations, and that verification tiers diverge [mahmud2026illusion].

**Implication:** no single automated check establishes correctness. This justifies TrustCode's rule that each check is reported with its own status and scope, and that checks are never collapsed into one "correctness %".

## 3. Humans do not reliably catch these problems

The key human-factors finding is **miscalibration**. In a user study on security tasks, participants with an AI assistant wrote significantly less secure code *and* were more likely to believe it was secure [perry2023insecure]. The effect depends on the task: a study of 58 students writing low-level C found that AI-assisted users produced critical security bugs at a rate no more than 10% above control [sandoval2023lostatc]. Interviews show professionals use AI for security-critical work despite their concerns [klemmer2024security]. Observed sessions show security thinking moving from *writing* to *reviewing* code; no participant stated security requirements in their prompts [bappy2026preventive]. Without explicit labels, developers often cannot tell that code is LLM-generated [tang2024eyetracking].

Automation research predicts this. **Automation bias and complacency** arise from how attention is allocated and affect experts as well as novices [parasuraman2010complacency]. Misuse (over-reliance) and disuse (under-reliance) are distinct failures [parasuraman1997humans]. Trust should be *calibrated*: it should match the automation's actual capability, with good *resolution* across situations [lee2004trust].

## 4. What is "trust" — and why acceptance rate is the wrong measure

Developers' trust in AI code tools rests on perceived ability, integrity and benevolence, and it depends on the situation. Current tools lack affordances that let developers judge trustworthiness efficiently [wang2024trust]. Community signals also shape trust [cheng2024itwould]. Frameworks such as PICSE list trust factors for software tools [johnson2023picse]. A 2026 TOSEM model shows that **cognitive style** shapes engagement: for example, risk-averse developers gate outputs behind tests [choudhuri2026attention]. A TOSEM review found that trust, distrust and trustworthiness lack precise definitions in LLM4SE and that trust metrics "remain undeveloped" [khati2025mapping].

A 2026 TSE critical review shows that SE research often **equates trust with acceptance of generated content** and argues this is conceptually inadequate [baltes2026rethink]. Industry productivity metrics show why the shortcut is tempting: acceptance rate drives perceived productivity [ziegler2022productivity], and acceptance can be predicted from features unrelated to correctness [jiang2026predicting].

**Implication (methodological, central to TrustCode):** TrustCode must measure three separate constructs:
1. **Trust**, an attitude (questionnaire, e.g., [jian2000foundations], [hoffman2023measures]).
2. **Reliance**, a behaviour (accept/modify/reject).
3. **Calibration**, how well reliance and confidence match ground-truth correctness (e.g., Appropriateness of Reliance [schemmer2023appropriate]; Brier score [brier1950verification]).

Acceptance rate on its own is never a trust measure.

## 5. Explanations: helpful, but they can *increase* over-reliance

This is the most important body of evidence for TrustCode's design.

- Explanations increased the chance that people accept AI recommendations **regardless of correctness**, without improving complementary performance [bansal2021whole].
- In a pre-registered study with 308 participants, LLM explanations increased reliance on **both correct and incorrect** answers. **Sources** and visible **inconsistencies** reduced reliance on incorrect answers [kim2025fostering].
- Longer LLM explanations raised user confidence **without** improving accuracy. Users overestimate LLM accuracy when given default explanations [steyvers2025know].
- Explanations reduce over-reliance when they **lower the cost of verifying** the AI. People engage with explanations strategically, based on costs and benefits [vasconcelos2023explanations].
- Cognitive forcing functions reduced over-reliance but were rated least favourably [bucinca2021trust].
- In a 400-participant benchmark, reliance interventions reduced over-reliance but **generally failed to improve appropriate reliance**. People became more confident after *wrong* reliance decisions [bo2025rely].
- First-person uncertainty expressions ("I'm not sure, but…") reduced agreement and increased accuracy [kim2024notsure]. Using both human and AI correctness likelihood promoted more appropriate trust than AI confidence alone [ma2023whotrust], [zhang2020confidence].

These studies use non-code decision tasks. That is a transfer gap TrustCode can address, but it also means their effect sizes should not be assumed to carry over.

**Implication:** a TrustCode built around *rich LLM explanations* is at real risk of making over-reliance worse. The literature points to **checkable evidence** (analogous to "sources"), **explicit uncertainty**, and **lower verification cost** as the mechanisms that help. This changes the emphasis of the original proposal from "adaptive explanation" to **"tool-grounded evidence, with adaptation as a presentation layer"**.

## 6. Interfaces for verifying AI-generated code (closest prior work)

| Work | Mechanism | Evaluation | What it leaves open |
|---|---|---|---|
| Live Programming for validation [ferdowsi2024live] | Continuous display of runtime values | Between-subjects, N=17; mitigated over- and under-reliance; reduced validation load for some tasks | Runtime values only; no static or security evidence; small N; calibration not quantified against a defect benchmark |
| Uncertainty highlighting [vasconcelos2025generation] | Highlight likely-to-be-edited tokens vs low-probability tokens | N=30; edit-likelihood highlighting helped; raw generation probability did not | Model-internal signal, not verification evidence |
| Ivie [yan2024ivie] | Anchored LLM explanations of just-generated code | Lab study; improved understanding | Explanations are themselves unverified; outcome is understanding, not decision correctness |
| Trust-calibrated code review [heander2026trustcalibrated] | Participatory design: risk-per-line/file, judge, security cage | 17 + 7 practitioners; survey N=43 (self-reported expectations) | No behavioural evaluation; preprint |
| XAI in AI code review [gao2026xai] | Three explanation levels for LLM review comments | Within-subjects N=34; explanation level changed trust and agreement; full explanation → highest trust, not highest agreement | Explanations are LLM-generated; abstract reports no correctness-conditioned reliance |
| DeepVulGuard [steenhoek2025closing] | IDE vulnerability detection + LLM explanations | Field study, 17 Microsoft developers | High false positives undermined usefulness; qualitative |
| Design probe for trust [wang2024trust] | Suggestion quality indicators, usage stats, control mechanisms | Design probe, N=12 | Concepts not built or measured |
| Verification of AI data analyses [gu2024analysts] | NL explanations + code + tables | Qualitative, N=22 | Adjacent domain |

Position and vision papers explicitly call for this kind of system: trust-calibrating UIs backed by safeguards for AI refactoring [borg2024ide]; "comprehensive verification mechanisms and principled measures of human–agent interaction quality" [wang2026humans]; and a reliance–control framework linking control level to over- or under-reliance [ferino2026reliancecontrol]. Static-analysis research adds a design constraint: false positives and poorly presented warnings drive developers away [johnson2013whydont], and tools succeed only when their messages are actionable and integrated into the workflow [sadowski2018lessons].

## 7. Adaptive and personalised explanation for developers

There is now direct prior art for expertise-adaptive explanation in the IDE:

- **TARS** (ICSME 2026 tool demo, preprint) is a VS Code agent that profiles expertise, role and style and adapts explanation depth and tone. In a controlled experiment with 18 participants on Java code comprehension, users were 26% faster and reported lower cognitive load [todisco2026tars].
- **Persona-aware code-review explanations**: preferences vary by problem-solving style, experience and role. Developers valued depth, learning support and risk awareness over conciseness; this is preliminary work [cynthia2026persona].
- Mental-model elicitation with 56 developers shows a need to customise explanation content and granularity [desolda2025mental]. Explainability needs for generative AI for code were elicited in workshops with 43 engineers [sun2022explainability].
- A CHI 2026 paper reports verification load and fatigue across interaction modes. According to search snippets, which still need confirming against the full text, effects differ between novices and experienced developers [fan2026whenhelp].
- Novices are disproportionately exposed: they adopt more and gain more productivity [cui2026effects], yet AI use can impair conceptual understanding and debugging skill unless the interaction keeps them cognitively engaged [shen2026skill], [prather2023weird].

**Implication:** "adapting explanations to developer expertise" is **not novel on its own** (TARS, persona-aware review). What remains open is (a) whether adaptation helps or harms **calibrated reliance during verification**, given that longer explanations inflate confidence [steyvers2025know], and (b) adaptation that changes **presentation only, while keeping the evidence identical**. No reviewed work tests this.

## 8. Synthesis

1. **Agreement:** trust calibration, not trust maximisation, is the central problem for AI code ([heander2026trustcalibrated], [wang2024trust], [borg2024ide], [wang2026humans]).
2. **Agreement:** explanations alone do not reliably improve appropriate reliance and can worsen it ([bansal2021whole], [kim2025fostering], [steyvers2025know], [bo2025rely]).
3. **Promising mechanism:** making verification cheaper or more checkable improves reliance ([ferdowsi2024live], [vasconcelos2023explanations], [kim2025fostering] sources).
4. **Measurement gap:** SE studies conflate trust with acceptance, and trust metrics are undeveloped ([baltes2026rethink], [khati2025mapping]).
5. **Open risk:** automation complacency predicts that "all checks passed" signals could *increase* acceptance of defects the checks cannot detect [parasuraman2010complacency]. No reviewed code study tests this.

★ **Must read in full before Phase 2 sign-off:** `ferdowsi2024live`, `gao2026xai`, `heander2026trustcalibrated`, `fan2026whenhelp`, `todisco2026tars`, `kim2025fostering`, `bo2025rely`, `wang2024trust`, `vasconcelos2025generation`, `baltes2026rethink`, `schemmer2023appropriate`, `perry2023insecure`.

## 9. Proposed systematic search string (to run in Scopus / WoS via the library)

```
TITLE-ABS-KEY( ("AI-generated code" OR "code generation" OR "AI coding assistant*" OR "programming assistant*"
   OR copilot OR "LLM-generated code" OR "code LLM*")
 AND (trust* OR relian* OR overrelian* OR "automation bias" OR calibrat* OR verif* OR validat* OR explanat*)
 AND ("user study" OR experiment* OR participant* OR developer*) )
 AND PUBYEAR > 2020
```

Inclusion: empirical or design studies of human verification, trust or reliance with AI-generated code; or HAI reliance studies with transferable mechanisms. Exclusion: model-only benchmarks without human or interaction relevance (keep as background only). Record PRISMA-style counts in `research/evidence/`.
