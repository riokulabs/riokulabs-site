/**
 * The merged privacy config (public config/privacy.json + the private config/privacy.local.json) must equal the workspace
 * allowlist docs/website/seed-allowlist.json. Keys starting with `$` (comments) are ignored at every depth, and so are
 * the local-only tooling keys below. Skips with a message when the workspace allowlist or the local file is absent
 * (CI checks out only this repo and never has the local file on disk unless the secret is set).
 */
import fs from 'node:fs';
import path from 'node:path';
import { mergePrivacy, privacyLocalFile } from '../src/utils/privacy';

/** Keys only the private file carries (tooling, test samples): not part of the allowlist. */
const LOCAL_ONLY_KEYS = ['legacyModelPrefix', 'testSamples'];

const CMS = path.resolve(__dirname, '..');
const src = path.resolve(CMS, '..', '..', '..', 'docs', 'website', 'seed-allowlist.json');
const localFile = privacyLocalFile(CMS);
if (!fs.existsSync(src)) {
  console.log('check-privacy-sync: skipped (workspace allowlist docs/website/seed-allowlist.json not found)');
  process.exit(0);
}
if (!fs.existsSync(localFile)) {
  console.log('check-privacy-sync: skipped (config/privacy.local.json not found; the public config alone cannot match the allowlist)');
  process.exit(0);
}

/** Drop `$` keys everywhere and sort object keys, so only content is compared. */
const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]));
  }
  return v;
};

const pub = JSON.parse(fs.readFileSync(path.join(CMS, 'config', 'privacy.json'), 'utf8'));
const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
for (const k of LOCAL_ONLY_KEYS) delete local[k];
const merged = canon(mergePrivacy(pub, local)) as Record<string, unknown>;
const orig = canon(JSON.parse(fs.readFileSync(src, 'utf8'))) as Record<string, unknown>;

const diffs: string[] = [];
for (const k of new Set([...Object.keys(merged), ...Object.keys(orig)])) {
  if (JSON.stringify(merged[k]) !== JSON.stringify(orig[k])) diffs.push(k);
}
if (diffs.length) {
  console.error(
    `check-privacy-sync: the merged config (privacy.json + privacy.local.json) differs from docs/website/seed-allowlist.json in: ${diffs.join(', ')}.\n` +
      'Edit the allowlist first, then put its public parts in config/privacy.json and its private parts in config/privacy.local.json.',
  );
  process.exit(1);
}
console.log('check-privacy-sync: OK (privacy.json + privacy.local.json = seed-allowlist.json)');
