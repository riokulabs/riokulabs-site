/**
 * Stage the allow-listed launch media into cms/seed/media/ (committed: these are the files the site uses).
 * Reads ONLY the paths listed under `public` in config/privacy.json (the public half of docs/website/seed-allowlist.json),
 * from the workspace's resources/ folder. Refuses anything matching a deny pattern or under a neverSeed path; both come
 * from the private lists (config/privacy.local.json), so it refuses to run without them.
 * Loops over `reencodeIfOverBytes` are re-encoded with ffmpeg (CONTENT-MODEL §9.3). GIFs are never copied.
 * Run once (or after the showcase changes): npm run prepare-media
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { compilePatterns, loadPrivacyConfig, loadPrivacyLocal } from '../src/utils/privacy';

const CMS = path.resolve(__dirname, '..');
const WS = path.resolve(CMS, '..', '..', '..');
const OUT = path.join(CMS, 'seed', 'media');
if (!loadPrivacyLocal(CMS)) {
  console.error('prepare-media: the private lists (config/privacy.local.json) are missing; without the real deny patterns and neverSeed paths it would not be safe to read the workspace. Aborting.');
  process.exit(1);
}
const cfg: any = loadPrivacyConfig(CMS);
const deny = compilePatterns(cfg.denyPatterns, 'i');
const neverSeed: string[] = (cfg.neverSeed ?? []).map((s: string) => s.split(' ')[0]);

function guard(rel: string) {
  if (deny.some((re) => re.test(rel))) throw new Error(`refusing ${rel}: matches a deny pattern`);
  if (neverSeed.some((n) => rel.startsWith(n))) throw new Error(`refusing ${rel}: on the neverSeed list`);
  if (/\.gif$/i.test(rel)) throw new Error(`refusing ${rel}: no GIFs on the site`);
}

const manifest: { file: string; source: string; bytes: number; sha256: string; reencoded?: boolean }[] = [];
function record(dest: string, source: string, reencoded = false) {
  const buf = fs.readFileSync(dest);
  manifest.push({
    file: path.relative(OUT, dest),
    source,
    bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    ...(reencoded ? { reencoded } : {}),
  });
}

function copy(rel: string, destRel: string) {
  guard(rel);
  const src = path.join(WS, rel);
  const dest = path.join(OUT, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  record(dest, rel);
}

function encode(src: string, dest: string, scale: number, crf: number) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${scale}:-2,fps=30`, '-c:v', 'libx264', '-crf', String(crf),
    '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', dest]);
}

// 1. Showcase stills
const st = cfg.public.showcaseStills;
for (const f of st.files) copy(path.join(st.dir, f), path.join('showcase', f));

// 2. Showcase loops: MP4 + poster; re-encode oversized MP4s (1280 px crf 26 → crf 30 → 960 px crf 30)
const lp = cfg.public.showcaseLoops;
for (const [mp4, poster] of lp.files) {
  copy(path.join(lp.dir, poster), path.join('showcase', poster));
  const rel = path.join(lp.dir, mp4);
  guard(rel);
  const src = path.join(WS, rel);
  const dest = path.join(OUT, 'showcase', mp4);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(src).size <= lp.reencodeIfOverBytes) {
    fs.copyFileSync(src, dest);
    record(dest, rel);
    continue;
  }
  // Always drop audio and add faststart, even when the recipe is enough.
  for (const [scale, crf] of [[1280, 26], [1280, 30], [960, 30], [960, 33]]) {
    encode(src, dest, scale, crf);
    const size = fs.statSync(dest).size;
    console.log(`re-encoded ${mp4} at ${scale}px crf ${crf}: ${(size / 1e6).toFixed(2)} MB`);
    if (size <= lp.reencodeIfOverBytes) break;
  }
  record(dest, rel, true);
}

// 3. Build history: img/ and thumb/ for the allow-listed families only
const hf = cfg.public.historyFamilies;
const timeline = JSON.parse(fs.readFileSync(path.join(WS, hf.timeline), 'utf8'));
for (const fam of timeline.families) {
  if (!hf.families.includes(fam.id)) continue;
  for (const s of fam.stages) {
    copy(path.join('resources/history', s.img), path.join('history', s.img));
    copy(path.join('resources/history', s.thumb), path.join('history', s.thumb));
  }
}
// The timeline itself, filtered: allow-listed families and milestones with no deny-pattern hit.
const filtered = {
  generated: timeline.generated,
  families: timeline.families
    .filter((f: any) => hf.families.includes(f.id))
    .map((f: any) => ({ ...f, stages: f.stages.map(({ source, ...s }: any) => s) })),
  milestones: timeline.milestones.filter((m: any) => !deny.some((re) => re.test(`${m.label} ${m.note}`))),
};
fs.writeFileSync(path.join(CMS, 'seed', 'timeline.public.json'), JSON.stringify(filtered, null, 2) + '\n');
fs.copyFileSync(path.join(WS, st.captions), path.join(CMS, 'seed', 'shots.json'));

fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = manifest.reduce((n, m) => n + m.bytes, 0);
console.log(`prepare-media: ${manifest.length} files, ${(total / 1e6).toFixed(1)} MB → seed/media/ ; ` +
  `${filtered.families.length} families, ${filtered.milestones.length}/${timeline.milestones.length} milestones`);
