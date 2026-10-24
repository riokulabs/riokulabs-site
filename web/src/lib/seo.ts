import defaults from '../config/default-copy.json';
import { fill } from './copy';
import type { Img, Link } from './types';

/** Props of components/Seo.astro (shared with layouts/Base.astro). */
export interface SeoProps {
  title?: string;
  description?: string;
  path: string;
  ogPath?: string;
  ogAlt?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  /** false: no canonical link or og:url (the 404 page, which has no address of its own). Default true. */
  canonical?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  publishedTime?: string;
  modifiedTime?: string;
}

/**
 * Meta description of at most `max` characters. Longer text is cut at the last word boundary that leaves room for an
 * ellipsis, with trailing punctuation dropped, so search results never show half a word.
 */
export function metaDescription(text: string, max = 160): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1); // one character is kept for the ellipsis
  const space = room.lastIndexOf(' ');
  const cut = s[max - 1] === ' ' ? room : space > 0 ? room.slice(0, space) : room;
  const out = (cut || room).replace(/[\s,;:.\-–—]+$/, '');
  return `${out || room}…`;
}

/** Longest full title (page title + " · " + studio name) the keyword titles aim for, so results don't truncate them. */
export const TITLE_MAX = 65;

/** "a" or "an" before a game name ("an Elite mod", "a Space Engineers 2 mod"). */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** Built-in title templates (also in config/default-copy.json, which the CMS fields fall back to). */
export const TITLE_TEMPLATES = {
  home: defaults.siteSettings.homeTitleTemplate,
  mod: defaults.siteSettings.modTitleTemplate,
  game: defaults.siteSettings.gameTitleTemplate,
  blog: defaults.siteSettings.blogTitleTemplate,
};

/** True when the full title (page title + " · " + studio name) stays within TITLE_MAX. */
const fitsWith = (studio: string) => (t: string) => `${t} · ${studio}`.length <= TITLE_MAX;

/**
 * Page title of a mod page from a template ("{mod}: {a} {game} mod" → "Data Center: a Space Engineers 2 mod").
 * When the full title would pass TITLE_MAX it drops "{a} " ("Data Center: Space Engineers 2 mod") and then falls back to
 * the bare mod name. Without a game the result is the mod name.
 */
export function modTitle(mod: string, game: string | undefined, studio: string, template = TITLE_TEMPLATES.mod): string {
  if (!game) return mod;
  const vars = { mod, game, studio, a: article(game) };
  const forms = [template, template.replace(/\{a\}\s*/g, '')].map((t) => fill(t, vars).replace(/\s+/g, ' ').trim());
  return forms.find(fitsWith(studio)) ?? mod;
}

/** Page title of the dev-log index from a template ("Dev log: {game} modding"); `heading` without a game or when too long. */
export function blogTitle(game: string | undefined, studio: string, template = TITLE_TEMPLATES.blog, heading = 'Dev log'): string {
  if (!game && /\{game\}/.test(template)) return heading;
  const t = fill(template, { game, studio });
  return fitsWith(studio)(t) ? t : heading;
}

/** Page title of a game page ("{game} mods"). */
export const gameTitle = (game: string, studio: string, template = TITLE_TEMPLATES.game) => fill(template, { game, studio });

/** Home page title when the CMS sets none: "<Studio> · <Game> mods" (just the studio name without a game). */
export const homeTitle = (studio: string, game?: string, template = TITLE_TEMPLATES.home) =>
  game || !/\{game\}/.test(template) ? fill(template, { studio, game }) : studio;

/** Link kinds that can be the studio's own profile pages (Organization sameAs). */
export const PROFILE_KINDS = ['external', 'github', 'youtube', 'discord', 'steam', 'modio'];

/**
 * Organization sameAs from the CMS social links: absolute http(s) URLs of the profile kinds, in CMS order, without
 * duplicates. Internal paths and feeds (kind internal or rss) are never profiles.
 */
export function sameAsLinks(links: Pick<Link, 'url' | 'kind'>[]): string[] {
  const out: string[] = [];
  for (const l of links ?? []) {
    const url = typeof l.url === 'string' ? l.url.trim() : '';
    if (!PROFILE_KINDS.includes(l.kind) || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** Raster formats search engines take as an Organization logo (an SVG is not used). */
const RASTER = /^image\/(png|jpeg|webp|gif)$/i;
/** The CMS logo to use as the Organization logo: the square mark first, then the full logo; raster files only. */
export const cmsLogo = (settings: { logoMark?: Img; logo?: Img }): Img | undefined =>
  [settings.logoMark, settings.logo].find((i): i is Img => !!i && RASTER.test(i.mime ?? '') && !!i.src);

/** CollectionPage JSON-LD with an ItemList of the page's entries, in display order. URLs are absolute. */
export function collectionJsonLd(page: { name: string; description?: string; url: string }, items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: page.name, url: page.url,
    ...(page.description ? { description: page.description } : {}),
    mainEntity: {
      '@type': 'ItemList', numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: it.url })),
    },
  };
}
