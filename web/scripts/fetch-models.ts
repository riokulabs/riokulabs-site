/**
 * Prebuild step: make sure every GLB a model catalogue (src/data/models/<mod>.json) lists is in public/models/<mod>/.
 * The GLBs aren't in git: when any are missing, download the release tarball named in <mod>.release.json from the
 * repo's GitHub Releases, check its SHA-256, and unpack it. Local exports (tools/export-glb) are used as they are.
 * Nothing here runs in the browser: visitors get the files from the static site like any other asset.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(WEB, 'src', 'data', 'models');
const SAFE = /^[a-z0-9][a-z0-9.-]*$/;

async function main() {
  const mods = fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((f) => f.endsWith('.json') && !f.endsWith('.release.json')).map((f) => f.slice(0, -5)) : [];
  for (const mod of mods) {
    if (!SAFE.test(mod)) throw new Error(`fetch-models: bad catalogue name ${mod}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(DATA, `${mod}.json`), 'utf8')) as { files: Record<string, string> }[];
    const dir = path.join(WEB, 'public', 'models', mod);
    const want = manifest.flatMap((b) => Object.values(b.files)).map((u) => path.basename(u));
    const missing = want.filter((f) => !fs.existsSync(path.join(dir, f)));
    if (!missing.length) { console.log(`fetch-models: ${mod} ok (${want.length} files present)`); continue; }
    const relFile = path.join(DATA, `${mod}.release.json`);
    if (!fs.existsSync(relFile)) throw new Error(`fetch-models: ${missing.length} ${mod} files missing and no ${mod}.release.json; run tools/export-glb (build.mjs, then pack.mjs)`);
    const rel = JSON.parse(fs.readFileSync(relFile, 'utf8')) as { repo: string; tag: string; asset: string; sha256: string };
    if (!/^[\w.-]+\/[\w.-]+$/.test(rel.repo) || !SAFE.test(rel.tag) || !SAFE.test(rel.asset.replace(/\.tar\.gz$/, ''))) throw new Error('fetch-models: bad release.json');
    // MODELS_RELEASE_BASE (tests only) points at a local copy of the release instead of github.com
    const base = process.env.MODELS_RELEASE_BASE?.replace(/\/$/, '') ?? `https://github.com/${rel.repo}/releases/download/${rel.tag}`;
    const url = `${base}/${rel.asset}`;
    console.log(`fetch-models: ${mod}: ${missing.length}/${want.length} files missing, downloading ${url}`);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`fetch-models: ${res.status} for ${url} (has the release been published?)`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (sum !== rel.sha256) throw new Error(`fetch-models: checksum mismatch for ${rel.asset} (got ${sum})`);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${rel.asset}`);
    fs.writeFileSync(tmp, buf);
    try {
      // the tarball holds flat file names only; refuse anything else before unpacking
      const names = execFileSync('tar', ['-tzf', tmp], { encoding: 'utf8' }).split('\n').filter(Boolean);
      if (names.some((n) => !SAFE.test(n) || !n.endsWith('.glb'))) throw new Error('fetch-models: unexpected entry in the tarball');
      execFileSync('tar', ['-xzf', tmp, '-C', dir, '--no-same-owner']);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    const still = want.filter((f) => !fs.existsSync(path.join(dir, f)));
    if (still.length) throw new Error(`fetch-models: release ${rel.tag} lacks ${still.length} files the catalogue lists (e.g. ${still[0]})`);
    console.log(`fetch-models: ${mod} ok (${want.length} files)`);
  }
}
main().catch((e) => { console.error((e as Error).message); process.exit(1); });
