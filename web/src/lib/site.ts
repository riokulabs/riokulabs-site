/**
 * Page-side access to the content produced by scripts/fetch-content.ts (.cache/site.json). Only public and unlisted
 * entries exist here; "listed" helpers additionally drop unlisted ones (listings, feeds, sitemap).
 */
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Family, Game, Mod, ModStatus, Post, Site } from './types';
import { STUDIO_DOMAIN } from '../config/brand';

/**
 * Preview Worker only (SITE_MODE=preview, src/middleware.ts): the draft content for THIS request. The static build
 * never sets it, so static pages always read the asserted, public-only .cache/site.json.
 */
export const previewStore = new AsyncLocalStorage<Site>();

let cache: Site | null = null;
export function site(): Site {
  const draft = previewStore.getStore();
  if (draft) return draft;
  if (cache) return cache;
  const file = path.resolve(process.cwd(), '.cache', 'site.json');
  if (!fs.existsSync(file)) throw new Error('No .cache/site.json: run `npm run fetch-content` (predev/prebuild do it for you).');
  cache = JSON.parse(fs.readFileSync(file, 'utf8')) as Site;
  return cache;
}

export const SITE_URL = (import.meta.env.SITE ?? `https://${STUDIO_DOMAIN}`).replace(/\/$/, '');
export const absolute = (p: string) => SITE_URL + (p === '/' ? '' : p);

export const STATUS: Record<ModStatus, { label: string; anchor: string; param: string }> = {
  published: { label: 'Published', anchor: 'published', param: 'published' },
  wip: { label: 'In progress', anchor: 'wip', param: 'wip' },
  idea: { label: 'Idea', anchor: 'ideas', param: 'idea' },
};
export const STATUS_ORDER: ModStatus[] = ['published', 'wip', 'idea'];

const modSort = (a: Mod, b: Mod) =>
  Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt);

export const listedGames = () => site().games.filter((g) => g.visibility === 'public');
export const getGame = (slug?: string): Game | undefined => site().games.find((g) => g.slug === slug);
export const gameOf = (m: Pick<Mod, 'game'>) => getGame(m.game);
/** Canonical mod URL: mods live under their game. The old /mods/<slug> URLs 301 here (pages/[file].ts _redirects). */
export const modUrl = (m: Pick<Mod, 'game' | 'slug'>) => (m.game ? `/games/${m.game}/mods/${m.slug}` : `/mods/${m.slug}`);
export const modHistoryUrl = (m: Pick<Mod, 'game' | 'slug'>) => `${modUrl(m)}/history`;
export const gameUrl = (slug: string) => `/games/${slug}`;
/** Legacy (pre-2026-10-20) flat mod URLs → their game URLs, for every built mod. */
export const legacyModRedirects = () =>
  site().mods.filter((m) => m.game).flatMap((m) => [
    { from: `/mods/${m.slug}`, to: modUrl(m), permanent: true },
    ...(m.families.length ? [{ from: `/mods/${m.slug}/history`, to: modHistoryUrl(m), permanent: true }] : []),
  ]).concat([{ from: '/history', to: '/roadmap', permanent: true }]); // the History tab became the Roadmap (2026-10-20)

export const listedMods = () => site().mods.filter((m) => m.visibility === 'public').sort(modSort);
export const modsByStatus = (s: ModStatus) => listedMods().filter((m) => m.status === s);
export const modsForGame = (game: string) => listedMods().filter((m) => m.game === game);
export const postsForGame = (game: string, n = 3): Post[] => listedPosts().filter((p) => p.games.includes(game)).slice(0, n);
export const getMod = (slug?: string) => site().mods.find((m) => m.slug === slug);
export const listedPosts = () => site().posts.filter((p) => p.visibility === 'public');
export const getPost = (slug?: string) => site().posts.find((p) => p.slug === slug);
export const getFamily = (id?: string): Family | undefined => site().families.find((f) => f.familyId === id);
export const listedFamilies = () => site().families.filter((f) => f.visibility === 'public');
export const tagName = (slug: string) => site().tags.find((t) => t.slug === slug)?.name ?? slug;
export const categoryName = (slug?: string) => site().categories.find((c) => c.slug === slug)?.name;
export const author = (slug?: string) => site().authors.find((a) => a.slug === slug);
export const block = (slug: string) => site().blocks.find((b) => b.slug === slug);

/** Related posts for a mod: the newest public posts that list it. */
export const postsForMod = (slug: string, n = 3): Post[] => listedPosts().filter((p) => p.relatedMods.includes(slug)).slice(0, n);



const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDate = (iso: string) => DATE_FMT.format(new Date(iso));
const DATETIME_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false });
export const fmtDateTime = (iso: string) => DATETIME_FMT.format(new Date(iso));

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const versionAnchor = (v: string) => 'v' + v.replace(/[^0-9A-Za-z]+/g, '-');

/** "Tested: 2.4.0.95 · Built for: 4.0.0.3151" (either part optional). */
export function versionLine(m: { gameVersionTested?: string; gameVersionBuilt?: string }): string | undefined {
  const parts = [m.gameVersionTested && `Tested: ${m.gameVersionTested}`, m.gameVersionBuilt && m.gameVersionBuilt !== m.gameVersionTested && `Built for: ${m.gameVersionBuilt}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}
const short = (v: string) => v.split('.').slice(0, 2).join('.');
/** Card chip: "SE2 4.0 · tested 2.4" (the prefix is the mod's game short name). */
export function versionChip(m: { game?: string; gameVersionTested?: string; gameVersionBuilt?: string }): string | undefined {
  const g = (m.game && getGame(m.game)?.shortName) || 'Game';
  if (m.gameVersionBuilt && m.gameVersionTested && short(m.gameVersionBuilt) !== short(m.gameVersionTested)) return `${g} ${short(m.gameVersionBuilt)} · tested ${short(m.gameVersionTested)}`;
  const v = m.gameVersionBuilt ?? m.gameVersionTested;
  return v ? `${g} ${short(v)}` : undefined;
}
