// Update checking (pure: no vscode import -> unit-testable). TrustCode is distributed as a .vsix on GitHub
// Releases; the check reads the public "latest release" record. It sends no project data and no account data.
export const RELEASES_API = 'https://api.github.com/repos/malika1234m/trustcode/releases/latest';
const TRUSTED_PREFIX = 'https://github.com/malika1234m/trustcode/';

export function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}
/** > 0 when a is newer than b. Unparseable versions are never "newer" (no downgrade or sideways install). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export interface UpdateInfo {
  installed: string; latest?: string; available: boolean; notes?: string; pageUrl?: string; vsixUrl?: string; sha256Url?: string;
  checkedAt?: number; error?: string;
}

/** Validates a GitHub "latest release" response. Only links to this project's own releases are accepted. */
export function readRelease(installed: string, data: any, now: number): UpdateInfo {
  const tag = typeof data?.tag_name === 'string' ? data.tag_name : '';
  if (!parseVersion(tag) || data?.draft === true || data?.prerelease === true) return { installed, available: false, checkedAt: now, error: 'No published release was found.' };
  const trusted = (u: unknown) => (typeof u === 'string' && u.startsWith(TRUSTED_PREFIX) ? u : undefined);
  const assets: any[] = Array.isArray(data.assets) ? data.assets : [];
  const vsix = assets.find((a) => typeof a?.name === 'string' && /^trustcode-\d+\.\d+\.\d+\.vsix$/.test(a.name));
  const sum = vsix && assets.find((a) => a?.name === `${vsix.name}.sha256`);
  return { installed, latest: tag.replace(/^v/, ''), available: compareVersions(tag, installed) > 0, checkedAt: now,
    notes: typeof data.body === 'string' ? data.body.slice(0, 1500) : undefined, pageUrl: trusted(data.html_url),
    vsixUrl: trusted(vsix?.browser_download_url), sha256Url: trusted(sum?.browser_download_url) };
}

/** True when this extension is older than the server still supports (the server says which versions it serves). */
export function tooOldForServer(installed: string, minExtensionVersion: unknown): boolean {
  return typeof minExtensionVersion === 'string' && !!parseVersion(minExtensionVersion) && compareVersions(minExtensionVersion, installed) > 0;
}
