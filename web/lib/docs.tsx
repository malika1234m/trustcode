import type { ReactNode } from 'react';

export type Doc = { slug: string; title: string; summary: string; section: string; body: ReactNode };

export const DOCS: Doc[] = [
  { slug: 'getting-started', section: 'Start', title: 'Getting started', summary: 'Create a free account, install TrustCode, set up the local engine once and verify your first snippet.', body: (<>
    <h2>1. Create a free account</h2><p>Register on this website. TrustCode is free, and you sign in with your account to use it.</p>
    <h2>2. Install and sign in</h2><p>Download <code>trustcode-1.1.0.vsix</code> from the <a href="https://github.com/malika1234m/trustcode/releases/tag/v1.1.0">v1.1.0 release</a>, then in VS Code run <strong>Extensions: Install from VSIX…</strong> (or <code>code --install-extension trustcode-1.1.0.vsix</code>). TrustCode is not on the VS Code Marketplace. A shield icon appears in the activity bar. Open it and sign in; sign-in happens in your browser.</p>
    <h2>3. Set up the local engine (once)</h2><p>The first time you verify, TrustCode asks before doing anything. If you agree, it creates a private Python environment in VS Code’s storage and downloads the analysis tools from PyPI (about 300 MB; needs Python 3.11 or newer and an internet connection for this step).</p>
    <h2>4. Verify</h2><ol><li>Select AI-generated Python, JavaScript or TypeScript.</li><li>Right-click → <strong>TrustCode: Verify Selected Code</strong>.</li><li>Optionally describe the task, then click <strong>Verify selection</strong>. The checks run on your computer.</li></ol>
    <h2>5. Read the result</h2><p>Start with the headline and the <strong>Not verified</strong> list, then the findings. Record your decision with a confidence rating.</p></>) },
  { slug: 'installation', section: 'Start', title: 'Installation & requirements', summary: 'Supported editors, versions and installation options.', body: (<>
    <ul><li>VS Code 1.90 or later.</li><li>Python 3.11 or newer for the local engine.</li><li>About 300 MB of disk space for the engine, and an internet connection for the one-time setup (the tools come from PyPI).</li><li>Docker, only if you want supplied unit tests to run. Without it the tests check is reported as not run.</li><li>Developed and tested on macOS (Apple silicon). Windows and Linux have not been tested.</li></ul>
    <h2>Install from a VSIX</h2><p>Download <code>trustcode-1.1.0.vsix</code> from the <a href="https://github.com/malika1234m/trustcode/releases/tag/v1.1.0">v1.1.0 release</a>, then run <strong>Extensions: Install from VSIX…</strong>, or:</p><pre><code>code --install-extension trustcode-1.1.0.vsix</code></pre><p>Then run <strong>Developer: Reload Window</strong>.</p></>) },
  { slug: 'account', section: 'Start', title: 'Accounts & sign-in', summary: 'Why you need an account, working offline, browser sign-in and account deletion.', body: (<>
    <p>TrustCode is free, and every user signs in with a TrustCode account. Your code is still checked on your computer and is not uploaded; the account confirms who is using TrustCode.</p>
    <h2>Working offline</h2><p>After you sign in, VS Code stores a signed licence for your account. TrustCode checks it on your computer each time it starts, so you can keep working without an internet connection for up to 30 days. When you are online, it confirms your account with the server about once a day. If the 30 days pass without a connection, TrustCode pauses until it can confirm your account again; your files and history are kept.</p>
    <h2>Devices</h2><p>An account can be signed in on 3 devices at a time. See and sign out devices under <a href="/dashboard/settings#devices">Settings → Devices</a>.</p>
    <p>TrustCode uses browser sign-in based on OAuth 2.0 with PKCE: your password is entered only on this website, and VS Code receives a short-lived, single-use code that only it can exchange.</p>
    <h2>Delete your account</h2><p>In VS Code run <strong>TrustCode: Delete My Account and Data</strong>, or use <em>Settings → Delete account</em> in the dashboard. This removes your account, history, decisions and feedback.</p></>) },
  { slug: 'configuration', section: 'Use', title: 'Configuration', summary: 'All extension settings and what they do.', body: (<>
    <ul><li><code>trustcode.analysis.location</code> — <code>local</code> (default: Verify and Session run on this computer) or <code>server</code> (the code you choose is sent to the TrustCode server after a consent dialog; needs an account).</li>
    <li><code>trustcode.engine.registryLookups</code> — look up imported package names on PyPI or npm (off by default; sends package names only).</li>
    <li><code>trustcode.engine.runTests</code> — run supplied unit tests in the Docker sandbox when Docker is available.</li>
    <li><code>trustcode.engine.basePython</code> / <code>trustcode.engine.pythonPath</code> — which Python sets up or runs the engine.</li>
    <li><code>trustcode.backendUrl</code> — the TrustCode server, used only for an account or server analysis. Application-scoped: a workspace cannot change it.</li>
        <li><code>trustcode.requestTimeoutSeconds</code> — per-request timeout (default 30).</li>
    <li><code>trustcode.useLlmExplanations</code> — request AI-worded explanations (off by default; server analysis only).</li></ul>
    <p>History, decisions and feedback from local analysis are stored on your computer, in VS Code’s storage.</p></>) },
  { slug: 'reading-results', section: 'Use', title: 'Reading results', summary: 'Statuses, findings, the “Not verified” list and explanation levels.', body: (<>
    <h2>Check statuses</h2><ul><li><strong>✓ No findings (within scope)</strong> — the tool ran and reported nothing it looks for. Not proof of correctness.</li><li><strong>! Issue detected</strong> — the tool reported a finding.</li><li><strong>✕ Check failed</strong> — the tool could not run; treat the result as unknown.</li><li><strong>– Not tested</strong> — the check was not applicable or had no input (e.g. no tests).</li><li><strong>? Requires human review</strong> — a person must judge (e.g. does the code match the task?).</li></ul>
    <h2>Findings</h2><p>Each finding shows where it is, which tool detected it, why it matters, the suggested next step and — under <em>Evidence &amp; limits</em> — the raw tool output and what could not be verified.</p>
    <h2>Not verified</h2><p>Hidden defects are most likely here: functions or lines your tests never executed, and whether the code matches your task.</p></>) },
  { slug: 'languages', section: 'Use', title: 'Languages & special cases', summary: 'Python, JavaScript, TypeScript, declaration files and partial selections.', body: (<>
    <ul><li><strong>Python</strong> — syntax, code checks, type checks, security, dependencies, tests in the Docker sandbox when Docker is available.</li><li><strong>JavaScript</strong> — syntax, security, dependencies, tests in the Docker sandbox when Docker is available.</li><li><strong>TypeScript</strong> — syntax, security, dependencies.</li></ul>
    <h2>Type declarations</h2><p>Code containing only type declarations (for example a <code>.d.ts</code> file) is reported as “type declarations only (no runnable code)”; behaviour checks are not applicable.</p>
    <h2>Partial selections</h2><p>If your selection starts inside a comment or in the middle of a block, TrustCode says so and suggests selecting the whole function.</p>
    <h2>Library code</h2><p>Code inside <code>node_modules</code>, <code>site-packages</code> or a virtual environment is not AI-generated; TrustCode asks before verifying it. Use a dependency scanner for library vulnerabilities.</p></>) },
  { slug: 'troubleshooting', section: 'Help', title: 'Troubleshooting', summary: 'Common errors and how to fix them.', body: (<>
    <h2>The local engine is not set up</h2><p>Setup needs Python 3.11 or newer and an internet connection to download the tools from PyPI. TrustCode does not install Python. A tool that could not be installed is reported, and the checks that need it say <em>not run</em>.</p>
    <h2>“Cannot reach the TrustCode backend”</h2><p>Only relevant for an account or server analysis. Check your internet connection and <code>trustcode.backendUrl</code>.</p>
    <h2>“Monthly verification limit reached”</h2><p>Applies to server analysis only. Local analysis is not metered.</p>
    <h2>The browser did not return to VS Code</h2><p>Click <strong>Open VS Code</strong> on the success page, and allow your browser to open VS Code. Sign-in links expire after 10 minutes — start again from the panel.</p>
    <h2>Unit tests show “Not run”</h2><p>Supplied tests run only in the Docker sandbox. Start Docker and make sure <code>trustcode.engine.runTests</code> is on. The hosted server never executes code.</p>
    <h2>I still see the old panel</h2><p>Run <strong>Developer: Reload Window</strong> after installing a new version.</p></>) },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);
