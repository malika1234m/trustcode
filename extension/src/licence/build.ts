// Build identity (pure -> unit-testable). A SHA-256 over the extension's own compiled code, reported with each
// licence request as an integrity signal. The server compares it with the hashes of released builds and logs a
// difference as suspicious; it never blocks on it, because a modified extension can report any value it likes.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
}

/** Hash of every .js file under `dir` (paths and contents, in a fixed order). Undefined when the files cannot be read. */
export async function buildHash(dir: string): Promise<string | undefined> {
  try {
    const files: string[] = [];
    await walk(dir, dir, files);
    if (!files.length) return undefined;
    const h = createHash('sha256');
    for (const f of files.sort()) {
      h.update(f); h.update('\0');
      h.update(await fs.promises.readFile(path.join(dir, f))); h.update('\0');
    }
    return h.digest('hex');
  } catch { return undefined; }
}
