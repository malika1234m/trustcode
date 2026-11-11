// Lightweight local import resolution (pure). Used only to decide which unchanged files must accompany a
// change so the server can check cross-file consistency: the files a changed file imports ("context") and
// the files that import a changed or deleted file ("related"). The server does the actual checking.

export type CodeLanguage = 'python' | 'javascript' | 'typescript';
const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.d.ts'];

export function codeLanguage(path: string): CodeLanguage | undefined {
  const p = path.toLowerCase();
  if (p.endsWith('.py')) return 'python';
  if (/\.(js|jsx|mjs|cjs)$/.test(p)) return 'javascript';
  if (/\.(ts|tsx)$/.test(p)) return 'typescript';
  return undefined;
}

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}
const join = (...parts: string[]) => normalize(parts.filter(Boolean).join('/'));

export interface PyImport { level: number; module: string; names: string[] }

export function jsSpecifiers(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]*|\.{1,2})\1/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.add(m[2]);
  return [...out];
}

export function pyImports(text: string): PyImport[] {
  const out: PyImport[] = [];
  const joined = text.replace(/\\\n/g, ' ').replace(/\(([^()]*)\)/g, (_, inner: string) => `(${inner.replace(/\n/g, ' ')})`);
  for (const line of joined.split('\n')) {
    let m = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/.exec(line);
    if (m) {
      const names = m[3].replace(/[()]/g, '').split('#')[0].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter((n) => /^[\w*]+$/.test(n));
      out.push({ level: m[1].length, module: m[2], names });
      continue;
    }
    m = /^\s*import\s+(.+)$/.exec(line);
    if (m) for (const part of m[1].split('#')[0].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (/^[\w.]+$/.test(name)) out.push({ level: 0, module: name, names: [] });
    }
  }
  return out;
}

export function resolveJs(importer: string, spec: string, paths: ReadonlySet<string>): string | undefined {
  const stem = join(dirname(importer), spec);
  const cands = [stem, ...JS_EXTS.map((e) => stem + e), ...JS_EXTS.slice(0, 6).map((e) => `${stem}/index${e}`)];
  const m = /\.[mc]?js$/.exec(stem);
  if (m) cands.push(...['.ts', '.tsx', '.mts', '.cts'].map((e) => stem.slice(0, m.index) + e));
  return cands.find((c) => paths.has(c));
}

export function resolvePy(importer: string, imp: PyImport, paths: ReadonlySet<string>): string[] {
  const parts = imp.module.split('.').filter(Boolean);
  const hits: string[] = [];
  const tryStem = (stem: string) => {
    const hit = [`${stem}.py`, `${stem}/__init__.py`].find((c) => paths.has(c));
    if (hit) hits.push(hit);
    return hit;
  };
  if (imp.level) {
    let base = dirname(importer);
    for (let i = 1; i < imp.level; i++) base = dirname(base);
    const stem = join(base, ...parts);
    if (parts.length) tryStem(stem);
    for (const n of imp.names) tryStem(join(stem, n));  // `from . import x` / `from .pkg import submodule`
    return hits;
  }
  if (!parts.length) return hits;
  const tail = parts.join('/');
  const bySuffix = (suffix: string) => [...paths].filter((p) => p === suffix || p.endsWith(`/${suffix}`)).sort((a, b) => a.length - b.length)[0];
  const hit = bySuffix(`${tail}.py`) ?? bySuffix(`${tail}/__init__.py`);
  if (hit) {
    hits.push(hit);
    if (hit.endsWith('__init__.py')) for (const n of imp.names) { const sub = bySuffix(`${tail}/${n}.py`); if (sub) hits.push(sub); }
  }
  return hits;
}

/** Workspace files that `path` imports (one hop, local files only). */
export function localImports(path: string, text: string, paths: ReadonlySet<string>): string[] {
  const lang = codeLanguage(path);
  if (!lang) return [];
  const out = new Set<string>();
  if (lang === 'python') for (const imp of pyImports(text)) for (const hit of resolvePy(path, imp, paths)) out.add(hit);
  else for (const spec of jsSpecifiers(text)) { const hit = resolveJs(path, spec, paths); if (hit) out.add(hit); }
  out.delete(path);
  return [...out];
}

/**
 * Does `text` (an unchanged file at `path`) import any of `targets`? `gone` are paths deleted or renamed
 * away: they no longer exist, so they are resolved against a path set that still contains them.
 */
export function importsAnyOf(path: string, text: string, targets: ReadonlySet<string>, paths: ReadonlySet<string>, gone: ReadonlySet<string>): boolean {
  const all = gone.size ? new Set([...paths, ...gone]) : paths;
  return localImports(path, text, all).some((p) => targets.has(p) || gone.has(p));
}

/** Manifests that declare the dependencies of `path`: nearest package.json, or requirements*.txt / pyproject.toml. */
export function nearestManifests(path: string, paths: ReadonlySet<string>): string[] {
  const lang = codeLanguage(path);
  if (!lang) return [];
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const prefix = dir ? `${dir}/` : '';
    const here = lang === 'python'
      ? [...paths].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/') && /^(requirements[^/]*\.txt|pyproject\.toml)$/.test(p.slice(prefix.length)))
      : (paths.has(`${prefix}package.json`) ? [`${prefix}package.json`] : []);
    if (here.length) return here;
    if (!dir) return [];
  }
}
