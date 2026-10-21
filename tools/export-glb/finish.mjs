/**
 * Finish raw Blender GLBs for the web (BLOCK-VIEWER §2.3 steps 3, 8–10; §4):
 *  - final web PBR values per WEB_* material (flat; painted metal ≈ metalness 0.55 / roughness 0.44, the measured
 *    PaintedMetalColorable averages in docs/reference/se2-material-textures.md — numbers only, no Keen pixels);
 *  - OUR textures only: the Barlow Condensed glyph atlas (stencils) and the perforation tile (door leaves);
 *  - rest pose = the first keyframe of each node's first clip (doors shut, KVM stowed, fans still);
 *  - dedup + prune + meshopt (EXT_meshopt_compression, quantised);
 *  - content-hashed output in web/public/models/, a manifest for the site, and a provenance report.
 *    node finish.mjs [BLOCK ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength, KHRTextureTransform } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, '.work', 'raw');
const SITE = path.resolve(HERE, '..', '..', 'web');
const OUT_DIR = path.join(SITE, 'public', 'models');
const MANIFEST = path.join(SITE, 'src', 'data', 'models.json');
const PROV_DIR = path.join(HERE, 'provenance');
const ASSETS = path.join(HERE, 'assets');

/**
 * Raw exports carry the studio's old group prefix on material, node and frame names (the generators predate the
 * 2026-10-20 rebrand). The prefix itself is private: `legacyModelPrefix` in cms/config/privacy.local.json (gitignored).
 * Every such name is normalised to the brand-neutral web prefix so no studio name ships inside a GLB. Without the
 * private file nothing is renamed, and the material check below plus lint-dist reject any leftover.
 */
const LEGACY_PREFIX = (() => {
  try {
    const p = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', '..', 'cms', 'config', 'privacy.local.json'), 'utf8')).legacyModelPrefix;
    return typeof p === 'string' && /^[A-Za-z0-9]+$/.test(p) ? p : null;
  } catch {
    return null;
  }
})();
export const legacyName = (n) => (LEGACY_PREFIX ? n.replace(new RegExp(`^${LEGACY_PREFIX}_`), 'WEB_').replace(new RegExp(`^${LEGACY_PREFIX}(?=[A-Z])`), 'Web') : n);
/** Same rename inside any JSON-able value (provenance records, manifests). */
export const relabel = (o) =>
  o === undefined || !LEGACY_PREFIX
    ? o
    : JSON.parse(JSON.stringify(o).replace(new RegExp(`"${LEGACY_PREFIX}_`, 'g'), '"WEB_').replace(new RegExp(`${LEGACY_PREFIX}PortFrame_`, 'g'), 'WebPortFrame_'));

export const SLUGS = {
  DC_Rack42_SplitFront: 'dc-rack42-splitfront',
  DC_Srv_KVM: 'dc-srv-kvm',
  DC_CRAC: 'dc-crac',
  DC_Tray_StraightL_Full: 'dc-tray-straight-full',
};

const lin = (hex) => {
  const c = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return [c(parseInt(hex.slice(1, 3), 16)), c(parseInt(hex.slice(3, 5), 16)), c(parseInt(hex.slice(5, 7), 16))];
};

// name -> [baseColor (linear rgb), alpha, metallic, roughness, emissive (linear rgb) | null, emissiveStrength, alphaMode, texture]
export const WEB = {
  WEB_Paint: [lin('#A9ABAF'), 1, 0.55, 0.44],
  WEB_Darker: [[0.07, 0.075, 0.08], 1, 0.55, 0.5],
  WEB_Yellow: [lin('#EDC23F'), 1, 0.55, 0.44],
  WEB_Steel: [[0.62, 0.62, 0.64], 1, 1.0, 0.3],
  WEB_Perf: [[0.62, 0.62, 0.64], 1, 1.0, 0.32, null, 1, 'MASK', 'perf'],
  WEB_Hardware: [[0.4, 0.4, 0.39], 1, 0.9, 0.5],
  WEB_Chrome: [[0.92, 0.93, 0.95], 1, 1.0, 0.06],
  WEB_Rubber: [[0.03, 0.03, 0.03], 1, 0.0, 0.8],
  WEB_Glass: [[0.6, 0.8, 0.9], 0.25, 0.0, 0.05, null, 1, 'BLEND'],
  WEB_GlassFrosted: [[0.7, 0.8, 0.85], 0.55, 0.0, 0.6, null, 1, 'BLEND'],
  WEB_Port: [[0.12, 0.12, 0.13], 1, 0.7, 0.5],
  WEB_LampOff: [[0.03, 0.03, 0.035], 1, 0.0, 0.4],
  WEB_LampGreen: [[0.02, 0.2, 0.05], 1, 0.0, 0.4, [0.1, 1.0, 0.25], 3],
  WEB_LampRed: [[0.2, 0.02, 0.02], 1, 0.0, 0.4, [1.0, 0.08, 0.05], 3],
  WEB_LampAmber: [[0.2, 0.1, 0.0], 1, 0.0, 0.4, [1.0, 0.45, 0.02], 3],
  WEB_LampWhite: [[0.2, 0.2, 0.2], 1, 0.0, 0.4, [0.75, 0.9, 1.0], 2.5],
  WEB_Screen: [[0.01, 0.02, 0.03], 1, 0.0, 0.25, [0.02, 0.09, 0.16], 1],
  WEB_Glyphs: [[0.04, 0.04, 0.04], 1, 0.0, 0.6, null, 1, 'MASK', 'glyphs'],
  WEB_GlyphsWhite: [[0.92, 0.92, 0.92], 1, 0.0, 0.6, null, 1, 'MASK', 'glyphs'],
  WEB_Decals: [[1, 1, 1], 1, 0.0, 0.55, null, 1, 'MASK', 'decals'],
  // construction-stage stand-ins (variant files only; export_glb.py BUILD_MATS): our own flat looks, no Keen pixels
  WEB_BuildGhost1: [[0.45, 0.62, 0.75], 0.18, 0.3, 0.5, [0.05, 0.12, 0.18], 1, 'BLEND'],
  WEB_BuildGhost2: [[0.5, 0.64, 0.74], 0.34, 0.4, 0.5, [0.03, 0.08, 0.12], 1, 'BLEND'],
  WEB_BuildGhost3: [[0.55, 0.66, 0.72], 0.55, 0.5, 0.5, null, 1, 'BLEND'],
  WEB_BuildPrimer1: [[0.16, 0.17, 0.18], 1, 0.3, 0.8],
  WEB_BuildPrimer2: [[0.28, 0.29, 0.3], 1, 0.4, 0.7],
  WEB_BuildPrimer3: [[0.42, 0.43, 0.45], 1, 0.5, 0.55],
  WEB_Scaffold: [[0.25, 0.55, 0.75], 0.55, 0.3, 0.5, [0.08, 0.3, 0.45], 1, 'BLEND'],
};
/** Perforation tile repeats per UV unit (builders project 0.5 UV/m, so 1 UV = 2 m; ≈ 12 mm pitch). */
const PERF_REPEAT = 166;

export async function io() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** Web materials (final PBR values, our textures), legacy-name normalisation, rest pose, scene name. */
async function webify(doc, slug, label) {
  const root = doc.getRoot();
  const strength = doc.createExtension(KHRMaterialsEmissiveStrength);
  const tt = doc.createExtension(KHRTextureTransform);
  const tex = {};
  const texture = (key) => {
    if (tex[key]) return tex[key];
    const file = path.join(ASSETS, { perf: 'web-perf.png', glyphs: 'web-glyphs.png', decals: 'web-decals.png' }[key]);
    tex[key] = doc.createTexture({ perf: 'WEB_PerfTile', glyphs: 'WEB_GlyphAtlas', decals: 'WEB_DecalAtlas' }[key]).setImage(fs.readFileSync(file)).setMimeType('image/png').setURI(path.basename(file));
    return tex[key];
  };

  // Old group prefix → brand-neutral web prefix on every name (see legacyName above).
  const legacy = legacyName;
  for (const x of [...root.listMaterials(), ...root.listNodes(), ...root.listMeshes(), ...root.listTextures(), ...root.listAnimations(), ...root.listScenes()]) x.setName(legacy(x.getName()));
  for (const m of root.listMaterials()) {
    const spec = WEB[m.getName()];
    if (!spec) throw new Error(`${label}: material ${m.getName()} has no web definition`);
    const [rgb, alpha, metal, rough, emissive, emStrength, mode, texKey] = spec;
    m.setBaseColorFactor([...rgb, alpha]).setMetallicFactor(metal).setRoughnessFactor(rough).setDoubleSided(true);
    m.setAlphaMode(mode ?? 'OPAQUE');
    if (mode === 'MASK') m.setAlphaCutoff(0.5);
    m.setEmissiveFactor(emissive ?? [0, 0, 0]);
    if (emissive && emStrength > 1) m.setExtension('KHR_materials_emissive_strength', strength.createEmissiveStrength().setEmissiveStrength(emStrength));
    if (texKey) {
      m.setBaseColorTexture(texture(texKey));
      if (texKey === 'perf') m.getBaseColorTextureInfo().setExtension('KHR_texture_transform', tt.createTransform().setScale([PERF_REPEAT, PERF_REPEAT]));
    }
  }

  // Rest pose: each animated node at the first keyframe of the first clip that drives it.
  const restSet = new Set();
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const key = `${node.getName()}:${ch.getTargetPath()}`;
      if (restSet.has(key)) continue;
      const out = ch.getSampler().getOutput().getArray();
      const n = ch.getTargetPath() === 'rotation' ? 4 : 3;
      const first = Array.from(out.slice(0, n));
      if (ch.getTargetPath() === 'rotation') node.setRotation(first);
      else if (ch.getTargetPath() === 'translation') node.setTranslation(first);
      restSet.add(key);
    }
  }
  root.listScenes().forEach((s) => s.setName(slug));

}

/**
 * Finish any raw GLB (the --all / --variants run): webify + dedup + prune + meshopt, written to outFile (or, when
 * outFile is a function, to outFile(sha256): the site's content-hashed names). No manifest, no provenance (build.mjs
 * writes those). Returns { file, sha256, bytes, triangles, materials, clips, nodes, dims_m (glTF frame: x, y up, z) }.
 */
export async function finishFile(io_, inFile, outFile, slug) {
  const doc = await io_.read(inFile);
  const root = doc.getRoot();
  await webify(doc, slug, path.basename(inFile));
  // One Blender session exports many blocks, so a name may carry Blender's ".001" suffix (Stage_1.001, Body.002):
  // drop it where that leaves the name unique in this file (viewers address Stage_N / Frac_NN / clips by name). It can
  // also sit mid-name (Part_0.009_BuildGhost1); which number Blender picks depends on what the session built before,
  // so stripping it keeps the output (and the site's content hash) the same whether a block is built alone or in a batch.
  for (const list of [root.listNodes(), root.listMeshes()]) {
    const taken = new Set(list.map((x) => x.getName()));
    for (const x of list) {
      const base = x.getName().replace(/\.\d{3}(?=_|$)/g, '');
      if (base !== x.getName() && !taken.has(base)) { taken.delete(x.getName()); taken.add(base); x.setName(base); }
    }
  }
  await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = Buffer.from(await io_.writeBinary(doc));
  const sha256 = crypto.createHash('sha256').update(glb).digest('hex');
  const file = typeof outFile === 'function' ? outFile(sha256) : outFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, glb);
  const tris = root.listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const { min, max } = getBounds(root.listScenes()[0]);
  return {
    file, sha256, bytes: glb.length, triangles: Math.round(tris), materials: root.listMaterials().map((m) => m.getName()),
    clips: root.listAnimations().map((a) => a.getName()), nodes: root.listNodes().map((n) => n.getName()),
    dims_m: max.map((v, i) => +(v - min[i]).toFixed(3)),
  };
}

/** Our generated textures (the only images a GLB may embed), for provenance reports. */
export function ourImages() {
  return fs.readdirSync(ASSETS).filter((f) => f.endsWith('.png')).map((f) => ({ file: f, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ASSETS, f))).digest('hex'), origin: 'generated by tools/export-glb/make_assets.py' }));
}

async function finish(block, io_) {
  const slug = SLUGS[block] ?? block.toLowerCase().replace(/_/g, '-');
  const doc = await io_.read(path.join(RAW, `${block}.glb`));
  const root = doc.getRoot();
  const report = JSON.parse(fs.readFileSync(path.join(RAW, `${block}.report.json`), 'utf8'));
  await webify(doc, slug, block);
  await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = Buffer.from(await io_.writeBinary(doc));
  const hash = crypto.createHash('sha256').update(glb).digest('hex');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) if (f.startsWith(slug + '.') && f.endsWith('.glb')) fs.unlinkSync(path.join(OUT_DIR, f));
  const file = `${slug}.${hash.slice(0, 8)}.glb`;
  fs.writeFileSync(path.join(OUT_DIR, file), glb);

  const tris = root.listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const entry = {
    block, slug, glbPath: `/models/${file}`, bytes: glb.length, sha256: hash, triangles: Math.round(tris),
    animations: root.listAnimations().map((a) => ({ clip: a.getName(), seconds: +Math.max(...a.listSamplers().map((s) => s.getInput().getMax([])[0])).toFixed(3) })),
    materials: root.listMaterials().map((m) => m.getName()),
  };
  fs.mkdirSync(PROV_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROV_DIR, `${slug}.provenance.json`), JSON.stringify({
    ...entry,
    exporter: 'tools/export-glb (Route A: scratch copy of mods/DataCenter/Source/Model + se2modkit.model, read-only)',
    generatedAt: new Date().toISOString(),
    nodes: relabel(report.nodes), kitPartsReplaced: relabel(report.kit_replaced), decalsDropped: report.decals_dropped,
    glyphQuadsRemapped: report.glyphs_remapped, stickersRedrawn: report.stickers_redrawn ?? {}, materialSources: relabel(report.materials), clips: report.clips,
    images: ourImages(),
    status: 'pending-validation',
  }, null, 1) + '\n');
  return entry;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const blocks = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = blocks.length ? blocks : Object.keys(SLUGS);
  const io_ = await io();
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
  for (const b of targets) {
    const e = await finish(b, io_);
    manifest[e.slug] = e;
    console.log(`finished ${b}: ${e.glbPath} ${(e.bytes / 1024).toFixed(0)} KB, ${e.triangles} tris, clips ${e.animations.map((a) => a.clip).join(', ') || '-'}`);
  }
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
}
