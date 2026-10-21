/**
 * Pack a mod's exported models for a GitHub Release, so the GLBs live outside git and the site build downloads them.
 *   node pack.mjs [--mod data-center]
 * Writes .work/release/<asset>.tar.gz and web/src/data/models/<mod>.release.json (tag, asset, sha256, bytes, repo).
 * The tag is content-addressed (hash of the manifest), so a new export gets a new release and old builds keep working.
 * Publishing is the maintainer's step: the script prints the `gh release create` command; it never uploads.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const mod = arg('--mod', 'data-center');
const identity = JSON.parse(fs.readFileSync(path.join(SITE, 'web/src/config/identity.json'), 'utf8'));
const repo = arg('--repo', `${identity.githubOrg}/riokulabs-site`);

const manifestPath = path.join(SITE, 'web/src/data/models', `${mod}.json`);
const dir = path.join(SITE, 'web/public/models', mod);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = manifest.flatMap((b) => Object.values(b.files)).map((u) => path.basename(u)).sort();
for (const f of files) if (!fs.existsSync(path.join(dir, f))) throw new Error(`missing ${f} in ${dir}: export first (node build.mjs --all --variants)`);

const hash = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex').slice(0, 10);
const tag = `models-${mod}-${hash}`;
const asset = `${tag}.tar.gz`;
const out = path.join(HERE, '.work', 'release');
fs.mkdirSync(out, { recursive: true });
const tarball = path.join(out, asset);
// fixed order, owner and mtime so the same export always packs to the same bytes
execFileSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '--mtime=@0', '-czf', tarball, '-C', dir, ...files]);
const buf = fs.readFileSync(tarball);
const info = { mod, repo, tag, asset, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length, files: files.length };
fs.writeFileSync(path.join(SITE, 'web/src/data/models', `${mod}.release.json`), JSON.stringify(info, null, 1) + '\n');
console.log(`packed ${files.length} files → ${path.relative(process.cwd(), tarball)} (${(buf.length / 1048576).toFixed(1)} MB)`);
console.log(`publish it (maintainer):\n  gh release create ${tag} "${tarball}" --repo ${repo} --title "Models: ${mod} ${hash}" --notes "GLBs for the ${mod} block explorer. Built by tools/export-glb."`);
