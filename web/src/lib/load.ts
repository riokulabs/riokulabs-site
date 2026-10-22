/**
 * Raw content (Strapi REST or fixtures) → visibility filter → build assertion → normalised Site model.
 * Node-only (used by scripts/fetch-content.ts before Astro builds; pages read the cached result via lib/site.ts).
 *
 * Order matters:
 * 1. filter: drop every entry whose visibility isn't public/unlisted or that isn't published, and every relation
 *    (anywhere, including dynamic-zone sections) that points at such an entry;
 * 2. assert: every remaining entry and nested relation must be visible, and NO string anywhere in the filtered
 *    content may match a privacy deny pattern or an IP deny term. Any hit throws (the build fails) naming the
 *    documentId and path;
 * 3. normalise into lib/types.ts shapes, collecting the media that the pages may use (only from visible content).
 */
import { isVisible, lintText, PrivacyAssertionError, type PrivacyLists } from './privacy';
import { assertSafeMediaKey, assertSafeRedirect, UnsafeContentError } from './safety';
import type * as T from './types';
import { PHASES } from './types';
import { youtubeId } from './youtube';
import identity from '../config/identity.json';

/** 64-bit FNV-1a as 16 hex chars (pure JS, so it also runs in the preview worker). */
export function mediaHash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
    h2 = (h2 ^ (h1 >>> 7)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export interface MediaSource { key: string; from: { kind: 'seed'; rel: string } | { kind: 'url'; url: string }; mime: string }

const COLLECTION_KEYS = ['categories', 'tags', 'authors', 'games', 'mods', 'modReleases', 'timelineFamilies', 'milestones', 'blocks', 'blogPosts', 'redirects'];
const SINGLE_KEYS = ['siteSettings', 'navigation', 'homePage', 'aboutPage', 'brandPage', 'legalPage'];

/** A populated object that represents a related entry (it carries documentId + visibility). */
const isEntryRef = (v: any) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.documentId === 'string' && 'visibility' in v;

/** Step 1: visibility filter (pure; returns a deep copy). */
export function filterVisible(raw: Record<string, any>): Record<string, any> {
  const copy = structuredClone(raw);
  const visibleIds = new Set<string>();
  for (const k of COLLECTION_KEYS) {
    copy[k] = (copy[k] ?? []).filter((e: any) => isVisible(e.visibility) && e.publishedAt !== null);
    for (const e of copy[k]) visibleIds.add(e.documentId);
  }
  // Every mod page lives under its game (/games/<game>/mods/<mod>): a mod whose game is missing or hidden is dropped,
  // exactly as if it were private (fail safe: hiding a game hides its mods and ideas).
  const gameless = (m: any) => !(isEntryRef(m.game) && isVisible(m.game.visibility) && visibleIds.has(m.game.documentId));
  for (const m of copy.mods.filter(gameless)) visibleIds.delete(m.documentId);
  copy.mods = copy.mods.filter((m: any) => !gameless(m));
  // Roadmap items tied to a hidden mod are dropped (their text is about that mod); studio-wide items have no mod.
  const hiddenRef = (r: any) => isEntryRef(r) && !(isVisible(r.visibility) && visibleIds.has(r.documentId));
  copy.milestones = copy.milestones.filter((m: any) => !hiddenRef(m.mod));
  // Releases also need a visible parent mod; families/blocks keep a null mod if theirs is hidden.
  const strip = (node: any): any => {
    if (Array.isArray(node)) return node.filter((x) => !(isEntryRef(x) && !(isVisible(x.visibility) && visibleIds.has(x.documentId)))).map(strip);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (isEntryRef(v) && !(isVisible((v as any).visibility) && visibleIds.has((v as any).documentId))) node[k] = null;
        else node[k] = strip(v);
      }
    }
    return node;
  };
  for (const k of COLLECTION_KEYS) copy[k] = copy[k].map((e: any) => strip(e));
  for (const k of SINGLE_KEYS) copy[k] = copy[k] ? strip(copy[k]) : copy[k];
  copy.modReleases = copy.modReleases.filter((r: any) => r.mod);
  // Sections whose target was stripped are removed.
  const dropDeadSections = (body: any[] | undefined) =>
    (body ?? []).filter((s) => !((s.__component === 'sections.mod-card' && !s.mod) || (s.__component === 'sections.timeline-embed' && !s.family) || (s.__component === 'sections.model-embed' && !s.model)));
  for (const k of ['mods', 'blogPosts']) for (const e of copy[k]) e.body = dropDeadSections(e.body);
  for (const k of ['aboutPage', 'brandPage', 'legalPage']) if (copy[k]) copy[k].body = dropDeadSections(copy[k].body);
  return copy;
}

/** Step 2: the build assertion. Throws PrivacyAssertionError on any problem. */
export function assertPublicOnly(filtered: Record<string, any>, lists: PrivacyLists): void {
  const problems: string[] = [];
  const walk = (node: any, where: string) => {
    if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (node && typeof node === 'object') {
      if (isEntryRef(node) && !isVisible(node.visibility)) problems.push(`non-public entry ${node.documentId} at ${where} (visibility ${node.visibility})`);
      for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
    }
  };
  for (const k of COLLECTION_KEYS) {
    for (const e of filtered[k] ?? []) {
      if (!isVisible(e.visibility)) problems.push(`${k} ${e.documentId}: visibility ${e.visibility}`);
      walk(e, `${k}#${e.documentId}`);
      problems.push(...lintText(e, lists, `${k}#${e.documentId}`));
    }
  }
  for (const k of SINGLE_KEYS) {
    if (!filtered[k]) continue;
    walk(filtered[k], k);
    problems.push(...lintText(filtered[k], lists, `${k}`));
  }
  if (problems.length) throw new PrivacyAssertionError(problems);
}

// ---------------------------------------------------------------------------------------------------------------
// Step 3: normalise
// ---------------------------------------------------------------------------------------------------------------
export interface NormaliseOptions {
  /** Preview Worker: keep media on the CMS (absolute URLs) instead of syncing it into the build. */
  remoteBase?: string;
}

export function normalise(f: Record<string, any>, source: T.Site['source'], opts: NormaliseOptions = {}): { site: T.Site; media: MediaSource[] } {
  const remoteOf = (file: any): string | undefined =>
    opts.remoteBase && file?.url && !String(file.url).startsWith('seed:')
      ? (/^https?:\/\//.test(file.url) ? file.url : opts.remoteBase.replace(/\/$/, '') + file.url)
      : undefined;
  const media = new Map<string, MediaSource>();
  const fileKey = (file: any): string | undefined => {
    if (!file?.url) return undefined;
    let key: string;
    let from: MediaSource['from'];
    if (String(file.url).startsWith('seed:')) {
      // seed: URLs exist only in the committed fixtures; from a CMS they would be a path-traversal vector.
      if (source !== 'fixtures') throw new UnsafeContentError(`seed: media URL outside fixtures mode: ${JSON.stringify(file.url)}`);
      const rel = assertSafeMediaKey(String(file.url).slice(5));
      key = rel;
      from = { kind: 'seed', rel };
    } else {
      // Name the local copy by a hash of its URL, not the uploaded file name: CMS file names can carry internal
      // working names, and the key ends up in public image URLs. Same URL -> same key, so build caches still hit.
      const base = String(file.url).split('?')[0].split('#')[0].split('/').pop()!;
      const ext = (/\.[a-z0-9]{1,5}$/i.exec(base)?.[0] ?? '').toLowerCase();
      key = assertSafeMediaKey(`strapi/${mediaHash(String(file.url))}${ext}`);
      from = { kind: 'url', url: file.url };
    }
    media.set(key, { key, from, mime: file.mime ?? '' });
    return key;
  };
  const img = (i: any): T.Img | undefined => {
    if (!i?.file) return undefined;
    const src = fileKey(i.file);
    if (!src) return undefined;
    return {
      src, remote: remoteOf(i.file), alt: i.alt ?? '', caption: i.caption ?? undefined, focalX: Number(i.focalX ?? 0.5), focalY: Number(i.focalY ?? 0.5),
      width: i.file.width ?? 1920, height: i.file.height ?? 1080, mime: typeof i.file.mime === 'string' && i.file.mime ? i.file.mime : undefined,
    };
  };
  const posterImg = (file: any, alt: string): T.Img | undefined => img(file ? { file, alt } : null);
  const vid = (v: any): T.Video | undefined => {
    if (!v?.mp4 || !v?.poster) return undefined;
    const mp4 = fileKey(v.mp4);
    const poster = posterImg(v.poster, v.caption ?? '');
    if (!mp4 || !poster) return undefined;
    if (opts.remoteBase) return { mp4: remoteOf(v.mp4)!, webm: v.webm ? remoteOf(v.webm) : undefined, poster, caption: v.caption ?? undefined };
    return { mp4: `/media/${mp4}`, webm: v.webm ? `/media/${fileKey(v.webm)}` : undefined, poster, caption: v.caption ?? undefined };
  };
  const visual = (v: any): T.Visual | undefined => {
    if (!v) return undefined;
    if (v.kind === 'video') {
      const video = vid(v.video);
      return video ? { kind: 'video', video } : undefined;
    }
    const image = img(v.image);
    return image ? { kind: 'image', image } : undefined;
  };
  const galleryItem = (g: any): T.GalleryItem | undefined => {
    const item: T.GalleryItem = { kind: g.kind === 'loop' ? 'loop' : 'image', image: img(g.image), video: vid(g.video), title: g.title ?? undefined, caption: g.caption ?? undefined };
    return item.image || item.video ? item : undefined;
  };
  const seo = (s: any): T.Seo | undefined =>
    s ? { metaTitle: s.metaTitle ?? undefined, metaDescription: s.metaDescription ?? undefined, ogImage: img(s.ogImage), noindex: !!s.noindex, canonicalOverride: s.canonicalOverride ?? undefined } : undefined;
  const link = (l: any): T.Link => ({ label: l.label, url: l.url, kind: l.kind ?? 'internal', newTab: !!l.newTab });
  const sections = (body: any[] | undefined): T.Section[] =>
    (body ?? [])
      .map((s): T.Section | undefined => {
        switch (s.__component) {
          case 'sections.rich-text': return { type: 'rich-text', content: s.content ?? [] };
          case 'sections.image': { const i = img(s.image); return i ? { type: 'image', image: i, size: s.size ?? 'wide' } : undefined; }
          case 'sections.gallery': {
            // A gallery whose media are all missing renders as an empty box: drop it like an image section with no image.
            const items = (s.items ?? []).filter(Boolean).map(galleryItem).filter(Boolean) as T.GalleryItem[];
            return items.length ? { type: 'gallery', items, layout: s.layout ?? 'grid' } : undefined;
          }
          case 'sections.loop-video': { const v = vid(s.video); return v ? { type: 'loop-video', video: v, size: s.size ?? 'wide' } : undefined; }
          case 'sections.youtube-embed': {
            // Dropped unless the URL gives a real video id and there is a title for the player.
            const id = youtubeId(s.url);
            const title = typeof s.title === 'string' ? s.title.trim() : '';
            return id && title ? { type: 'youtube-embed', id, title, caption: s.caption ?? undefined, size: s.size ?? 'wide' } : undefined;
          }
          case 'sections.compare': {
            const before = img(s.before);
            const after = img(s.after);
            return before && after ? { type: 'compare', before, after, beforeLabel: s.beforeLabel ?? 'Before', afterLabel: s.afterLabel ?? 'After', caption: s.caption ?? undefined } : undefined;
          }
          case 'sections.code': return { type: 'code', language: s.language ?? 'text', code: s.code ?? '', filename: s.filename ?? undefined, caption: s.caption ?? undefined };
          case 'sections.callout': return { type: 'callout', tone: s.tone ?? 'note', title: s.title ?? undefined, body: s.body ?? [] };
          case 'sections.quote': return { type: 'quote', text: s.text, attribution: s.attribution ?? undefined };
          case 'sections.model-embed': return s.model ? { type: 'model-embed', block: s.model.slug, caption: s.caption ?? undefined } : undefined;
          case 'sections.mod-card': return s.mod ? { type: 'mod-card', mod: s.mod.slug } : undefined;
          case 'sections.timeline-embed': return s.family ? { type: 'timeline-embed', family: s.family.familyId, fromStage: s.fromStage ?? undefined, toStage: s.toStage ?? undefined } : undefined;
          case 'sections.stat-grid': return { type: 'stat-grid', stats: (s.stats ?? []).map((x: any) => ({ value: x.value, label: x.label })) };
          default: return undefined;
        }
      })
      .filter((x): x is T.Section => !!x);

  const releases: T.Release[] = (f.modReleases ?? []).filter((r: any) => r.mod).map((r: any) => ({
    id: r.documentId, mod: r.mod.slug, version: r.version, releasedAt: r.releasedAt, channel: r.channel ?? undefined, gameVersion: r.gameVersion ?? undefined,
    highlights: (r.highlights ?? []).map((h: any) => h.text), notes: r.notes ?? undefined, changeNoteUrl: r.changeNoteUrl ?? undefined, visibility: r.visibility,
  }));
  const families: T.Family[] = (f.timelineFamilies ?? [])
    .map((x: any) => ({
      id: x.documentId, familyId: x.familyId, slug: x.slug, name: x.name, shortName: x.shortName ?? x.name, summary: x.summary ?? undefined,
      mod: x.mod?.slug, sortOrder: x.sortOrder ?? 100, visibility: x.visibility,
      stages: (x.stages ?? []).map((s: any) => ({ date: s.date, label: s.label, note: s.note ?? undefined, image: img(s.image), thumb: img(s.thumb) }))
        .sort((a: T.Stage, b: T.Stage) => a.date.localeCompare(b.date)),
    }))
    .sort((a: T.Family, b: T.Family) => a.sortOrder - b.sortOrder);

  const games: T.Game[] = (f.games ?? []).map((g: any) => ({
    id: g.documentId, slug: g.slug, name: g.name, shortName: g.shortName || g.name, tagline: g.tagline, summary: g.summary ?? undefined,
    art: img(g.art), links: (g.links ?? []).map(link), platformNotes: g.platformNotes ?? undefined, legalNotice: g.legalNotice ?? undefined,
    featured: !!g.featured, sortOrder: g.sortOrder ?? 100, visibility: g.visibility, seo: seo(g.seo),
  })).sort((a: T.Game, b: T.Game) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  // (the preview Worker skips filterVisible: a draft mod without a game gets '' and is reachable at /mods/<slug> there)
  const mods: T.Mod[] = (f.mods ?? []).map((m: any) => ({
    id: m.documentId, slug: m.slug, game: m.game?.slug ?? '', name: m.name, tagline: m.tagline, summary: m.summary ?? undefined, status: m.modStatus, stage: m.stage ?? undefined,
    blockedReason: m.blockedReason ?? undefined, feasibility: m.feasibility ?? undefined, visibility: m.visibility, featured: !!m.featured,
    sortOrder: m.sortOrder ?? 100, gameVersionTested: m.gameVersionTested ?? undefined, gameVersionBuilt: m.gameVersionBuilt ?? undefined, requiresScripts: m.requiresScripts ?? undefined,
    requirements: m.requirements ?? undefined, steamWorkshopUrl: m.steamWorkshopUrl ?? undefined, modioUrl: m.modioUrl ?? undefined,
    githubUrl: m.githubUrl ?? undefined, license: m.license ?? undefined, hero: visual(m.heroMedia), heroCaption: m.heroCaption ?? undefined,
    currentVersion: m.currentVersion ?? undefined, card: img(m.cardImage), stats: (m.stats ?? []).map((s: any) => ({ value: s.value, label: s.label, note: s.note ?? undefined })),
    specs: (m.specs ?? []).map((s: any) => ({ label: s.label, value: s.value })),
    features: (m.features ?? []).map((x: any) => ({ title: x.title, body: x.body ?? undefined, visual: visual(x.visual) })),
    gallery: (m.gallery ?? []).filter(Boolean).map(galleryItem).filter(Boolean), body: sections(m.body),
    tags: (m.tags ?? []).map((t: any) => t.slug), updatedAt: m.updatedAt, seo: seo(m.seo),
    releases: releases.filter((r) => r.mod === m.slug).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt)),
    families: families.filter((x) => x.mod === m.slug).map((x) => x.familyId),
  }));

  const posts: T.Post[] = (f.blogPosts ?? []).map((p: any) => {
    const body = sections(p.body);
    return {
      id: p.documentId, slug: p.slug, title: p.title, subtitle: p.subtitle ?? undefined, excerpt: p.excerpt, spoiler: p.spoiler === true, cover: img(p.cover), date: p.date,
      updatedAt: p.updatedAt, updatedNote: p.updatedNote ?? undefined, author: p.author?.slug, category: p.category?.slug,
      tags: (p.tags ?? []).map((t: any) => t.slug), relatedMods: (p.relatedMods ?? []).map((m: any) => m.slug),
      games: [...new Set([...(p.games ?? []).map((g: any) => g.slug), ...(p.relatedMods ?? []).map((r: any) => mods.find((m) => m.slug === r.slug)?.game)].filter(Boolean))] as string[],
      body, visibility: p.visibility,
      readingMinutes: readingMinutes(body), seo: seo(p.seo),
    };
  }).sort((a: T.Post, b: T.Post) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  const s = f.siteSettings ?? {};
  const n = f.navigation ?? {};
  const h = f.homePage ?? {};
  const site: T.Site = {
    generatedAt: new Date().toISOString(),
    source,
    settings: {
      // The display name is ONE value (src/config/identity.json); the CMS siteName field is informational only.
      siteName: identity.name, shortName: identity.name, description: s.description ?? '', defaultSeo: seo(s.defaultSeo),
      socialLinks: (s.socialLinks ?? []).map(link), notAffiliatedText: s.notAffiliatedText ?? '', analyticsEnabled: !!s.analyticsEnabled,
    },
    nav: { header: (n.header ?? []).map(link), footer: (n.footer ?? []).map((c: any) => ({ title: c.title, links: (c.links ?? []).map(link) })) },
    home: {
      heroTagline: h.heroTagline ?? '', heroSubline: h.heroSubline ?? undefined, heroMedia: visual(h.heroMedia), ctaPrimary: h.ctaPrimary ? link(h.ctaPrimary) : undefined,
      ctaSecondary: h.ctaSecondary ? link(h.ctaSecondary) : undefined, featuredMod: h.featuredMod?.slug, historyFamily: h.historyFamily?.familyId,
      principles: (h.principles ?? []).map((p: any) => ({ title: p.title, body: p.body ?? undefined })), seo: seo(h.seo),
    },
    about: { title: f.aboutPage?.title ?? 'About', intro: f.aboutPage?.intro ?? undefined, body: sections(f.aboutPage?.body), seo: seo(f.aboutPage?.seo) },
    brand: { body: sections(f.brandPage?.body), boilerplateShort: f.brandPage?.boilerplateShort ?? undefined, boilerplateLong: f.brandPage?.boilerplateLong ?? undefined, seo: seo(f.brandPage?.seo) },
    legal: { body: sections(f.legalPage?.body), seo: seo(f.legalPage?.seo) },
    games,
    mods,
    posts,
    families,
    milestones: (f.milestones ?? []).map((m: any) => ({
      id: m.documentId, phase: (PHASES as readonly string[]).includes(m.phase) ? m.phase : 'done', date: m.date ?? undefined, label: m.label,
      note: m.note ?? undefined, mod: m.mod?.slug, sortOrder: m.sortOrder ?? 100,
    })).sort((a: T.Milestone, b: T.Milestone) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || (a.date ?? '').localeCompare(b.date ?? '') || a.sortOrder - b.sortOrder),
    tags: (f.tags ?? []).map((t: any) => ({ slug: t.slug, name: t.name, description: t.description ?? undefined })),
    categories: (f.categories ?? []).map((c: any) => ({ slug: c.slug, name: c.name, description: c.description ?? undefined })),
    authors: (f.authors ?? []).map((a: any) => ({ slug: a.slug, name: a.name, bio: a.bio ?? undefined, avatar: img(a.avatar), links: (a.links ?? []).map(link) })),
    blocks: (f.blocks ?? []).map((b: any) => ({
      id: b.documentId, slug: b.slug, name: b.name, mod: b.mod?.slug, fileSizeBytes: b.fileSizeBytes ?? undefined,
      poster: img(b.poster)!, fallbackLoop: vid(b.fallbackLoop), description: b.description, dimensionsCells: b.dimensionsCells ?? undefined, provenance: b.provenance,
      triangles: b.triangles ?? undefined, cameraOrbit: b.cameraOrbit ?? undefined, defaultPaint: b.defaultPaint ?? undefined,
      animations: (b.animations ?? []).map((a: any) => ({ clip: String(a.clip), label: String(a.label), loop: !!a.loop })),
      paints: (b.paintPresets ?? []).filter((p: any) => /^#[0-9A-Fa-f]{6}$/.test(p.hex)).map((p: any) => ({ label: String(p.label), hex: p.hex })),
      // A GLB path must be a site-relative /models/*.glb file (never an arbitrary URL from the CMS).
      glbPath: typeof b.glbPath === 'string' && /^\/models\/[a-z0-9][a-z0-9.-]*\.glb$/.test(b.glbPath) ? b.glbPath : undefined,
    })).filter((b: T.Block3D) => !!b.poster),
    redirects: (f.redirects ?? []).map((r: any) => ({ ...assertSafeRedirect(r), permanent: r.permanent !== false })),
    media: { images: [], videos: [] },
  };
  const list = [...media.values()];
  site.media.images = list.filter((m) => !m.mime.startsWith('video/')).map((m) => m.key).sort();
  site.media.videos = list.filter((m) => m.mime.startsWith('video/')).map((m) => m.key).sort();
  return { site, media: list };
}

/** Single types the site cannot render without (REST names, for the error message). */
export const CORE_SINGLES: Record<string, string> = { siteSettings: 'site-settings', navigation: 'navigation', homePage: 'home-page' };

export class MissingContentError extends Error {}

/**
 * CMS builds only: fail when a core single type is missing or unpublished (Strapi answers 404, fetchStrapi maps that
 * to null). Without this the build would deploy an empty header, hero or settings without complaint.
 */
export function assertCoreContent(raw: Record<string, any>): void {
  const missing = Object.entries(CORE_SINGLES).filter(([k]) => !raw[k] || typeof raw[k] !== 'object' || Array.isArray(raw[k])).map(([, name]) => name);
  if (missing.length) {
    throw new MissingContentError(
      `required CMS content is missing or unpublished: ${missing.join(', ')}. Publish ${missing.length > 1 ? 'them' : 'it'} in Strapi and rebuild ` +
      '(the build stops so the site never deploys an empty header, hero or site settings).',
    );
  }
}

/** ≈ 230 words per minute over text-bearing sections (SPEC §4.4). */
export function readingMinutes(body: T.Section[]): number {
  let words = 0;
  const text = (n: any): string => (n?.type === 'text' ? n.text : (n?.children ?? []).map(text).join(' '));
  for (const s of body) {
    if (s.type === 'rich-text' || s.type === 'callout') words += (s.type === 'rich-text' ? s.content : s.body).map(text).join(' ').split(/\s+/).filter(Boolean).length;
    if (s.type === 'quote') words += s.text.split(/\s+/).length;
    if (s.type === 'code') words += Math.ceil(s.code.split(/\s+/).length / 2);
  }
  return Math.max(1, Math.round(words / 230));
}
