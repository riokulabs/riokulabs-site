/**
 * Build-time social cards (SPEC §10): 1200×630 PNG, dark hull-plate template, title in Barlow Condensed, eyebrow,
 * status lamp for mods, the studio mark, and the entry's image on the right half cropped at its focal point.
 * satori (SVG) → resvg (raster) → sharp (palette PNG, < 300 KB). Fonts come from the self-hosted Fontsource files.
 */
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import type { Img } from '../lib/types';
import { STUDIO_DOMAIN, STUDIO_NAME } from '../config/brand';

const FONT_DIR = path.resolve(process.cwd(), 'node_modules', '@fontsource');
const fonts = [
  { name: 'Barlow Condensed', data: fs.readFileSync(path.join(FONT_DIR, 'barlow-condensed/files/barlow-condensed-latin-700-normal.woff')), weight: 700 as const, style: 'normal' as const },
  { name: 'Barlow', data: fs.readFileSync(path.join(FONT_DIR, 'barlow/files/barlow-latin-400-normal.woff')), weight: 400 as const, style: 'normal' as const },
  { name: 'Barlow', data: fs.readFileSync(path.join(FONT_DIR, 'barlow/files/barlow-latin-600-normal.woff')), weight: 600 as const, style: 'normal' as const },
];

const MARK = (() => {
  const f = path.resolve(process.cwd(), 'public', 'brand', 'mark-512.png');
  return fs.existsSync(f) ? `data:image/png;base64,${fs.readFileSync(f).toString('base64')}` : null;
})();

const LAMP: Record<string, string> = { published: '#3DDC84', wip: '#FFB347', idea: '#9C8CFF' };
const h = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });

async function crop(img: Img, w: number, hgt: number): Promise<string> {
  const file = path.resolve(process.cwd(), 'src', 'assets', 'cms', img.src);
  const meta = await sharp(file).metadata();
  const scale = Math.max(w / meta.width!, hgt / meta.height!);
  const sw = Math.round(meta.width! * scale);
  const sh = Math.round(meta.height! * scale);
  const left = Math.min(Math.max(0, Math.round(sw * img.focalX - w / 2)), sw - w);
  const top = Math.min(Math.max(0, Math.round(sh * img.focalY - hgt / 2)), sh - hgt);
  const buf = await sharp(file).resize(sw, sh).extract({ left, top, width: w, height: hgt }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

export interface CardInput { title: string; eyebrow: string; subtitle?: string; status?: string; statusLabel?: string; image?: Img }

export async function renderCard(c: CardInput): Promise<Buffer> {
  const imgW = c.image ? 520 : 0;
  const imgSrc = c.image ? await crop(c.image, imgW, 630) : undefined;
  const titleSize = c.title.length > 48 ? 64 : c.title.length > 28 ? 80 : 104;
  const tree = h('div', { width: 1200, height: 630, display: 'flex', background: '#05070B', color: '#E6EBF1', fontFamily: 'Barlow', position: 'relative' }, [
    // plume glow
    h('div', { position: 'absolute', left: -200, top: 180, width: 1200, height: 280, display: 'flex', background: 'radial-gradient(closest-side, rgba(79,184,255,0.35), rgba(79,184,255,0) 100%)' }),
    h('div', { position: 'absolute', left: 0, top: 312, width: 1200 - imgW, height: 4, display: 'flex', background: 'linear-gradient(90deg, rgba(255,179,71,0), rgba(79,184,255,0.7) 60%, rgba(221,241,255,0.95))' }),
    h('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 1200 - imgW, padding: '64px 64px 56px', position: 'relative' }, [
      h('div', { display: 'flex', alignItems: 'center', gap: 16 }, [
        MARK
          ? { type: 'img', props: { src: MARK, width: 64, height: 64, style: { width: 64, height: 64 } } }
          : h('div', { display: 'flex', padding: '8px 12px 6px', background: '#4FB8FF', color: '#03101C', fontFamily: 'Barlow Condensed', fontSize: 28, letterSpacing: 2 }, STUDIO_NAME.toUpperCase()),
        h('div', { display: 'flex', fontFamily: 'Barlow Condensed', fontSize: 26, letterSpacing: 5, color: '#93A1B3' }, c.eyebrow.toUpperCase()),
      ]),
      h('div', { display: 'flex', flexDirection: 'column', gap: 20 }, [
        h('div', { display: 'flex', fontFamily: 'Barlow Condensed', fontSize: titleSize, lineHeight: 0.95, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 1 }, c.title),
        c.subtitle ? h('div', { display: 'flex', fontSize: 28, lineHeight: 1.3, color: '#93A1B3', maxWidth: 600 }, c.subtitle.length > 110 ? c.subtitle.slice(0, 107) + '…' : c.subtitle) : null,
      ].filter(Boolean)),
      h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
        c.status
          ? h('div', { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', border: '1px solid #33465E', fontFamily: 'Barlow Condensed', fontSize: 24, letterSpacing: 3 }, [
              h('div', { display: 'flex', width: 14, height: 14, borderRadius: 7, background: LAMP[c.status] ?? '#93A1B3', boxShadow: `0 0 12px ${LAMP[c.status] ?? '#93A1B3'}` }),
              (c.statusLabel ?? c.status).toUpperCase(),
            ])
          : h('div', { display: 'flex' }),
        h('div', { display: 'flex', fontFamily: 'Barlow Condensed', fontSize: 24, letterSpacing: 4, color: '#4FB8FF' }, STUDIO_DOMAIN.toUpperCase()),
      ]),
    ]),
    imgSrc
      ? h('div', { display: 'flex', width: imgW, height: 630, position: 'relative', borderLeft: '1px solid #33465E' }, [
          { type: 'img', props: { src: imgSrc, width: imgW, height: 630, style: { width: imgW, height: 630, objectFit: 'cover' } } },
          h('div', { position: 'absolute', left: 0, top: 0, width: 120, height: 630, display: 'flex', background: 'linear-gradient(90deg, #05070B, rgba(5,7,11,0))' }),
        ])
      : null,
  ].filter(Boolean));
  const svg = await satori(tree as any, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return sharp(png).png({ palette: true, quality: 90, compressionLevel: 9, effort: 8 }).toBuffer();
}
