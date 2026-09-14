// Consent policy (pure). Code is never sent without an explicit, informed confirmation.

export interface ConsentState { trustedBackends: string[] }

export function normaliseBackend(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function needsPrompt(state: ConsentState, backendUrl: string): boolean {
  return !state.trustedBackends.includes(normaliseBackend(backendUrl));
}

export function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
}

export function consentMessage(lines: number, chars: number, backendUrl: string, hasTests: boolean, llm: boolean): string {
  const where = isLoopback(backendUrl) ? `your local TrustCode backend (${backendUrl})` : `the remote TrustCode server ${backendUrl}`;
  return `Send ${lines} selected line(s) (${chars} characters)${hasTests ? ' and your tests' : ''} to ${where} for verification?`
    + ' The code is analysed and then deleted from the server; results are kept only as your privacy settings allow.'
    + (llm ? ' LLM explanations are ON: finding details may be sent by the server to its LLM provider.' : '');
}

export function remember(state: ConsentState, backendUrl: string): ConsentState {
  const b = normaliseBackend(backendUrl);
  return state.trustedBackends.includes(b) ? state : { trustedBackends: [...state.trustedBackends, b] };
}

export function languageFor(vscodeLanguageId: string): 'python' | 'javascript' | undefined {
  if (vscodeLanguageId === 'python') return 'python';
  if (['javascript', 'javascriptreact'].includes(vscodeLanguageId)) return 'javascript';
  return undefined;
}
