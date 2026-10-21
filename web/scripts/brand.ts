/**
 * Install the chosen logo family (src/config/brand.ts LOGO_FAMILY) into public/ before dev/build:
 *   public/brand/logo-lockup.svg, logo-mark.svg, logo-micro.svg, mark-512.png (OG cards), og-default.png,
 *   public/favicon.svg, favicon.ico (16 + 32, PNG-in-ICO), apple-touch-icon.png, icon-192.png, icon-512.png,
 *   icon-512-maskable.png, public/brand/downloads/* (the /brand page), and src/data/brand.json (dimensions,
 *   downloads).
 * Families live in ../brand/riokulabs/<ID>/ (R1…R5, generated in the workspace's resources/brand/riokulabs/) and
 * ../brand/riokulabs/text/ (the plain wordmark fallback). Every PNG icon is rendered from the family's micro mark.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { LOGO_FAMILY } from '../src/config/brand';

const BRAND = path.resolve('..', 'brand', 'riokulabs');
const PUB = path.resolve('public');
const OUT = path.join(PUB, 'brand');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'downloads'), { recursive: true });

const dims = (svg: string) => {
  const m = fs.readFileSync(svg, 'utf8').match(/viewBox="([-\d. ]+)"/);
  const [, , w, h] = m![1].trim().split(/\s+/).map(Number);
  return { w: +w.toFixed(2), h: +h.toFixed(2) };
};
const copy = (from: string, to: string) => fs.copyFileSync(from, to);
const kb = (f: string) => Math.max(1, Math.round(fs.statSync(f).size / 1024));
const raster = (svg: string, size: number) => sharp(fs.readFileSync(svg), { density: Math.max(72, 72 * (size / 16)) }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

/** Minimal ICO writer: PNG-compressed entries (supported by every current browser). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((p, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(p.size >= 256 ? 0 : p.size, o);
    head.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(p.data.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

const isText = LOGO_FAMILY === 'text';
const dir = path.join(BRAND, isText ? 'text' : LOGO_FAMILY);
const id = isText ? 'text' : LOGO_FAMILY.toLowerCase();
if (!fs.existsSync(dir)) throw new Error(`brand: no logo family ${LOGO_FAMILY} in ${dir}`);
const lockup = path.join(dir, `${id}-lockup.svg`);
const micro = path.join(dir, `${id}-micro.svg`);
const mark = isText ? micro : path.join(dir, `${id}-mark.svg`);

copy(lockup, path.join(OUT, 'logo-lockup.svg'));
copy(mark, path.join(OUT, 'logo-mark.svg'));
copy(micro, path.join(OUT, 'logo-micro.svg'));
copy(micro, path.join(PUB, 'favicon.svg'));
fs.writeFileSync(path.join(PUB, 'favicon.ico'), ico([{ size: 16, data: await raster(micro, 16) }, { size: 32, data: await raster(micro, 32) }]));
fs.rmSync(path.join(PUB, 'favicon-32.png'), { force: true });
const tile = async (size: number, file: string, pad: number) => {
  const inner = Math.round(size * (1 - 2 * pad));
  await sharp({ create: { width: size, height: size, channels: 4, background: '#0C1118' } })
    .composite([{ input: await raster(micro, inner), gravity: 'center' }]).png().toFile(file);
};
await tile(180, path.join(PUB, 'apple-touch-icon.png'), 0.06);
await tile(192, path.join(PUB, 'icon-192.png'), 0.04);
await tile(512, path.join(PUB, 'icon-512.png'), 0.04);
await tile(512, path.join(PUB, 'icon-512-maskable.png'), 0.16);
// The OG template's corner mark: square, transparent, contained.
fs.writeFileSync(path.join(OUT, 'mark-512.png'), await raster(mark, 512));

const og = path.join(dir, `${id}-og-1200x630.png`);
if (fs.existsSync(og)) copy(og, path.join(OUT, 'og-default.png'));

const downloads: { label: string; file: string; format: string; size: string }[] = [];
const dl: [string, string][] = isText
  ? [['Wordmark, for dark backgrounds', 'text-lockup.svg'], ['Wordmark, for light backgrounds', 'text-lockup-on-light.svg'], ['Favicon tile', 'text-micro.svg']]
  : [
      ['Horizontal lockup, for dark backgrounds', `${id}-lockup.svg`],
      ['Horizontal lockup, for light backgrounds', `${id}-lockup-on-light.svg`],
      ['Horizontal lockup, white', `${id}-lockup-mono-white.svg`],
      ['Horizontal lockup, black', `${id}-lockup-mono-black.svg`],
      ['Stacked lockup, for dark backgrounds', `${id}-lockup-stacked.svg`],
      ['Mark, for dark backgrounds', `${id}-mark.svg`],
      ['Mark, for light backgrounds', `${id}-mark-on-light.svg`],
      ['Mark, white', `${id}-mark-mono-white.svg`],
      ['Mark, black', `${id}-mark-mono-black.svg`],
      ['Favicon tile (16 px grid)', `${id}-micro.svg`],
      ['Watermark (one colour, use at 15–30 %)', `${id}-watermark.svg`],
      ['Horizontal lockup, 2048 px', `${id}-lockup-2048.png`],
      ['Mark, 1024 px', `${id}-mark-1024.png`],
      ['GitHub avatar, 500 px', `${id}-github-avatar-500.png`],
      ['Steam description header, 1270 × 360', `${id}-steam-hero-1270x360.jpg`],
    ];
for (const [label, rel] of dl) {
  const src = path.join(dir, rel);
  if (!fs.existsSync(src)) continue;
  const name = `riokulabs-${rel.replace(/^[a-z0-9]+-/, '')}`;
  copy(src, path.join(OUT, 'downloads', name));
  downloads.push({ label, file: `/brand/downloads/${name}`, format: path.extname(rel).slice(1).toUpperCase(), size: `${kb(src)} KB` });
}

// The logo is decided (R4, 2026-10-20): only the chosen family ships. Remove any concept gallery an older run left.
fs.rmSync(path.join(OUT, 'concepts'), { recursive: true, force: true });

const info = {
  family: LOGO_FAMILY, lockup: { src: '/brand/logo-lockup.svg', ...dims(lockup) }, mark: { src: '/brand/logo-mark.svg', ...dims(mark) },
  micro: '/brand/logo-micro.svg', ogDefault: fs.existsSync(path.join(OUT, 'og-default.png')) ? '/brand/og-default.png' : null,
  ico: true, downloads,
};
fs.writeFileSync(path.resolve('src', 'data', 'brand.json'), JSON.stringify(info, null, 1) + '\n');
console.log(`brand: ${LOGO_FAMILY} installed (${downloads.length} downloads)`);
