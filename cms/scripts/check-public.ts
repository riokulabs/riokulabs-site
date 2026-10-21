/**
 * Public-repo guard: no private term may appear in a file git tracks (or would track: untracked, not ignored).
 *
 * Terms: every pattern in the private lists (denyPatterns, ipDenyTerms, retiredBrandTerms from config/privacy.local.json
 * or PRIVACY_LOCAL_JSON) plus the names, slugs, taglines and notes of the private seed entries (seed/private.ts and the
 * allowlist's privateDraft.ideaMods), the old model-name prefix, and any extra `publicLeakTerms`. File contents (text files) and file paths are
 * both checked. Skips when the private lists are absent (a fork, CI without the secret): there is nothing to compare.
 *
 *   npm run check:public
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadPrivacyLocal } from '../src/utils/privacy';

const CMS = path.resolve(__dirname, '..');
const local = loadPrivacyLocal(CMS) as Record<string, any> | null;
if (!local) {
  console.log('check-public: skipped (no private lists: config/privacy.local.json / PRIVACY_LOCAL_JSON absent)');
  process.exit(0);
}

const flags = 'i';
const terms: { re: RegExp; kind: string }[] = [];
for (const [key, kind] of [['denyPatterns', 'PRIVACY'], ['ipDenyTerms', 'IP'], ['retiredBrandTerms', 'BRAND']] as const) {
  for (const s of (local[key] ?? []) as string[]) terms.push({ re: new RegExp(s, flags), kind });
}
// Literal private strings: whole-word, case-insensitive.
const literal = (t: string) => new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![a-z0-9])`, flags);
const literals = new Set<string>();
const addLit = (t: unknown) => {
  if (typeof t === 'string' && t.trim().length >= 3) literals.add(t.trim());
};
for (const m of local.privateDraft?.ideaMods ?? []) [m.name, m.slug].forEach(addLit);
for (const t of local.publicLeakTerms ?? []) addLit(t);
const privateSeedFile = path.join(CMS, 'seed', 'private.ts');
if (fs.existsSync(privateSeedFile)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require(privateSeedFile);
  for (const m of p.ideaMods ?? []) [m.name, m.slug, m.tagline].forEach(addLit);
  for (const m of p.milestones ?? []) [m.label, m.note].forEach(addLit);
  for (const [, slug] of p.retiredSeedEntries ?? []) addLit(slug);
}
for (const t of literals) terms.push({ re: literal(t), kind: 'PRIVATE-SEED' });
// The old model-name prefix (tools/export-glb) also matches as a prefix (e.g. <PREFIX>PortFrame_).
if (typeof local.legacyModelPrefix === 'string' && /^[A-Za-z0-9]+$/.test(local.legacyModelPrefix)) {
  // Case-sensitive and followed by "_" or a capital, as in model names, so random base64 (lockfile hashes) can't hit.
  terms.push({ re: new RegExp(`(?<![A-Za-z0-9+/])${local.legacyModelPrefix}(?=_|[A-Z])`), kind: 'PRIVATE' });
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: CMS, encoding: 'utf8' }).trim();
const list = (args: string[]) => execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
const files = [...new Set([...list([]), ...list(['--others', '--exclude-standard'])])];

// This repo and its Actions logs are public: under CI report the kind, a masked path and the term's index only.
const PUBLIC_LOG = !!process.env.CI && process.env.PRIVACY_VERBOSE !== '1';
// FNV-1a tag of the location: never the path or the line itself under CI (either can contain the term)
const placeTag = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };
const hit = (t: { re: RegExp; kind: string }, where: string, text?: string) =>
  PUBLIC_LOG ? `${t.kind} @${placeTag(where)} (term #${terms.indexOf(t as never) + 1})` : `${t.kind} ${where} /${t.re.source}/${text === undefined ? '' : ` "${text}"`}`;
const hits: string[] = [];
for (const rel of files) {
  const abs = path.join(root, rel);
  for (const t of terms) if (t.re.test(rel)) hits.push(hit(t, `path ${rel}`));
  let buf: Buffer;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    continue; // deleted in the work tree
  }
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  for (const t of terms) {
    const g = new RegExp(t.re.source, t.re.flags + 'g');
    for (const m of text.matchAll(g)) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push(hit(t, `${rel}:${line}`, (lines[line - 1] ?? '').trim().slice(0, 100)));
      if (hits.length > 200) break;
    }
  }
}

if (hits.length) {
  console.error(`check-public: ${hits.length} private term(s) in files git tracks or would track (this repo is public):\n - ${hits.join('\n - ')}`);
  process.exit(1);
}
console.log(`check-public: OK (${files.length} files, ${terms.length} private terms)`);
