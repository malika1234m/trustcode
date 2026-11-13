// Single source of truth for what the website says TrustCode can do.
// Checked against extension 1.0.0, the local engine and the local scanner (docs/LOCAL_ENGINE_ARCHITECTURE.md,
// docs/security_scanner.md, docs/TRUSTCODE_TRUST_AND_PRIVACY.md) on 2026-11-13. Change a status only when the capability ships and
// has been tested — never because the marketing copy needs it.
//   available       implemented in the current extension / scanner
//   in-development  code exists in the repository but is not released or not finished
//   planned         researched or intended; no implementation yet

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
      { name: 'Whole-workspace scan', detail: 'The Security tab scans every included file in the project on your machine: source, configuration, environment files, manifests, CI workflows and agent settings.', status: 'available' },
      { name: 'Changed, new, staged and outgoing files', detail: 'Scan only what changed, files Git does not track yet, the staged content of a commit, or the files in outgoing commits.', status: 'available' },
      { name: 'Selection and file checks', detail: 'Verify selected code or the current file (Python, JavaScript, TypeScript) with the local engine on your computer.', status: 'available' },
      { name: 'Five languages', detail: 'Language-aware rules for Python, JavaScript, TypeScript, PHP and Java. Other text files get credential and configuration patterns only.', status: 'available' },
    ],
  },
  {
    group: 'Change monitoring',
    items: [
      { name: 'Workspace change tracking', detail: 'Notices files created, modified and deleted by any tool, including terminals and agents outside VS Code. Works without Git.', status: 'available' },
      { name: 'Automatic checks after changes', detail: 'Rescans once file changes settle. Unchanged files come from a content-hash cache.', status: 'available' },
      { name: 'Agent completion signal', detail: 'Any agent that can run a command when it finishes can tell TrustCode by writing a small signal file. Without it, TrustCode waits for changes to settle.', status: 'available' },
      { name: 'Ready-made hooks for each agent', detail: 'One-click hook set-up for Cursor, Codex, Gemini CLI, GitHub Copilot and others.', status: 'planned' },
    ],
  },
  {
    group: 'Security detection',
    items: [
      { name: 'Security pattern rules', detail: 'Rules mapped to CWE and OWASP: SQL and command injection, unsafe deserialization, weak cryptography and more.', status: 'available' },
      { name: 'Data-flow (taint) rules', detail: 'Follows request data into SQL, shell commands, file paths, URLs, templates and HTML output within a file.', status: 'available' },
      { name: 'Auth, JWT, CORS and cookie rules', detail: 'JWT verification disabled, wildcard CORS with credentials, insecure cookies, sensitive routes without a guard.', status: 'available' },
      { name: 'Credential formats in code', detail: 'Provider keys, private keys, credentials in URLs, with an optional second detector. Matches are redacted.', status: 'available' },
      { name: 'Environment and key files', detail: '.env files are checked on your machine, even when Git ignores them, and never sent anywhere.', status: 'available' },
      { name: 'Package existence check', detail: 'Optional, off by default: looks up imported package names on PyPI or npm. Without it, third-party imports are marked for review.', status: 'available' },
      { name: 'Known-vulnerable dependencies', detail: 'Dependency versions matched against published advisories. Opt-in: sends package names and versions only.', status: 'available' },
      { name: 'Docker, cloud and CI/CD configuration', detail: 'Dockerfiles, privileged Kubernetes workloads, wildcard IAM policies and risky GitHub Actions workflows.', status: 'available' },
      { name: 'Agent configuration files', detail: 'Agents allowed to run tools without approval, MCP server commands, auto-run hooks and hidden Unicode.', status: 'available' },
      { name: 'Removed safeguards', detail: 'Compared with the last commit: removed auth guards, skipped or deleted tests, removed ignore rules, weakened CI steps.', status: 'available' },
      { name: 'Cross-file analysis', detail: 'Follow data across files and modules.', status: 'planned' },
      { name: 'Route authorization checks', detail: 'Object-level access (IDOR), role escalation and rate limiting.', status: 'planned' },
    ],
  },
  {
    group: 'Workflow gates',
    items: [
      { name: 'Pre-commit checks', detail: 'A Git hook scans the staged content. It never replaces an existing hook.', status: 'available' },
      { name: 'Pre-push checks', detail: 'A Git hook scans the files in outgoing commits.', status: 'available' },
      { name: 'CI/CD integration', detail: 'CI and production modes with SARIF output; an incomplete scan blocks.', status: 'available' },
      { name: 'Severity-based blocking', detail: 'Choose which severity and confidence block a commit, push, CI run or production scan.', status: 'available' },
    ],
  },
  {
    group: 'Findings and privacy',
    items: [
      { name: 'Evidence and not-checked list', detail: 'Every finding shows file, exact range, rule and redacted evidence. Every report lists what was skipped and why.', status: 'available' },
      { name: 'Confidence levels', detail: 'Confirmed, strongly suspected or potential, separate from severity.', status: 'available' },
      { name: 'Reviews and baselines', detail: 'Mark a finding as a reviewed false positive (who, when, why) or accept existing findings as a baseline.', status: 'available' },
      { name: 'Analysis on your computer', detail: 'Security, Verify and Session run on your machine. Code is not uploaded and no account is needed.', status: 'available' },
      { name: 'Optional server analysis', detail: 'Choose trustcode.analysis.location = server to send selected code to the TrustCode server, after a consent dialog. Needs an account.', status: 'available' },
      { name: 'Copy a fix prompt for your agent', detail: 'Hand findings back to your coding agent as a ready-made prompt.', status: 'available' },
    ],
  },
];

export function statusOf(name: string): Status {
  for (const g of ROADMAP) for (const c of g.items) if (c.name === name) return c.status;
  throw new Error(`Unknown capability: ${name}`);
}
