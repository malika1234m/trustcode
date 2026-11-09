// Walkthrough scenarios for the landing page. Each one is taken from TrustCode's benchmark of AI-style code and
// shows the outcome the real checks report for it. The page labels the demo as a simulation.

export type CheckId = 'syntax' | 'lint' | 'security' | 'deps' | 'tests';
export type Status = 'clean' | 'issue' | 'not_tested' | 'review';

export type Scenario = {
  id: string;
  tab: string;
  file: string;
  language: 'Python' | 'JavaScript' | 'TypeScript';
  code: string[];
  /** 1-based line numbers. */
  issueLines: number[];
  /** Lines no check could vouch for (shown hatched). */
  unverifiedLines: number[];
  checks: Record<CheckId, { status: Status; detail: string }>;
  headline: string;
  notVerified: string[];
  selfHosted?: boolean;
};

export const CHECKS: { id: CheckId; label: string; tool: string }[] = [
  { id: 'syntax', label: 'Syntax', tool: 'Parser' },
  { id: 'lint', label: 'Static analysis', tool: 'Ruff / Pyflakes' },
  { id: 'security', label: 'Security patterns', tool: 'Semgrep, 21 rules' },
  { id: 'deps', label: 'Dependencies', tool: 'PyPI / npm registry' },
  { id: 'tests', label: 'Tests', tool: 'Sandbox' },
];

export const SCENARIOS: Scenario[] = [
  {
    id: 'sql',
    tab: 'Query built from input',
    file: 'find_user.py',
    language: 'Python',
    code: [
      'import sqlite3',
      '',
      'def find_user(conn, username):',
      '    query = f"SELECT id, username FROM users WHERE username = \'{username}\'"',
      '    return conn.execute(query).fetchone()',
    ],
    issueLines: [4],
    unverifiedLines: [3, 4, 5],
    checks: {
      syntax: { status: 'clean', detail: 'Parsed without errors.' },
      lint: { status: 'clean', detail: 'No findings within scope.' },
      security: { status: 'issue', detail: 'Line 4: SQL built from user input with an f-string (CWE-89). Use a parameterised query.' },
      deps: { status: 'clean', detail: 'sqlite3 is in the standard library.' },
      tests: { status: 'not_tested', detail: 'No tests were supplied, so behaviour was not run.' },
    },
    headline: '1 issue detected, 1 check not run',
    notVerified: ['What happens at runtime: no tests were supplied', 'Whether the code does what you asked for'],
  },
  {
    id: 'test',
    tab: 'Edge case in a test',
    file: 'last_items.py',
    language: 'Python',
    code: [
      'def last_items(items, n):',
      '    """Return the last n items of a list."""',
      '    return items[-n:]',
      '',
      '# supplied test',
      'def test_zero():',
      '    assert last_items([1, 2, 3], 0) == []',
    ],
    issueLines: [3],
    unverifiedLines: [],
    checks: {
      syntax: { status: 'clean', detail: 'Parsed without errors.' },
      lint: { status: 'clean', detail: 'No findings within scope.' },
      security: { status: 'clean', detail: 'No findings within scope.' },
      deps: { status: 'clean', detail: 'No imports.' },
      tests: { status: 'issue', detail: 'test_zero failed: items[-0:] returns the whole list, not [].' },
    },
    headline: '1 supplied test failed',
    notVerified: ['Inputs your tests do not cover, such as a negative n'],
    selfHosted: true,
  },
  {
    id: 'clean',
    tab: 'Everything passes',
    file: 'is_leap.py',
    language: 'Python',
    code: [
      'def is_leap(year):',
      '    """True if year is a leap year."""',
      '    return year % 4 == 0',
    ],
    issueLines: [],
    unverifiedLines: [3],
    checks: {
      syntax: { status: 'clean', detail: 'Parsed without errors.' },
      lint: { status: 'clean', detail: 'No findings within scope.' },
      security: { status: 'clean', detail: 'No findings within scope.' },
      deps: { status: 'clean', detail: 'No imports.' },
      tests: { status: 'not_tested', detail: 'No tests were supplied.' },
    },
    headline: 'No issues found, and 2 things nobody checked',
    notVerified: ['Whether the logic matches the task: the century rule (1900, 2100) is not covered by any check', 'What happens at runtime: no tests were supplied'],
  },
  {
    id: 'deps',
    tab: 'Package that may not exist',
    file: 'load_config.py',
    language: 'Python',
    code: [
      'import fastjsonx',
      '',
      'def load_config(path):',
      '    with open(path) as f:',
      '        return fastjsonx.loads(f.read())',
    ],
    issueLines: [1],
    unverifiedLines: [3, 4, 5],
    checks: {
      syntax: { status: 'clean', detail: 'Parsed without errors.' },
      lint: { status: 'clean', detail: 'No findings within scope.' },
      security: { status: 'clean', detail: 'No findings within scope.' },
      deps: { status: 'issue', detail: 'fastjsonx was not found on PyPI. It may be a hallucinated name; confirm it before installing.' },
      tests: { status: 'not_tested', detail: 'No tests were supplied.' },
    },
    headline: '1 issue detected, 1 check not run',
    notVerified: ['What happens at runtime: no tests were supplied'],
  },
];
