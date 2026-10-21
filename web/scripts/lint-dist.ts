/**
 * CI privacy canary + IP lint over the built site (HANDOFF §5, ARCHITECTURE §9.4-5).
 * Scans every file NAME under dist/ and the CONTENT of every text file (HTML, XML, JSON, JS, CSS, TXT, SVG, maps,
 * _headers/_redirects) for the privacy deny patterns, the IP deny terms and the retired studio names (public canaries
 * merged with the private lists, see src/lib/privacy.ts). Any hit exits 1.
 *   npm run lint:dist [-- <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hitLine, loadPrivacyLists, loadPrivacyLocal, type PrivacyLists } from '../src/lib/privacy';

const TEXT = /\.(html?|xml|json|js|mjs|css|txt|svg|map|webmanifest|xsl)$|(^|\/)_(headers|redirects)$/i;

export function scanDir(dir: string, lists: PrivacyLists): string[] {
  const hits: string[] = [];
  const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
  for (const d of files) {
    const rel = path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/');
    const all = [...lists.deny, ...lists.ip, ...(lists.retired ?? [])];
    for (const re of lists.deny) if (re.test(rel)) hits.push(hitLine('PRIVACY', `file name ${rel}`, re, lists.deny, undefined, all));
    for (const re of lists.ip) if (re.test(rel)) hits.push(hitLine('IP', `file name ${rel}`, re, lists.ip, undefined, all));
    for (const re of lists.retired ?? []) if (re.test(rel)) hits.push(hitLine('BRAND', `file name ${rel}`, re, lists.retired ?? [], undefined, all));
    let text: string;
    if (/\.glb$/i.test(rel)) {
      // GLB: scan its JSON chunk (node, mesh, material, image and animation names)
      const buf = fs.readFileSync(path.join(dir, rel));
      const len = buf.readUInt32LE(12);
      text = buf.subarray(20, 20 + len).toString('utf8');
    } else if (!TEXT.test(rel)) continue;
    else text = fs.readFileSync(path.join(dir, rel), 'utf8');
    const lines = text.split('\n');
    for (const [kind, set] of [['PRIVACY', lists.deny], ['IP', lists.ip], ['BRAND', lists.retired ?? []]] as const) {
      for (const re of set) {
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        for (const m of text.matchAll(g)) {
          const line = text.slice(0, m.index).split('\n').length;
          hits.push(hitLine(kind, `${rel}:${line}`, re, set, (lines[line - 1] ?? '').trim().slice(0, 100), all));
          if (hits.length > 200) return hits;
        }
      }
    }
  }
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? 'dist');
  if (!fs.existsSync(dir)) {
    console.error(`lint-dist: ${dir} not found (build first)`);
    process.exit(1);
  }
  const hits = scanDir(dir, loadPrivacyLists());
  const count = fs.readdirSync(dir, { recursive: true }).length;
  if (hits.length) {
    console.error(`lint-dist: ${hits.length} privacy/IP hit(s) in ${path.relative(process.cwd(), dir) || dir}:\n - ${hits.join('\n - ')}`);
    process.exit(1);
  }
  const scope = loadPrivacyLocal() ? 'public canaries + private lists' : 'public canaries only: private lists absent';
  console.log(`lint-dist: OK (${count} entries scanned for privacy deny patterns, IP terms and retired brand terms; ${scope})`);
}
