import type { ReactNode } from 'react';

export type Doc = { slug: string; title: string; summary: string; section: string; body: ReactNode };

export const DOCS: Doc[] = [
  { slug: 'getting-started', section: 'Start', title: 'Getting started', summary: 'Install TrustCode, sign in and verify your first snippet.', body: (<>
    <h2>1. Install</h2><p>Download the latest <code>.vsix</code> from the releases page and install it with <code>code --install-extension trustcode-x.y.z.vsix</code>, or from the VS Code Marketplace once the listing is published. A shield icon appears in the activity bar.</p>
    <h2>2. Sign in</h2><p>Open the TrustCode panel and click <strong>Sign In with browser</strong>. Log in or create an account on the TrustCode website; your browser returns you to VS Code (choose <strong>Open</strong> if asked).</p>
    <h2>3. Verify</h2><ol><li>Select AI-generated Python, JavaScript or TypeScript.</li><li>Right-click → <strong>TrustCode: Verify Selected Code</strong>.</li><li>Optionally describe the task, then click <strong>Verify selection</strong> and confirm.</li></ol>
    <h2>4. Read the result</h2><p>Start with the headline and the <strong>Not verified</strong> list, then the findings. Record your decision with a confidence rating.</p></>) },
  { slug: 'installation', section: 'Start', title: 'Installation & requirements', summary: 'Supported editors, versions and installation options.', body: (<>
    <ul><li>VS Code 1.90 or later (also VS Code–compatible editors that support <code>.vsix</code> extensions).</li><li>An internet connection for the hosted service, or a self-hosted backend for local mode.</li></ul>
    <h2>Install from a VSIX</h2><pre><code>code --install-extension trustcode-0.4.0.vsix</code></pre><p>Then run <strong>Developer: Reload Window</strong>.</p></>) },
  { slug: 'account', section: 'Start', title: 'Accounts & sign-in', summary: 'Browser sign-in, local mode, sign-out and account deletion.', body: (<>
    <p>TrustCode uses browser sign-in based on OAuth 2.0 with PKCE: your password is entered only on this website, and VS Code receives a short-lived, single-use code that only it can exchange.</p>
    <h2>Local mode</h2><p>Set <code>trustcode.mode</code> to <code>local</code> and <code>trustcode.backendUrl</code> to your own backend (for example <code>http://127.0.0.1:8000</code>). No account is needed and code never leaves your machine.</p>
    <h2>Delete your account</h2><p>In VS Code run <strong>TrustCode: Delete My Account and Data</strong>, or use <em>Settings → Delete account</em> in the dashboard. This removes your account, history, decisions and feedback.</p></>) },
  { slug: 'configuration', section: 'Use', title: 'Configuration', summary: 'All extension settings and what they do.', body: (<>
    <ul><li><code>trustcode.backendUrl</code> — the TrustCode server (default: the hosted service). Application-scoped: a workspace cannot change it.</li>
    <li><code>trustcode.mode</code> — <code>account</code> (sign in) or <code>local</code> (own backend).</li>
    <li><code>trustcode.requestTimeoutSeconds</code> — per-request timeout (default 30).</li>
    <li><code>trustcode.useLlmExplanations</code> — request AI-worded explanations (off by default; requires server support).</li></ul>
    <p>Privacy options (history, AI wording, level suggestions) are in the panel’s <strong>Account</strong> tab.</p></>) },
  { slug: 'reading-results', section: 'Use', title: 'Reading results', summary: 'Statuses, findings, the “Not verified” list and explanation levels.', body: (<>
    <h2>Check statuses</h2><ul><li><strong>✓ No findings (within scope)</strong> — the tool ran and reported nothing it looks for. Not proof of correctness.</li><li><strong>! Issue detected</strong> — the tool reported a finding.</li><li><strong>✕ Check failed</strong> — the tool could not run; treat the result as unknown.</li><li><strong>– Not tested</strong> — the check was not applicable or had no input (e.g. no tests).</li><li><strong>? Requires human review</strong> — a person must judge (e.g. does the code match the task?).</li></ul>
    <h2>Findings</h2><p>Each finding shows where it is, which tool detected it, why it matters, the suggested next step and — under <em>Evidence &amp; limits</em> — the raw tool output and what could not be verified.</p>
    <h2>Not verified</h2><p>Hidden defects are most likely here: functions or lines your tests never executed, and whether the code matches your task.</p></>) },
  { slug: 'languages', section: 'Use', title: 'Languages & special cases', summary: 'Python, JavaScript, TypeScript, declaration files and partial selections.', body: (<>
    <ul><li><strong>Python</strong> — syntax, lint (ruff/pyflakes), security, dependencies, sandboxed tests (self-hosted).</li><li><strong>JavaScript</strong> — syntax, security, dependencies, sandboxed tests (self-hosted). No linter yet.</li><li><strong>TypeScript</strong> — syntax, security, dependencies. Tests are not yet supported.</li></ul>
    <h2>Type declarations</h2><p>Code containing only type declarations (for example a <code>.d.ts</code> file) is reported as “type declarations only (no runnable code)”; behaviour checks are not applicable.</p>
    <h2>Partial selections</h2><p>If your selection starts inside a comment or in the middle of a block, TrustCode says so and suggests selecting the whole function.</p>
    <h2>Library code</h2><p>Code inside <code>node_modules</code>, <code>site-packages</code> or a virtual environment is not AI-generated; TrustCode asks before verifying it. Use a dependency scanner for library vulnerabilities.</p></>) },
  { slug: 'troubleshooting', section: 'Help', title: 'Troubleshooting', summary: 'Common errors and how to fix them.', body: (<>
    <h2>“Cannot reach the TrustCode backend”</h2><p>Check your internet connection and <code>trustcode.backendUrl</code>. In local mode, make sure your backend is running.</p>
    <h2>“Monthly verification limit reached”</h2><p>The Free plan includes 300 verifications per month; the dashboard shows usage and the reset date.</p>
    <h2>The browser did not return to VS Code</h2><p>Click <strong>Open VS Code</strong> on the success page, and allow your browser to open VS Code. Sign-in links expire after 10 minutes — start again from the panel.</p>
    <h2>Unit tests show “Not run”</h2><p>The hosted service never executes code. Run a self-hosted backend with the sandbox to execute tests.</p>
    <h2>I still see the old panel</h2><p>Run <strong>Developer: Reload Window</strong> after installing a new version.</p></>) },
  { slug: 'self-hosting', section: 'Help', title: 'Self-hosting', summary: 'Run the backend and sandbox on your own machine or server.', body: (<>
    <p>The backend, verification engine and sandbox are open source. See the repository’s <code>deployment/README.md</code> for local mode, Docker Compose and cloud options.</p>
    <pre><code>{`python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt -e verification-worker
docker build -t trustcode-sandbox:0.1 verification-worker/trustcode_worker/sandbox/image`}</code></pre></>) },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);
