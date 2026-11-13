export const API_URL = (process.env.TRUSTCODE_API_URL ?? 'https://trustcode-api.vercel.app').replace(/\/$/, '');
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trustcode-app.vercel.app').replace(/\/$/, '');
export const GITHUB_URL = 'https://github.com/malika1234m/trustcode';
/** The current release. Update with each release (the extension is distributed as a .vsix from GitHub). */
export const RELEASE_VERSION = '1.1.0';
export const DOWNLOAD_URL = `${GITHUB_URL}/releases/tag/v${RELEASE_VERSION}`;
/** Trust Center: privacy, data flows and honest limits, as of the current release. */
export const TRUST_CENTER_URL = `${GITHUB_URL}/blob/v${RELEASE_VERSION}/docs/TRUSTCODE_TRUST_AND_PRIVACY.md`;
/** Set once the extension is published on the VS Code Marketplace (publisher account required). */
export const MARKETPLACE_URL: string | null = process.env.NEXT_PUBLIC_MARKETPLACE_URL || null;
export const INSTALL_URL = MARKETPLACE_URL ?? DOWNLOAD_URL;
export const INSTALL_LABEL = MARKETPLACE_URL ? 'Install for VS Code' : 'Download for VS Code';
