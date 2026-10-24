/**
 * Site wording that editors own (CMS copy fields) with the built-in fallbacks from config/default-copy.json.
 * A CMS value wins when it is a non-empty string; an empty field, or a field the CMS does not have yet (an older
 * Strapi deploy), falls back to the built-in text. {studio} is filled in here. Pure: lib/load.ts calls normaliseCopy,
 * pages read site().copy.
 */
import defaults from '../config/default-copy.json';
import identity from '../config/identity.json';

export type Listing = {
  title: string;
  intro: string;
  metaTitle: string;
  metaDescription: string;
  cardText: string;
  emptyText: string;
  helpTitle: string;
  helpText: string;
};
export type SpoilerNotice = { title: string; body: string; cardText: string; summary: string };

export interface SiteCopy {
  footerPitch: string;
  helpTitle: string;
  helpText: string;
  homeTitleTemplate: string;
  modTitleTemplate: string;
  gameTitleTemplate: string;
  blogTitleTemplate: string;
  blogIndex: Listing;
  modsIndex: Listing;
  gamesIndex: Listing;
  roadmapIndex: Listing;
  notFound: Listing;
  spoilerNotice: SpoilerNotice;
  home: typeof defaults.homePage;
  about: typeof defaults.aboutPage;
  brand: typeof defaults.brandPage;
  legal: typeof defaults.legalPage;
}

export const DEFAULT_COPY = defaults;

/** The CMS value when set, else the fallback; {studio} filled in either way (the other placeholders are per page). */
const text = (v: unknown, fallback: string): string => fill(typeof v === 'string' && v.trim() ? v.trim() : fallback, { studio: identity.name });

/** Every key of `base` taken from `raw` when set there, else from `base`. Unknown keys in `raw` are ignored. */
function pick<T extends Record<string, string>>(raw: unknown, base: T): T {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, text(r[k], v)])) as T;
}

/**
 * Listing page wording. The optional fields (SEO title, card line, help box) fall back to an empty string, which the
 * pages read as "use the derived value"; the rest fall back to the built-in text.
 */
const listing = (raw: unknown, base: Listing): Listing => pick(raw, base);

/** The raw single types (Strapi REST or fixtures shape) → the copy the pages render. Never throws on missing input. */
export function normaliseCopy(raw: { siteSettings?: any; homePage?: any; aboutPage?: any; brandPage?: any; legalPage?: any }): SiteCopy {
  const s = raw.siteSettings ?? {};
  const d = defaults.siteSettings;
  return {
    footerPitch: text(s.footerPitch, d.footerPitch),
    helpTitle: text(s.helpTitle, d.helpTitle),
    helpText: text(s.helpText, d.helpText),
    homeTitleTemplate: text(s.homeTitleTemplate, d.homeTitleTemplate),
    modTitleTemplate: text(s.modTitleTemplate, d.modTitleTemplate),
    gameTitleTemplate: text(s.gameTitleTemplate, d.gameTitleTemplate),
    blogTitleTemplate: text(s.blogTitleTemplate, d.blogTitleTemplate),
    blogIndex: listing(s.blogIndex, d.blogIndex),
    modsIndex: listing(s.modsIndex, d.modsIndex),
    gamesIndex: listing(s.gamesIndex, d.gamesIndex),
    roadmapIndex: listing(s.roadmapIndex, d.roadmapIndex),
    notFound: listing(s.notFound, d.notFound),
    spoilerNotice: pick(s.spoilerNotice, d.spoilerNotice),
    home: pick(raw.homePage, defaults.homePage),
    about: pick(raw.aboutPage, defaults.aboutPage),
    brand: pick(raw.brandPage, defaults.brandPage),
    legal: pick(raw.legalPage, defaults.legalPage),
  };
}

/** Fills {name} placeholders. Unknown placeholders are left as they are, so a typo shows up on the page. */
export function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? vars[k]! : m));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Plain CMS text → HTML with `[label](url)` links. Everything is escaped first, so the only markup is the links;
 * a link needs a site path (/...) or an http(s) URL, anything else stays as plain text.
 */
export function inlineHtml(s: string): string {
  return esc(s).replace(/\[([^\]\n]+)\]\(((?:\/(?!\/)|https?:\/\/)[^\s()]*)\)/g, (_m, label: string, url: string) =>
    /^https?:/.test(url) ? `<a href="${url}" rel="noopener">${label}</a>` : `<a href="${url}">${label}</a>`);
}

/** `[label](url)` → `label`, for places that take plain text (meta descriptions, JSON-LD). */
export const plainText = (s: string) => s.replace(/\[([^\]\n]+)\]\([^\s()]*\)/g, '$1');
