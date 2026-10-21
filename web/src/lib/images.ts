/** Astro-side image helpers (getImage for posters, OG crops). */
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import type { Img } from './types';

const files = import.meta.glob<{ default: ImageMetadata }>('/src/assets/cms/**/*.{jpg,jpeg,png,webp}', { eager: true });

export function meta(img: Img): ImageMetadata {
  const m = files[`/src/assets/cms/${img.src}`]?.default;
  if (!m) throw new Error(`media not synced: ${img.src}`);
  return m;
}

/** A single optimised URL (posters, thumbnails in scripts). */
export async function imageUrl(img: Img, width = 1280, format: 'webp' | 'avif' | 'jpg' = 'webp'): Promise<string> {
  if (__SITE_PREVIEW__ && img.remote) return img.remote;   // preview Worker: the CMS original
  const m = meta(img);
  const r = await getImage({ src: m, width: Math.min(width, m.width), format, quality: 70 });
  return r.src;
}
