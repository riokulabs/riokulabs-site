/**
 * Build the viewer GLBs (BLOCK-VIEWER §2.3), end to end, without writing anything under the workspace's mods/:
 *  1. stage a SCRATCH copy of the generators (mods/DataCenter/Source/Model) and the shared modelling library
 *     (tools/se2-modkit/src/se2modkit; export_glb.py aliases the generators' `se2model` to se2modkit.model) plus the read-only
 *     inputs they need (the KVM trajectories from resources/previews, the vanilla FBXs the CRAC / UPS kit imports read)
 *     into tools/export-glb/.work/ws (gitignored);
 *  2. run Blender headless on export_glb.py against that copy → .work/raw/<Block>.glb + report;
 *  3. finish.mjs: web materials + our textures + meshopt → web/public/models/<slug>.<hash>.glb + provenance;
 *  4. validate.mjs gates every output.
 *    node build.mjs [BLOCK ...]     (default: the four hero blocks)
 *
 * Every catalogue block, plus variants, published into the site (never touching the hero files or models.json):
 *    node build.mjs --all [--variants] [--mod <slug>] [--jobs N] [--from-worktree] [BLOCK_OR_GLOB ...]
 *  --all            every block of dc/catalog.CATALOGUE (or only the given names / globs; a subset run keeps the other
 *                   blocks' manifest entries), the extra clips on (rack tray fans), each block to
 *                   web/public/models/<mod>/<slug>.<hash8>.glb (content-hashed: cache forever), the manifest to
 *                   web/src/data/models/<mod>.json (files = site URLs), provenance to provenance/<mod>/<slug>.provenance.json.
 *                   Every file is gated by validate.mjs as it is written; a failing file is deleted and left out of the
 *                   manifest (the site only loads clean models). Hashed files no manifest entry references are removed.
 *  --variants       also <slug>.damaged.<hash8>.glb, .fracture., .stages. (export_glb.py export_variants);
 *  --mod <slug>     the mod's folder / manifest name (default data-center);
 *  --review         the old review output instead: unhashed <slug>[.<kind>].glb + manifest.json + README.md in
 *  --out <dir>      (implies --review) default <workspace>/resources/previews/site-redesign/_assets/models/all;
 *  --jobs N         parallel Blender processes (default 6);
 *  --from-head      stage mods/DataCenter/Source/Model from git HEAD (`git archive`, read-only), not the working tree.
 *                   On by default with --all (the mods session may have work in progress); --from-worktree turns it
 *                   off. tools/ is not a git repo: se2modkit is always copied from disk.
 * Blender never starts while the game runs (pgrep -x Modern.bin).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the workspace root (read-only for us): the nearest ancestor with mods/DataCenter, so the exporter also runs from a
// git worktree of this repo (apps/riokulabs-site/.claude/worktrees/<name>/), not only from apps/riokulabs-site.
const WS = (() => {
  for (let d = path.resolve(HERE, '..', '..', '..'); d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'mods', 'DataCenter'))) return d;
  }
  return path.resolve(HERE, '..', '..', '..', '..');
})();
const WORK = path.join(HERE, '.work');
const SCRATCH = path.join(WORK, 'ws');
const RAW = path.join(WORK, 'raw');
export const HERO_BLOCKS = ['DC_Rack42_SplitFront', 'DC_Srv_KVM', 'DC_CRAC', 'DC_Tray_StraightL_Full'];

const argv = process.argv.slice(2);
const VALUED = new Set(['--out', '--jobs', '--mod']);
const flag = (f) => argv.includes(f);
const value = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const blocks = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(argv[i - 1])));
const ALL = flag('--all');
const VARIANTS = flag('--variants');
const FROM_HEAD = flag('--from-head') || (ALL && !flag('--from-worktree'));

/** copy src to dest (replacing it), without symlinks; `skip` names top-level entries, `skipAny` names at any depth */
function copyTree(src, dest, skip = [], skipAny = []) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (p) => {
      const parts = path.relative(src, p).split(path.sep);
      return !skip.includes(parts[0]) && !parts.some((s) => skipAny.includes(s)) && !fs.lstatSync(p).isSymbolicLink();
    },
  });
}

/** mods/DataCenter/Source/Model at git HEAD into dest (git archive: reads the repo, writes only into .work). */
function archiveHead(dest) {
  const repo = path.join(WS, 'mods', 'DataCenter');
  const tmp = path.join(WORK, 'head');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const tar = path.join(WORK, 'head.tar');
  execFileSync('git', ['-C', repo, 'archive', '--format=tar', '-o', tar, 'HEAD', 'Source/Model']);
  execFileSync('tar', ['-x', '-f', tar, '-C', tmp]);
  fs.rmSync(tar, { force: true });
  const rev = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  copyTree(path.join(tmp, 'Source', 'Model'), dest, ['preview', 'Models', 'review', '__pycache__']);
  fs.rmSync(tmp, { recursive: true, force: true });
  return rev;
}

function stage() {
  // copies only; the sources are never opened for writing
  const modelSrc = path.join(WS, 'mods', 'DataCenter', 'Source', 'Model');
  const modelDst = path.join(SCRATCH, 'mods', 'DataCenter', 'Source', 'Model');
  if (path.relative(path.join(WS, 'mods'), modelDst).startsWith('..') === false) throw new Error('scratch must not be under mods/');
  const rev = FROM_HEAD ? archiveHead(modelDst) : (copyTree(modelSrc, modelDst, ['preview', 'Models', 'review', '__pycache__']), null);
  // the shared modelling library: se2modkit (se2modkit.model; export_glb.py aliases the generators' `se2model` to it)
  const MODKIT = path.join('tools', 'se2-modkit', 'src', 'se2modkit');
  copyTree(path.join(WS, MODKIT), path.join(SCRATCH, MODKIT), [], ['__pycache__', 'tests', '.pytest_cache']);
  fs.rmSync(path.join(SCRATCH, 'tools', 'se2model'), { recursive: true, force: true });   // an older run's copy
  const traj = path.join(modelDst, 'preview', 'plan4', 'traj');
  fs.mkdirSync(traj, { recursive: true });
  for (const f of ['open.csv', 'close.csv']) fs.copyFileSync(path.join(WS, 'resources', 'previews', 'DataCenter', 'main', 'plan4', 'traj', f), path.join(traj, f));
  // The CRAC's and the UPS's builders import vanilla frames as kit parts; the exporter removes them again (never shipped).
  for (const [rel, files] of [
    [path.join('Blocks', 'O2H2Generator', '250', 'Models', 'NonFractured'), ['O2Generator250.fbx', 'O2Generator250_LOD1.fbx']],
    [path.join('Blocks', 'Batteries', 'Battery', '50', 'Models', 'NonFractured'), ['Battery50.fbx', 'Battery50_LOD1.fbx', 'Battery50_LOD2.fbx']],
  ]) {
    fs.mkdirSync(path.join(SCRATCH, 'tools', 'vanilla-ref', rel), { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(WS, 'tools', 'vanilla-ref', rel, f), path.join(SCRATCH, 'tools', 'vanilla-ref', rel, f));
  }
  console.log(`staged scratch copy in ${path.relative(process.cwd(), SCRATCH)}${rev ? ` (mods/DataCenter HEAD ${rev.slice(0, 10)})` : ' (working tree)'}`);
  return rev;
}

function gameRunning() {
  try {
    execFileSync('pgrep', ['-x', 'Modern.bin'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function guardGame() {
  if (gameRunning()) {
    console.error('the game (Modern.bin) is running: not starting Blender. Close it and re-run.');
    process.exit(2);
  }
}

if (!ALL) {
  // ------------------------------------------------------------------ the hero export (unchanged)
  const targets = blocks.length ? blocks : HERO_BLOCKS;
  stage();
  guardGame();
  fs.mkdirSync(RAW, { recursive: true });
  execFileSync('blender', ['-b', '--factory-startup', '--python', path.join(HERE, 'export_glb.py'), '--', '--ws', SCRATCH, '--out', RAW, ...targets], {
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: WORK,
  });
  execFileSync(process.execPath, [path.join(HERE, 'finish.mjs'), ...targets], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(HERE, 'validate.mjs')], { stdio: 'inherit' });
} else {
  await buildAll();
}

// ---------------------------------------------------------------------------------------------- --all mode
async function buildAll() {
  const { io, finishFile, ourImages, SLUGS, relabel } = await import('./finish.mjs');
  const { validateFile, BUDGET, VARIANT_BUDGET, OWNED } = await import('./validate.mjs');
  // site mode (default): web/public/models/<mod>/<slug>[.<kind>].<hash8>.glb, manifest web/src/data/models/<mod>.json,
  // provenance/<mod>/<slug>.provenance.json. Review mode (--review or --out): unhashed files + manifest.json + README.md.
  const SITE_MODE = !flag('--review') && !argv.includes('--out');
  const MOD = value('--mod', 'data-center');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(MOD)) throw new Error(`--mod must be a slug (a-z, 0-9, -): ${MOD}`);
  const SITE = path.resolve(HERE, '..', '..', 'web');
  const URL_BASE = `/models/${MOD}/`;
  const MANIFEST = path.join(SITE, 'src', 'data', 'models', `${MOD}.json`);
  const PROV_DIR = path.join(HERE, 'provenance', MOD);
  const OUT = SITE_MODE
    ? path.join(SITE, 'public', 'models', MOD)
    : path.resolve(value('--out', path.join(WS, 'resources', 'previews', 'site-redesign', '_assets', 'models', 'all')));
  for (const forbidden of ['mods', 'tools', 'org']) {
    if (!path.relative(path.join(WS, forbidden), OUT).startsWith('..')) throw new Error(`--out must not be under ${forbidden}/`);
  }
  const RAW_ALL = path.join(WORK, 'raw-all');
  const LOGS = path.join(WORK, 'logs');
  const jobs = Math.max(1, parseInt(value('--jobs', '6'), 10));
  const t0 = Date.now();

  const rev = stage();
  const modelDir = path.join(SCRATCH, 'mods', 'DataCenter', 'Source', 'Model');
  const catalogue = JSON.parse(execFileSync('python3', ['-c', [
    'import json, sys', `sys.path.insert(0, ${JSON.stringify(modelDir)})`, 'from dc import catalog',
    `pats = ${JSON.stringify(blocks)}`,
    'names = catalog.expand(pats) if pats else [b.name for b in catalog.CATALOGUE]',
    'print(json.dumps(names))'].join('\n')], { encoding: 'utf8', cwd: WORK }));
  console.log(`${catalogue.length} blocks`);

  fs.rmSync(RAW_ALL, { recursive: true, force: true });
  fs.mkdirSync(RAW_ALL, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  // biggest builds first, spread over the jobs round-robin
  const weight = (n) => (/Rack42|CRAC|PDU_Cabinet|Contain_Door/.test(n) ? 3 : /Rack24|Srv_/.test(n) ? 2 : 1);
  const order = [...catalogue].sort((a, b) => weight(b) - weight(a));
  const chunks = Array.from({ length: Math.min(jobs, order.length) }, () => []);
  order.forEach((n, i) => chunks[i % chunks.length].push(n));
  guardGame();
  const extra = ['--keep-going', '--all-clips', ...(VARIANTS ? ['--variants'] : [])];
  await Promise.all(chunks.map((names, i) => new Promise((resolve) => {
    const log = fs.openSync(path.join(LOGS, `blender-${i}.log`), 'w');
    const p = spawn('timeout', ['--kill-after=30', '3h', 'blender', '-b', '--factory-startup', '--python', path.join(HERE, 'export_glb.py'), '--',
      '--ws', SCRATCH, '--out', RAW_ALL, ...extra, ...names], { stdio: ['ignore', log, log], cwd: WORK });
    p.on('exit', (code) => { fs.closeSync(log); console.log(`blender job ${i} (${names.length} blocks) exited ${code}`); resolve(code); });
  })));

  // finish every raw file into OUT, gate each one with the validator as it is written; a file that fails is deleted
  // again and left out of the manifest (the site only ever references clean files).
  fs.mkdirSync(OUT, { recursive: true });
  if (!SITE_MODE) for (const f of fs.readdirSync(OUT)) if (f.endsWith('.glb') || f === 'manifest.json') fs.rmSync(path.join(OUT, f));
  const io_ = await io();
  const FAMILY = { rack: 'rack', server: 'server', tray: 'tray', trayrods: 'tray' };
  const images = ourImages();
  const manifest = [];
  const failed = [];
  const fails = [];
  let pass = 0;
  const outName = (slug, kind) => {
    const base = kind === 'intact' ? slug : `${slug}.${kind}`;
    return SITE_MODE ? (sha) => path.join(OUT, `${base}.${sha.slice(0, 8)}.glb`) : path.join(OUT, `${base}.glb`);
  };
  /** finish + gate one file; returns the finish result with its validation, the file removed again if it failed */
  const produce = async (raw, slug, kind) => {
    const r = await finishFile(io_, raw, outName(slug, kind), slug);
    const budget = kind === 'intact' ? BUDGET : VARIANT_BUDGET;
    const v = await validateFile(r.file, io_, budget);
    r.validation = { at: new Date().toISOString(), budget: kind === 'intact' ? 'site' : 'variant', problems: v.problems };
    r.clean = v.problems.length === 0;
    if (r.clean) pass++;
    else { fails.push(v); fs.rmSync(r.file, { force: true }); }
    return r;
  };
  for (const name of catalogue) {
    const rep = path.join(RAW_ALL, `${name}.report.json`);
    if (!fs.existsSync(path.join(RAW_ALL, `${name}.glb`)) || !fs.existsSync(rep)) {
      const err = path.join(RAW_ALL, `${name}.error.json`);
      failed.push({ id: name, error: fs.existsSync(err) ? JSON.parse(fs.readFileSync(err, 'utf8')).error : 'no output (see .work/logs)' });
      continue;
    }
    const report = JSON.parse(fs.readFileSync(rep, 'utf8'));
    const slug = SLUGS[name] ?? name.toLowerCase().replace(/_/g, '-');
    const ref = (r) => (SITE_MODE ? `${URL_BASE}${path.basename(r.file)}` : path.basename(r.file));
    const provFiles = {};
    const provEntry = (r) => ({
      path: ref(r), bytes: r.bytes, sha256: r.sha256, triangles: r.triangles, materials: r.materials, clips: r.clips,
      validation: r.validation, status: r.clean ? 'clean' : 'needs-review', ...(r.clean ? {} : { removed: true }),
    });
    const intact = await produce(path.join(RAW_ALL, `${name}.glb`), slug, 'intact');
    provFiles.intact = provEntry(intact);
    const files = {};
    const variants = {};
    const v = report.variants ?? {};
    const missing = { ...(v.missing ?? {}) };
    if (intact.clean) {
      files.intact = ref(intact);
      for (const kind of VARIANTS ? ['damaged', 'fracture', 'stages'] : []) {
        const raw = path.join(RAW_ALL, `${name}.${kind}.glb`);
        if (!fs.existsSync(raw)) {
          missing[kind] ??= report.variants ? 'not produced' : 'variant export failed (see error)';
          continue;
        }
        const r = await produce(raw, slug, kind);
        provFiles[kind] = provEntry(r);
        if (!r.clean) { missing[kind] = `failed validation: ${r.validation.problems.join('; ')}`; continue; }
        files[kind] = ref(r);
        variants[kind] = { bytes: r.bytes, tris: r.triangles, ...(v[kind] ?? {}) };
      }
      if (VARIANTS && fs.existsSync(path.join(RAW_ALL, `${name}.error.json`))) {
        missing.error = JSON.parse(fs.readFileSync(path.join(RAW_ALL, `${name}.error.json`), 'utf8')).error;
      }
    } else {
      failed.push({ id: name, error: `intact model failed validation: ${intact.validation.problems.join('; ')}` });
    }
    if (SITE_MODE) {
      const clean = Object.values(provFiles).every((f) => f.status === 'clean');
      fs.mkdirSync(PROV_DIR, { recursive: true });
      fs.writeFileSync(path.join(PROV_DIR, `${slug}.provenance.json`), JSON.stringify({
        block: name, slug, mod: MOD, files: provFiles,
        exporter: 'tools/export-glb build.mjs --all (Route A: scratch copy of mods/DataCenter/Source/Model at git HEAD + se2modkit.model, read-only)',
        modsHead: rev, generatedAt: new Date().toISOString(),
        nodes: relabel(report.nodes), kitPartsReplaced: relabel(report.kit_replaced), variantKitPartsReplaced: report.variants_kit_replaced ?? 0,
        decalsDropped: report.decals_dropped, glyphQuadsRemapped: report.glyphs_remapped, stickersRedrawn: report.stickers_redrawn ?? {},
        materialSources: relabel(report.materials), clips: report.clips, images,
        status: clean ? 'clean' : 'needs-review',
      }, null, 1) + '\n');
    }
    if (!intact.clean) continue;
    manifest.push({
      id: name, slug,
      displayName: report.display_name ?? name,
      family: FAMILY[report.family] ?? 'room',
      subfamily: report.family,
      sizeLabel: sizeLabel(name, report),
      dims_m: intact.dims_m,
      tris: intact.triangles,
      bytes: intact.bytes,
      clips: intact.clips,
      files,
      paintable: intact.materials.includes('WEB_Paint'),
      materials: intact.materials,
      ...(VARIANTS ? { variants, missing } : {}),
    });
    console.log(`finished ${name}: ${Object.values(files).map((f) => path.basename(f)).join(', ')}`);
  }

  let final = manifest;
  if (SITE_MODE) {
    // a subset run keeps the other blocks' entries (and so their files); catalogue order
    if (blocks.length && fs.existsSync(MANIFEST)) {
      const rebuilt = new Set(catalogue);
      const prev = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
      const fresh = new Map(manifest.map((e) => [e.id, e]));
      // rebuilt entries keep their place; one that failed this time drops out; new ones go last
      final = [...prev.flatMap((e) => (!rebuilt.has(e.id) ? [e] : fresh.has(e.id) ? [fresh.get(e.id)] : [])),
        ...manifest.filter((e) => !prev.some((p) => p.id === e.id))];
    }
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify(final, null, 1) + '\n');
    // stale hashed files: only names this exporter writes, and only those no manifest entry references
    const referenced = new Set(final.flatMap((e) => Object.values(e.files).map((u) => path.basename(u))));
    let stale = 0;
    for (const f of fs.readdirSync(OUT)) {
      if (OWNED.test(f) && !referenced.has(f)) { fs.rmSync(path.join(OUT, f)); stale++; }
    }
    if (stale) console.log(`removed ${stale} stale file(s) from ${path.relative(process.cwd(), OUT)}`);
  } else {
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  }

  for (const f of fails) console.log(`FAIL ${f.file}\n   - ${f.problems.join('\n   - ')}`);
  const total = fs.readdirSync(OUT).filter((f) => f.endsWith('.glb')).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  const summary = {
    generatedAt: new Date().toISOString(), modsHead: rev, out: OUT, manifest: SITE_MODE ? MANIFEST : path.join(OUT, 'manifest.json'),
    blocks: catalogue.length, exported: manifest.length, failed,
    damaged: manifest.filter((m) => m.files.damaged).length, fracture: manifest.filter((m) => m.files.fracture).length,
    stages: manifest.filter((m) => m.files.stages).length, totalBytes: total, validation: { pass, fail: fails.length, fails },
    minutes: +((Date.now() - t0) / 60000).toFixed(1),
  };
  fs.writeFileSync(path.join(WORK, 'all-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  if (!SITE_MODE) writeReadme(OUT, manifest, summary);    // never a README inside web/public (it would be served)
  console.log(`exported ${manifest.length}/${catalogue.length} blocks (damaged ${summary.damaged}, fracture ${summary.fracture}, stages ${summary.stages}); ` +
    `${(total / 1048576).toFixed(1)} MB in ${path.relative(process.cwd(), OUT)}; validation ${pass} pass / ${fails.length} fail; ${summary.minutes} min`);
  if (failed.length) console.log('failed:', failed);
  process.exit(fails.length || failed.length ? 1 : 0);
}

function sizeLabel(name, report) {
  const c = report.cells ?? [0, 0, 0];
  const fam = report.family;
  const tail = name.split('_').pop();
  const m = { '025': '0.25 m', '050': '0.5 m', '100': '1.0 m', '150': '1.5 m', '200': '2.0 m' };
  if (fam === 'rack' || fam === 'pdu_strip') return name.includes('42') ? '42U' : '24U';
  if (fam === 'server') return c[1] === 2 ? '12U' : '6U';
  if (fam === 'trayrods') return m[tail];
  if (fam === 'tray' && report.variant === 'StraightS') return '0.5 m';
  if (fam === 'tray' && report.variant === 'StraightL') return '1.5 m';
  if (fam === 'floor') return `${m[tail]} tile`;
  if (fam === 'contain_door' || fam === 'contain_roof') return `${m[tail]} aisle`;
  if (fam === 'crac' || fam === 'pdu_cabinet') return '42U';
  return null;
}

function writeReadme(OUT, manifest, s) {
  const mb = (b) => (b / 1048576).toFixed(1);
  const sum = (k) => manifest.reduce((n, m) => n + (m.files[k] ? (k === 'intact' ? m.bytes : m.variants?.[k]?.bytes ?? 0) : 0), 0);
  const miss = {};
  for (const m of manifest) for (const [k, why] of Object.entries(m.missing ?? {})) (miss[`${k}: ${why}`] ??= []).push(m.id);
  const lines = [
    '# Data Center blocks: all GLBs (review only)',
    '',
    'Review-only preview files for the site redesign mockup. Never committed. Regenerate with:',
    '',
    '```bash',
    'cd apps/riokulabs-site/tools/export-glb',
    'node build.mjs --all --variants --review # writes this folder; --from-worktree to build the mods working tree instead of HEAD',
    '```',
    '',
    `Generated ${s.generatedAt} from mods/DataCenter git HEAD ${s.modsHead ?? '(working tree)'} (scratch copy; nothing under mods/ is written), ` +
      `se2modkit (tools/se2-modkit) from disk. ${s.minutes} min.`,
    '',
    '## What is here',
    '',
    `- ${s.exported} of ${s.blocks} blocks: \`<slug>.glb\` (intact, web materials, clips: DoorsOpen/DoorsClose, KvmOpen/KvmClose, ` +
      'FansSpinUp/FansRun; the containment doors slide, the full racks\' tray fans spin). Total ' + `${mb(sum('intact'))} MB.`,
    `- ${s.damaged} \`<slug>.damaged.glb\`: the Damaged ("Deformed") LOD0 the game swaps in when the block takes damage: the ` +
      'Fractured model without its scaffold, densified and dented by the mod\'s own exporter, lamps and screens in their broken ' +
      `look; the parked subparts (doors, fans, drawer) are baked in as in game. ${mb(sum('damaged'))} MB.`,
    `- ${s.fracture} \`<slug>.fracture.glb\`: the Fractured LOD0, one node per fracture zone (\`Frac_01\` .. = the game's ` +
      '`Fracture_01` ..), each with its origin at the zone\'s centre and its break faces (dark) closed, so a viewer can push the ' +
      `nodes apart along (node position - model centre). manifest.json lists zone, critical and health share. ${mb(sum('fracture'))} MB.`,
    `- ${s.stages} \`<slug>.stages.glb\`: ONE file per block with nodes \`Stage_1\` .. \`Stage_N\` (show one at a time), the ` +
      'construction stages as the game\'s BuildProgressModels show them (dc/construction.generate_stages over the Fractured ' +
      'LOD0 mesh parts): parts hidden or shown per stage, construction materials as our own flat stand-ins ' +
      '(WEB_BuildGhost1..3: the transparent first sequence firming up, WEB_BuildPrimer1..3: the solid second, primer to ' +
      'near-finish, WEB_Scaffold: the scaffold cage). Every stage differs from the one before; a mod stage that would look ' +
      'the same in web materials is folded into the previous node (variants.stages.nodes[].also_ratios). ' +
      'The finished block is the intact file. One file instead of N: the stages share their meshes (smaller). ' +
      `${mb(sum('stages'))} MB.`,
    `- manifest.json: one entry per block (id, slug, displayName, family, sizeLabel, dims_m, tris, clips, files, paintable, ` +
      'variants, missing).',
    '',
    `Total ${mb(s.totalBytes)} MB. Validation (validate.mjs gates: no Keen markers or kit parts, only WEB_* materials, only ` +
      `allow-listed images, meshopt): ${s.validation.pass} pass, ${s.validation.fail} fail. Budget: intact files the site's ` +
      '(2 MB, 60k tris, 12 materials); variant files relaxed to 4 MB, 160k tris, 16 materials.',
    '',
    '## Field notes',
    '',
    '- `dims_m`: the intact model\'s bounding box in metres in the glTF frame: [x, y (up), z], rest pose (doors shut).',
    '- `family`: rack | server | tray (trays and hanger rods) | room; `subfamily` is the mod\'s own family name.',
    '- `displayName`: the build-menu name (dc/names.py, the same text as the block definitions\' UIData.Name). Size ' +
      'variants share it; `sizeLabel` tells them apart (42U / 24U, 6U / 12U, tray lengths, tile size, aisle width), null where ' +
      'the block has one size.',
    '- `variants.<kind>`: bytes and tris of the file, plus the exporter\'s notes (fracture: nodes with zone / critical / ' +
      'health_share / centre_m in the Blender Z-up block frame; stages: nodes with build_ratio).',
    '',
    '## Missing',
    '',
    ...(Object.keys(miss).length ? Object.entries(miss).map(([k, ids]) => `- ${k} (${ids.length}): ${ids.join(', ')}`) : ['- nothing']),
    ...(s.failed.length ? ['', 'Failed blocks:', ...s.failed.map((f) => `- ${f.id}: ${f.error}`)] : []),
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'README.md'), lines.join('\n'));
}
