/**
 * Viewer GLB gate (BLOCK-VIEWER §3.4, §5.4). Fails (exit 1) when any GLB in web/public/models/:
 *  - has a node/mesh name with a Keen kit marker (_KIT_, Fracture_, ConveyorPort, UpgradePort, Large_Conveyor);
 *  - uses a material outside the web set (WEB_*, finish.mjs WEB);
 *  - embeds an image whose SHA-256 isn't in assets/allowed-images.json (images WE generated);
 *  - is over budget: > 2 MB, > 60k triangles, > 12 materials, > 8 animated nodes;
 *  - lacks EXT_meshopt_compression.
 * Also checks web/public/models/<mod>/*.glb (build.mjs --all; variant files under VARIANT_BUDGET) and that each
 * web/src/data/models/<mod>.json references only files that exist and are clean in provenance/<mod>/.
 * On success it marks tools/export-glb/provenance/<slug>.provenance.json `status: "clean"` (the controller signed
 * off the M7 gate for local use; the user reviews before anything goes public).
 *    node validate.mjs [file.glb ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { io, WEB } from './finish.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.resolve(HERE, '..', '..', 'web', 'public', 'models');
const PROV = path.join(HERE, 'provenance');
const allowed = new Set(Object.values(JSON.parse(fs.readFileSync(path.join(HERE, 'assets', 'allowed-images.json'), 'utf8'))));
const MARKERS = /(_KIT_|Fracture_|ConveyorPort|UpgradePort|Large_Conveyor)/i;
export const BUDGET = { bytes: 2 * 1024 * 1024, triangles: 60_000, materials: 12, animatedNodes: 8 };
// Review-only variant files (build.mjs --all --variants: damaged / fracture / stages) carry more: the Damaged model is
// densified for its dents, the stage file adds the construction materials. Same cleanliness gates, looser budget.
export const VARIANT_BUDGET = { bytes: 4 * 1024 * 1024, triangles: 160_000, materials: 16, animatedNodes: 8 };

export async function validateFile(file, io_, budget = BUDGET) {
  const problems = [];
  const bytes = fs.statSync(file).size;
  const doc = await io_.read(file);
  const root = doc.getRoot();
  for (const n of [...root.listNodes(), ...root.listMeshes()]) if (MARKERS.test(n.getName())) problems.push(`Keen marker in name: ${n.getName()}`);
  const mats = root.listMaterials().map((m) => m.getName());
  for (const m of mats) if (!(m in WEB)) problems.push(`non-web material: ${m}`);
  for (const t of root.listTextures()) {
    const h = crypto.createHash('sha256').update(t.getImage() ?? Buffer.alloc(0)).digest('hex');
    if (!allowed.has(h)) problems.push(`image not on the allowlist: ${t.getName() || t.getURI()} ${h.slice(0, 12)}`);
  }
  const tris = root.listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const animated = new Set(root.listAnimations().flatMap((a) => a.listChannels().map((c) => c.getTargetNode())));
  if (bytes > budget.bytes) problems.push(`size ${(bytes / 1e6).toFixed(2)} MB > ${(budget.bytes / 1048576).toFixed(0)} MB`);
  if (tris > budget.triangles) problems.push(`${tris} triangles > ${budget.triangles}`);
  if (mats.length > budget.materials) problems.push(`${mats.length} materials > ${budget.materials}`);
  if (animated.size > budget.animatedNodes) problems.push(`${animated.size} animated nodes > ${budget.animatedNodes}`);
  if (!root.listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) problems.push('not meshopt-compressed');
  return { file: path.basename(file), bytes, triangles: Math.round(tris), materials: mats.length, animatedNodes: animated.size, problems };
}

/** File names build.mjs --all writes into web/public/models/<mod>/ (and so may delete again): <slug>[.<kind>].<hash8>.glb */
export const OWNED = /^[a-z0-9][a-z0-9-]*(\.(damaged|fracture|stages))?\.[0-9a-f]{8}\.glb$/;
const kindOf = (file) => file.match(/\.(damaged|fracture|stages)\.[0-9a-f]{8}\.glb$/)?.[1] ?? 'intact';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const io_ = await io();
  // default: the hero files in web/public/models/ and every mod folder below it (web/public/models/<mod>/*.glb)
  const mods = fs.readdirSync(MODELS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : [
    ...fs.readdirSync(MODELS).filter((f) => f.endsWith('.glb')).map((f) => path.join(MODELS, f)),
    ...mods.flatMap((m) => fs.readdirSync(path.join(MODELS, m)).filter((f) => f.endsWith('.glb')).map((f) => path.join(MODELS, m, f))),
  ];
  let bad = 0;
  const touched = new Map();
  for (const f of files) {
    const mod = path.dirname(f) === MODELS ? null : path.basename(path.dirname(f));
    const kind = mod ? kindOf(path.basename(f)) : 'intact';
    const r = await validateFile(f, io_, kind === 'intact' ? BUDGET : VARIANT_BUDGET);
    const slug = r.file.split('.')[0];
    const provFile = mod ? path.join(PROV, mod, `${slug}.provenance.json`) : path.join(PROV, `${slug}.provenance.json`);
    if (fs.existsSync(provFile)) {
      const prov = touched.get(provFile) ?? JSON.parse(fs.readFileSync(provFile, 'utf8'));
      const validation = { at: new Date().toISOString(), ...r };
      if (mod) {
        // one provenance per block, a status per file; the block is clean when every file it lists is
        const entry = prov.files?.[kind];
        if (entry && path.basename(entry.path) === r.file) {
          entry.status = r.problems.length ? 'needs-review' : 'clean';
          entry.validation = { ...validation, budget: kind === 'intact' ? 'site' : 'variant' };
          delete entry.removed;
        }
        prov.status = Object.values(prov.files ?? {}).every((e) => e.status === 'clean') ? 'clean' : 'needs-review';
      } else {
        prov.status = r.problems.length ? 'needs-review' : 'clean';
        prov.validation = validation;
      }
      touched.set(provFile, prov);
    }
    const where = mod ? `${mod}/${r.file}` : r.file;
    console.log(`${r.problems.length ? 'FAIL' : 'PASS'} ${where}: ${(r.bytes / 1024).toFixed(0)} KB, ${r.triangles} tris, ${r.materials} materials, ${r.animatedNodes} animated nodes${r.problems.length ? '\n   - ' + r.problems.join('\n   - ') : ''}`);
    if (r.problems.length) bad++;
  }
  for (const [file, prov] of touched) fs.writeFileSync(file, JSON.stringify(prov, null, 1) + '\n');

  // the mod manifests (web/src/data/models/<mod>.json) may only reference files that exist and whose provenance is clean
  const MANIFESTS = path.resolve(MODELS, '..', '..', 'src', 'data', 'models');
  let manifestProblems = 0;
  for (const mf of fs.existsSync(MANIFESTS) ? fs.readdirSync(MANIFESTS).filter((f) => f.endsWith('.json')) : []) {
    const mod = mf.replace(/\.json$/, '');
    const referenced = new Set();
    for (const e of JSON.parse(fs.readFileSync(path.join(MANIFESTS, mf), 'utf8'))) {
      const provFile = path.join(PROV, mod, `${e.slug}.provenance.json`);
      const prov = fs.existsSync(provFile) ? JSON.parse(fs.readFileSync(provFile, 'utf8')) : null;
      for (const [kind, url] of Object.entries(e.files)) {
        const problem = !url.startsWith(`/models/${mod}/`) ? 'outside the mod folder'
          : !fs.existsSync(path.join(MODELS, mod, path.basename(url))) ? 'missing on disk'
          : prov?.files?.[kind]?.path !== url ? 'no provenance for this file'
          : prov.files[kind].status !== 'clean' ? `provenance status ${prov.files[kind].status}` : null;
        referenced.add(path.basename(url));
        if (problem) { console.log(`FAIL manifest ${mf}: ${e.id} ${kind} ${url}: ${problem}`); manifestProblems++; }
      }
    }
    const dir = path.join(MODELS, mod);
    const orphans = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.glb') && !referenced.has(f)) : [];
    if (orphans.length) console.log(`WARN ${mod}/: ${orphans.length} GLB(s) no manifest entry references: ${orphans.join(', ')}`);
    console.log(`manifest ${mf}: ${referenced.size} files referenced${manifestProblems ? '' : ', all present and clean'}`);
  }
  process.exit(bad || manifestProblems ? 1 : 0);
}
