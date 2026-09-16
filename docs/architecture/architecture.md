# TrustCode Architecture (as built, v0.1.0)

## 1. System context and components

```mermaid
flowchart LR
  Dev[Developer / Participant] -->|selects code, confirms consent| Ext[VS Code extension<br/>TypeScript, webview]
  Ext -->|HTTPS JSON, JWT| API[Backend API<br/>FastAPI]
  API --> DB[(PostgreSQL<br/>users, jobs, decisions,<br/>experiment_* tables)]
  W[Verification worker<br/>python -m app.worker_main] -->|claim job / store evidence| DB
  W -->|parse only| T1[ruff / Semgrep / node --check<br/>dependency registry lookup]
  W -->|docker run, stdin payload| SB[[Sandbox container<br/>no network, read-only FS,<br/>tests as uid 65534]]
  API -.->|optional, consented| LLM[Anthropic API<br/>grounded wording only]
  Res[Researcher] -->|admin CLI, CSV export| API
```

| Component | Code | Responsibility |
|---|---|---|
| VS Code extension | `extension/src/` | Selection capture (explicit command), consent prompt, submission, progress + cancel, evidence/explanation display, level switch, decision + confidence, feedback, privacy settings, study mode |
| Backend API | `backend/app/api/routes.py` | Auth (JWT + rotating refresh, local mode), validation, rate limiting, job lifecycle, explanation/adaptation, decisions, feedback, experiments, export, audit log |
| Verification engine | `verification-worker/trustcode_worker/` | Language detection, syntax, lint (ruff), security (Semgrep frozen ruleset), sandboxed tests + coverage gaps, dependency existence, normalised `VerificationResult` |
| Worker process | `backend/app/worker_main.py` | Polls DB queue, runs pipeline, purges code, expires results; the only process with Docker access |
| Explanation engine | `backend/app/explanations/` | Deterministic 3-level templates; optional LLM wording validated against evidence |
| Adaptation engine | `backend/app/adaptation/engine.py` | Explicit level from profile; collapse rule; opt-in suggestions, never auto-switch |
| Research analytics | `backend/app/experiments/service.py` | Counterbalancing, frozen evidence presentation, event capture, pseudonymous CSV export |

## 2. Main sequence: verify selected code

```mermaid
sequenceDiagram
  actor U as Developer
  participant E as Extension
  participant A as API
  participant D as DB
  participant W as Worker
  participant S as Sandbox
  U->>E: Verify Selected Code
  E->>U: Modal consent (lines, destination, LLM on/off)
  U-->>E: Send
  E->>A: POST /verifications {code, task?, tests?, client_consent:true}
  A->>D: insert job (queued, sha256)
  A-->>E: 202 {id}
  loop poll with back-off (1s→3s)
    E->>A: GET /verifications/{id}
  end
  W->>D: claim job (SKIP LOCKED / atomic update)
  W->>W: syntax → ruff → Semgrep → deps (parse only)
  W->>S: docker run --network none ... (stdin: code, tests, nonce)
  S-->>W: TRUSTCODE_RESULT_<nonce>=... (≤1 MB)
  W->>D: store evidence, purge code/tests, set expiry
  E->>A: GET /verifications/{id}/explanation?level=…
  A-->>E: checks + findings (7 fields) + not-verified list
  U->>E: Accept / Modify / Reject + confidence
  E->>A: POST /verifications/{id}/decision
```

## 3. Data flow and retention

| Data | Where | Retention |
|---|---|---|
| Source code, tests | `verification_jobs.code/tests` | Deleted immediately after analysis (tested: `test_code_purged_after_analysis`, deployment check) |
| Code hash, line count | `verification_jobs` | With the job |
| Evidence (incl. short code excerpts in findings) | `verification_jobs.result` | 24 h default; 30 days if the user enables history; then purged |
| Decisions, feedback | `decisions`, `feedback` | Until account deletion (`DELETE /me/data`) |
| Research data | `experiment_*` | Pseudonymous participant code only; separate tables; retention per ethics approval |
| Logs | stdout JSON | Method, path, status, duration, request id; **never bodies** |

## 4. ER diagram

```mermaid
erDiagram
  users ||--o| profiles : has
  users ||--o{ refresh_tokens : has
  users ||--o{ verification_jobs : submits
  verification_jobs ||--o{ decisions : receives
  users ||--o{ feedback : gives
  experiment_sessions ||--o{ experiment_trials : contains
  experiment_sessions ||--o{ experiment_events : logs
  experiment_sessions ||--o{ experiment_questionnaires : answers
  users { string id PK  string email  string password_hash  string role  bool is_local }
  verification_jobs { string id PK  string status  text code "purged"  json result  datetime expires_at }
  experiment_sessions { string id PK  string participant_code  json condition_order  json item_blocks  string adaptation }
  experiment_trials { string id PK  int position  string item_id  string condition  string decision  int confidence }
```
(No foreign key links research tables to `users`: research data cannot be joined to accounts.)

## 5. Deployment architecture

```mermaid
flowchart TB
  subgraph Host[Single host / VM]
    API[api container<br/>read-only FS, cap_drop ALL, non-root] --> DB[(postgres, internal network only)]
    WK[worker container] --> DB
    WK -->|/var/run/docker.sock| DD[Docker daemon]
    DD --> SB[[ephemeral sandbox containers]]
  end
  Ext[VS Code extension] -->|HTTPS via reverse proxy| API
```
Railway-style PaaS can host the API + managed PostgreSQL, but cannot run the Docker-based sandbox; the worker then
needs a separate VM (or `TRUSTCODE_RUN_TESTS=false`, which the UI reports honestly as "Not tested"). See `deployment/README.md`.

## 6. API specification
Generated from code: `docs/api/openapi.json` (21 paths). Error shape: `{"error": {"code", "message", "request_id"}}`;
pagination: `?limit&cursor` on `GET /verifications`; every response carries `X-Request-ID`.
