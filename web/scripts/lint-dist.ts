/**
 * CI privacy canary + IP lint over the built site (HANDOFF §5, ARCHITECTURE §9.4-5).
 * Scans every file NAME under dist/ and the CONTENT of every text file (HTML, XML, JSON, JS, CSS, TXT, SVG, maps,
 * _headers/_redirects) for the privacy deny patterns, the IP deny terms and the retired studio names (public canaries
 * merged with the private lists: from the CMS "Privacy lists" in a Strapi build, else the local file/env; see
 * src/lib/privacy-source.ts). A Strapi build without any private lists fails. It also checks that every <iframe> in the HTML is a YouTube
 * player on youtube-nocookie.com (the only third-party frame the site embeds). Any hit exits 1.
 *   npm run lint:dist [-- <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hitLine, type PrivacyLists } from '../src/lib/privacy';
import { isStrapiBuild, resolvePrivacyLists } from '../src/lib/privacy-source';

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

/** The only frames a page may embed: the youtube-embed section's privacy-enhanced player. */
export const ALLOWED_FRAME = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(\?[A-Za-z0-9=&_-]*)?$/;

/** Every <iframe> (in .html files) whose src is missing or not an allowed player URL. */
export function frameHits(dir: string): string[] {
  const hits: string[] = [];
  const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.html?$/i.test(d.name));
  for (const d of files) {
    const rel = path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/');
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    for (const m of text.matchAll(/<iframe\b[^>]*>/gi)) {
      const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0]);
      const url = (src?.[1] ?? src?.[2] ?? src?.[3] ?? '').replace(/&amp;/g, '&');
      if (!ALLOWED_FRAME.test(url)) hits.push(`FRAME ${rel}:${text.slice(0, m.index).split('\n').length}: iframe src not allowed: ${JSON.stringify(url.slice(0, 100))}`);
    }
  }
  return hits;
}

async function main() {
  try {
    // Same settings as fetch-content (SITE_DATA, STRAPI_URL, STRAPI_BUILD_TOKEN may live in web/.env).
    process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
  } catch {
    /* no .env */
  }
  const dir = path.resolve(process.argv[2] ?? 'dist');
  if (!fs.existsSync(dir)) {
    console.error(`lint-dist: ${dir} not found (build first)`);
    process.exit(1);
  }
  const { source, lists } = await resolvePrivacyLists();
  if (isStrapiBuild() && source === 'none') {
    console.error('lint-dist: a Strapi build needs the private lists (Settings > Privacy lists in the CMS, or locally cms/config/privacy.local.json / PRIVACY_LOCAL_JSON).');
    process.exit(1);
  }
  const hits = [...scanDir(dir, lists), ...frameHits(dir)];
  const count = fs.readdirSync(dir, { recursive: true }).length;
  if (hits.length) {
    console.error(`lint-dist: ${hits.length} privacy/IP/frame hit(s) in ${path.relative(process.cwd(), dir) || dir}:\n - ${hits.join('\n - ')}`);
    process.exit(1);
  }
  const scope = source === 'none' ? 'public canaries only: private lists absent' : `public canaries + private lists from ${source}`;
  console.log(`lint-dist: OK (${count} entries scanned for privacy deny patterns, IP terms and retired brand terms; iframes limited to the YouTube nocookie player; ${scope})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`lint-dist: ${(e as Error).message}`);
    process.exit(1);
  });
}
