/**
 * Small pure helpers for the RSS routes (pages/rss.xml.ts, pages/mods/releases.xml.ts). Kept free of Astro imports so
 * they are unit-tested directly.
 */
import identity from '../config/identity.json';
import type { Img, Site } from './types';

/** Used when the CMS gives no description at all, so an empty field can never fail the feed check (and the deploy). */
export const DEFAULT_SITE_DESCRIPTION = `Game mods by ${identity.name}: the mods, a dev log and the roadmap.`;

/** Channel description: the site description, then the default SEO description, then a constant. Never empty. */
export function feedDescription(settings: Pick<Site['settings'], 'description' | 'defaultSeo'> | undefined): string {
  for (const d of [settings?.description, settings?.defaultSeo?.metaDescription]) {
    const t = typeof d === 'string' ? d.trim() : '';
    if (t) return t;
  }
  return DEFAULT_SITE_DESCRIPTION;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
};

/** MIME type of an image for an RSS enclosure: the CMS file's own type, else guessed from the file extension. */
export function imageMime(img: Pick<Img, 'src' | 'mime'>): string {
  if (img.mime && /^image\/[a-z0-9.+-]+$/i.test(img.mime)) return img.mime.toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(img.src.split('?')[0])?.[1]?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}
