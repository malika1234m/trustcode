import type { ReactNode } from 'react';

const DRAFT = <p className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm"><strong>Draft for review.</strong> This document has not yet been reviewed by a lawyer. Business details (legal entity, address, governing law) must be completed before commercial launch.</p>;

export const LEGAL: Record<string, { title: string; body: ReactNode }> = {
  privacy: { title: 'Privacy Policy', body: (<>{DRAFT}
    <h2>What we collect</h2><ul><li><strong>Account data:</strong> email address and a password hash (scrypt).</li><li><strong>Code you submit:</strong> sent only after you confirm; deleted as soon as analysis finishes. A SHA-256 hash and line count are kept with the job.</li><li><strong>Results:</strong> verification evidence (which can include short code excerpts) — kept 24 hours by default, or 30 days if you enable history.</li><li><strong>Decisions and feedback</strong> you record, until you delete your account.</li><li><strong>Support messages</strong> you send us.</li><li><strong>Technical logs:</strong> request method, path, status and timing — never request bodies or code.</li></ul>
    <h2>What we don’t do</h2><ul><li>We don’t sell personal data.</li><li>We don’t send your code to AI providers unless you enable AI-worded explanations (off by default).</li></ul>
    <h2>Processors</h2><p>Hosting (Vercel) and database (Neon). A list will be maintained here.</p>
    <h2>Your rights</h2><p>You can delete your account and data at any time from VS Code or the dashboard. Contact us for access or correction requests.</p></>) },
  terms: { title: 'Terms of Service', body: (<>{DRAFT}
    <h2>The service</h2><p>TrustCode reports evidence from automated checks. It does not guarantee that code is correct, secure or fit for any purpose, and it is not a substitute for your own review.</p>
    <h2>Your responsibilities</h2><ul><li>Only submit code you are allowed to share.</li><li>Keep your account secure.</li><li>Follow the Acceptable Use Policy.</li></ul>
    <h2>Free plan</h2><p>The Free plan is provided as-is with a monthly verification allowance that may change with notice.</p>
    <h2>Liability</h2><p>To the extent permitted by law, TrustCode is not liable for losses arising from decisions made using its results. [Jurisdiction-specific wording required.]</p></>) },
  'acceptable-use': { title: 'Acceptable Use Policy', body: (<>{DRAFT}<ul><li>Do not use TrustCode to develop malware or attack systems you are not authorised to test.</li><li>Do not attempt to break out of, overload or abuse the verification infrastructure.</li><li>Do not submit data you have no right to share, or personal data of others.</li><li>Automated or bulk use must stay within plan limits.</li></ul></>) },
  refunds: { title: 'Refund & Cancellation Policy', body: (<>{DRAFT}<p>TrustCode is currently free; no payments are taken. When paid plans launch, this page will describe cancellation (effective at the end of the billing period) and refund terms, which will be handled by our payment provider (Merchant of Record).</p></>) },
  cookies: { title: 'Cookie Policy', body: (<>{DRAFT}<p>This website uses only strictly necessary cookies: <code>tc_at</code> and <code>tc_rt</code> keep you signed in to the dashboard (httpOnly, not readable by scripts). No advertising or third-party tracking cookies are used.</p></>) },
};
