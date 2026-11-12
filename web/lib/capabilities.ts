// Single source of truth for what the website says TrustCode can do.
// Status was checked against the extension (extension/package.json 0.6.0, extension/src/session) and the
// verification worker (verification-worker/trustcode_worker) on 2026-11-12. Change a status only when the
// capability ships and has been tested — never because the marketing copy needs it.
//   available       implemented in the released extension / engine
//   in-development  code exists in the repository but is not released or not finished
//   planned         researched (docs/AI_AGENT_SECURITY_RESEARCH.md) or intended; no implementation yet

export type Status = 'available' | 'in-development' | 'planned';

export const STATUS_LABEL: Record<Status, string> = {
  available: 'Available',
  'in-development': 'In development',
  planned: 'Coming soon',
};

export const STATUS_HELP: Record<Status, string> = {
  available: 'Implemented in the current release.',
  'in-development': 'Being built. Not in the current release.',
  planned: 'Researched or intended for a future release.',
};

export type Capability = { name: string; detail: string; status: Status };

/** Roadmap, grouped. Every other section links back to these statuses. */
export const ROADMAP: { group: string; items: Capability[] }[] = [
  {
    group: 'Scanning scope',
    items: [
      { name: 'Selection and file checks', detail: 'Check selected code or the current file from the editor.', status: 'available' },
      { name: 'Whole-workspace scan', detail: 'Scan the files in the workspace, up to a configurable limit (200 by default). Files over the limit are listed as not analysed.', status: 'available' },
      { name: 'Git-changed files and chosen files', detail: 'Scan only what Git reports as changed, or a set of files you pick.', status: 'available' },
      { name: 'Java and PHP rules', detail: 'Rule sets for Java and PHP projects. Python, JavaScript and TypeScript are supported today.', status: 'in-development' },
    ],
  },
  {
    group: 'Change monitoring',
    items: [
      { name: 'Workspace change tracking', detail: 'Records files created, modified and deleted during a session, including edits made outside VS Code. Works without Git.', status: 'available' },
      { name: 'Automatic checks after changes', detail: 'Check session changes on save, after a batch of changes, after inactivity or when a session ends.', status: 'available' },
      { name: 'Agent completion signal', detail: 'A hook that tells TrustCode an agent has finished. Set up for Claude Code today.', status: 'available' },
      { name: 'Completion signals for more agents', detail: 'Hooks for Cursor, Codex, Gemini CLI, GitHub Copilot and others.', status: 'planned' },
      { name: 'Commits made by agents', detail: 'Check changes that agents such as Aider commit on their own.', status: 'planned' },
    ],
  },
  {
    group: 'Security detection',
    items: [
      { name: 'Security pattern rules', detail: 'Semgrep rules mapped to CWE and OWASP: SQL and command injection, unsafe deserialization, weak hashing and more.', status: 'available' },
      { name: 'Credential formats in code', detail: 'Known key formats such as AWS, GitHub, Stripe, Google, OpenAI and Anthropic keys, and private-key blocks. Matches are masked.', status: 'available' },
      { name: 'Package existence check', detail: 'Flags imported packages that cannot be found on PyPI or npm, a sign of a hallucinated dependency.', status: 'available' },
      { name: 'Data-flow (taint) rules', detail: 'Follows user input into SQL, shell, file paths, URLs (SSRF), templates and HTML output.', status: 'in-development' },
      { name: 'Auth, JWT, CORS and cookie rules', detail: 'JWT verification disabled, wildcard CORS with credentials, insecure session cookies, sensitive routes without middleware.', status: 'in-development' },
      { name: 'Environment and key files', detail: 'Checking .env and key files locally, without sending them anywhere. Today they are excluded from checks by default.', status: 'planned' },
      { name: 'Known-vulnerable dependencies', detail: 'Match dependency versions against public advisories (OSV).', status: 'planned' },
      { name: 'Docker, cloud and CI/CD configuration', detail: 'Dockerfiles, Kubernetes, Terraform and GitHub Actions workflows.', status: 'planned' },
      { name: 'Agent configuration files', detail: 'Warn when agent or editor settings that can run commands are changed (.vscode/settings.json, MCP configs, agent hooks).', status: 'planned' },
      { name: 'Removed safeguards', detail: 'Compare before and after to catch removed auth checks, skipped tests and new scanner suppressions.', status: 'planned' },
      { name: 'Cross-file analysis', detail: 'Follow data across files and modules.', status: 'planned' },
    ],
  },
  {
    group: 'Workflow gates',
    items: [
      { name: 'Pre-commit checks', detail: 'Check staged changes before a commit.', status: 'planned' },
      { name: 'Pre-push checks', detail: 'Check outgoing changes against your policy before a push.', status: 'planned' },
      { name: 'CI/CD integration', detail: 'Run the same checks in a pipeline and publish results as SARIF.', status: 'planned' },
      { name: 'Severity-based blocking', detail: 'Choose which severities block a commit, push or deployment.', status: 'planned' },
    ],
  },
  {
    group: 'Findings and privacy',
    items: [
      { name: 'Evidence and not-checked list', detail: 'Every finding shows file, line, rule and reason. Anything no check covered is listed.', status: 'available' },
      { name: 'Copy a fix prompt for your agent', detail: 'Hand the findings back to your coding agent as a ready-made prompt.', status: 'available' },
      { name: 'Local mode', detail: 'Run the TrustCode backend on your own machine, with no account.', status: 'available' },
      { name: 'Confidence levels', detail: 'Label each finding Confirmed, Strongly suspected or Potential, separately from severity.', status: 'planned' },
      { name: 'Scanning entirely inside the editor', detail: 'Run the checks in VS Code with nothing sent to a server.', status: 'planned' },
    ],
  },
];

export function statusOf(name: string): Status {
  for (const g of ROADMAP) for (const c of g.items) if (c.name === name) return c.status;
  throw new Error(`Unknown capability: ${name}`);
}
