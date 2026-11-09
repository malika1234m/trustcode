import fs from 'node:fs';
import path from 'node:path';

export type Release = { version: string; items: string[] };

export function releases(): Release[] {
  const md = fs.readFileSync(path.join(process.cwd(), 'content', 'changelog.md'), 'utf8');
  return md.split(/^## /m).slice(1).map((block) => {
    const [head, ...rest] = block.split('\n');
    return { version: head.trim(), items: rest.filter((l) => l.trim().startsWith('- ')).map((l) => l.trim().slice(2).replace(/\*\*/g, '').replace(/`/g, '')) };
  });
}
