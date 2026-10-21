/**
 * Build web/fixtures/content.json from cms/seed/content.ts, in the exact shape the Strapi 5 REST API returns for the
 * site's queries (web/src/lib/strapi.ts), so CI and local work can build the site without a running CMS.
 *
 * The fixtures show the PROPOSED LAUNCH STATE for review, not what is live: confirm-items, the author and the four
 * drafted posts appear as public. Idea cards are synthetic stand-ins ("Idea fixture A" ...): the real ones are private
 * and never go in this public file. They also contain deliberately private and unlisted fixtures (canaries)
 * that must never reach dist/ (the privacy canary and the build assertion prove it). Fixture builds are noindex.
 *
 * Run: npm run build:fixtures   (after prepare-media)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import * as C from '../seed/content';
import { md } from '../seed/md';
import type { GalleryItem, Img, Section, Vid, Visual } from '../seed/content';

const CMS = path.resolve(__dirname, '..');
const MEDIA = path.join(CMS, 'seed', 'media');
const OUT = path.resolve(CMS, '..', 'web', 'fixtures', 'content.json');
const T = '2026-10-19T12:00:00.000Z';

let nextId = 1;
const docId = (type: string, key: string) => 'fx' + crypto.createHash('sha1').update(`${type}:${key}`).digest('hex').slice(0, 22);
const stamp = (published = true) => ({ createdAt: T, updatedAt: T, publishedAt: published ? T : null });

const fileCache = new Map<string, any>();
async function file(rel: string) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  const abs = path.join(MEDIA, rel);
  const ext = path.extname(rel).toLowerCase();
  const mime = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : ext === '.png' ? 'image/png' : 'image/jpeg';
  let width: number | null = null;
  let height: number | null = null;
  if (mime.startsWith('image/')) {
    const m = await sharp(abs).metadata();
    width = m.width ?? null;
    height = m.height ?? null;
  }
  const f = {
    id: nextId++, documentId: docId('file', rel), name: rel.replace(/\//g, '-'), ext, mime, width, height,
    size: Math.round(fs.statSync(abs).size / 10.24) / 100, url: `seed:${rel}`, ...stamp(),
  };
  fileCache.set(rel, f);
  return f;
}
const img = async (i?: Img) => (i ? { id: nextId++, alt: i.alt, decorative: false, caption: i.caption ?? null, credit: null, focalX: i.focalX ?? 0.5, focalY: i.focalY ?? 0.5, file: await file(i.file) } : null);
const vid = async (v?: Vid) => (v ? { id: nextId++, caption: v.caption ?? null, durationSec: null, loop: true, mp4: await file(v.mp4), webm: null, poster: await file(v.poster) } : null);
const visual = async (v?: Visual) =>
  v ? { id: nextId++, kind: v.kind, image: v.kind === 'image' ? await img(v.image) : null, video: v.kind === 'video' ? await vid(v.video) : null } : null;
const galleryItem = async (g: GalleryItem) => ({ id: nextId++, kind: g.kind, title: g.title ?? null, caption: g.caption ?? null, image: await img(g.image), video: await vid(g.video) });

const shallow = (type: string, key: string, visibility: string, extra: Record<string, unknown> = {}) => ({ id: nextId++, documentId: docId(type, key), visibility, ...extra });

async function sections(list: Section[] | undefined, vis: (type: string, key: string) => string) {
  const out: any[] = [];
  for (const s of list ?? []) {
    const base = { id: nextId++, __component: s.__component };
    switch (s.__component) {
      case 'sections.image': out.push({ ...base, size: s.size ?? 'wide', image: await img(s.image) }); break;
      case 'sections.gallery': out.push({ ...base, layout: s.layout ?? 'grid', items: await Promise.all(s.items.map(galleryItem)) }); break;
      case 'sections.loop-video': out.push({ ...base, size: s.size ?? 'wide', video: await vid(s.video) }); break;
      case 'sections.compare': out.push({ ...base, beforeLabel: s.beforeLabel ?? 'Before', afterLabel: s.afterLabel ?? 'After', caption: s.caption ?? null, before: await img(s.before), after: await img(s.after) }); break;
      case 'sections.mod-card': out.push({ ...base, mod: shallow('mod', s.mod, vis('mod', s.mod), { slug: s.mod }) }); break;
      case 'sections.timeline-embed': out.push({ ...base, fromStage: s.fromStage ?? null, toStage: s.toStage ?? null, family: shallow('family', s.family, vis('family', s.family), { familyId: s.family }) }); break;
      case 'sections.model-embed': out.push({ ...base, caption: s.caption ?? null, model: shallow('block', s.model, vis('block', s.model), { slug: s.model }) }); break;
      case 'sections.stat-grid': out.push({ ...base, stats: s.stats.map((x) => ({ id: nextId++, ...x })) }); break;
      case 'sections.rich-text': out.push({ ...base, content: s.content }); break;
      case 'sections.code': out.push({ ...base, language: s.language, code: s.code, filename: s.filename ?? null, caption: s.caption ?? null }); break;
      case 'sections.callout': out.push({ ...base, tone: s.tone, title: s.title ?? null, body: s.body }); break;
      case 'sections.quote': out.push({ ...base, text: s.text, attribution: s.attribution ?? null }); break;
    }
  }
  return out;
}

// ---- launch-preview visibility + canaries ------------------------------------------------------------------------
// Canary names carry the SYNTHETIC deny term from config/privacy.json ("zz private canary"), so the build assertion and
// lint-dist would catch them if the visibility filter ever let one through. Real private names never appear here.
type ModLike = C.ModSeed & { releases?: any[] };
const canaryMod: ModLike = {
  name: 'ZZ private canary fixture', slug: 'zz-private-canary', game: C.SE2, tagline: 'Private fixture: must never appear in dist/.', modStatus: 'wip',
  visibility: 'private', publish: true, sortOrder: 1, featured: true,
};
// A PUBLIC mod whose game is PRIVATE: must be dropped with its game (it never gets a page, card, redirect or feed item).
const orphanMod: ModLike = {
  name: 'ZZ private canary orphan', slug: 'orphan-canary-mod', game: 'canary-private-game', tagline: 'Public fixture on a private game: must never appear in dist/.',
  modStatus: 'wip', visibility: 'public', publish: true, sortOrder: 2,
};
const benchMod: ModLike = {
  name: 'Fixture test bench', slug: 'fixture-test-bench', game: C.SE2, tagline: 'Unlisted fixture: reachable by URL only, never listed.', modStatus: 'published',
  visibility: 'unlisted', publish: true, sortOrder: 999, gameVersionTested: '2.4.0.95', requiresScripts: 'no', license: 'MIT',
  stats: [{ value: '1', label: 'fixture' }],
};
// Idea teasers: SYNTHETIC stand-ins (the real idea cards are private, in the gitignored seed/private.ts, and never go in
// the fixtures). Same shapes as real ones: two Data Center add-ons (one blocked), a researching one, two plain ones.
const idea = (k: string, sortOrder: number, extra: Partial<ModLike> = {}): ModLike => ({
  name: `Idea fixture ${k.toUpperCase()}`, slug: `idea-fixture-${k}`, game: C.SE2, modStatus: 'idea', sortOrder,
  tagline: `Teaser fixture ${k.toUpperCase()}: a name and one vague line.`, visibility: 'public', publish: true, ...extra,
});
const ideaFixtures: ModLike[] = [
  idea('a', 20, { tags: ['data-center'] }),
  idea('b', 30, { stage: 'blocked', blockedReason: 'Waiting on a fixture', tags: ['data-center'] }),
  idea('c', 80),
  idea('d', 90, { stage: 'researching' }),
  idea('e', 100),
];
const mods: ModLike[] = [{ ...C.dataCenter, visibility: 'public' }, ...ideaFixtures, canaryMod, orphanMod, benchMod];
const VIS = new Map<string, string>();
for (const m of mods) VIS.set(`mod:${m.slug}`, m.visibility);
for (const f of C.families) VIS.set(`family:${f.familyId}`, 'public');
for (const g of C.games) VIS.set(`game:${g.slug}`, 'public');
VIS.set('game:canary-private-game', 'private');
VIS.set('family:zz-private-canary-family', 'private');
VIS.set('block:dc-rack42-fixture', 'public');
const vis = (type: string, key: string) => VIS.get(`${type}:${key}`) ?? 'private';

const kitchenSink: C.PostSeed = {
  title: 'Section test bench', slug: 'section-test-bench', subtitle: 'Every dynamic-zone section, for rendering tests.',
  excerpt: 'Unlisted fixture post that uses every section type. Reachable by URL only.', date: '2026-10-18', category: 'dev-log',
  tags: ['data-center'], relatedMods: ['data-center', 'zz-private-canary'], games: [C.SE2, 'canary-private-game'], visibility: 'unlisted', publish: true,
  cover: C.still('raised-floor'),
  body: [
    { __component: 'sections.rich-text', content: md('## Rich text\n\nA paragraph with **bold**, *italic*, `inline code` and [a link](/mods).\n\n### A third-level heading\n\n- One\n- Two\n\n1. First\n2. Second\n\n> A quoted line.') },
    { __component: 'sections.image', image: C.still('raised-floor'), size: 'inline' },
    { __component: 'sections.gallery', layout: 'grid', items: ['half-racks-24u', 'server-damage'].map((n) => ({ kind: 'image' as const, image: C.still(n), title: n, caption: C.captionOf(n) })) },
    { __component: 'sections.loop-video', video: C.loop('cooler-fans-spin-up'), size: 'inline' },
    { __component: 'sections.compare', before: C.still('datacenter-cold-aisle'), after: C.still('datacenter-cold-aisle-black-racks'), beforeLabel: 'Grey', afterLabel: 'Black', caption: 'Paint compare.' },
    { __component: 'sections.code', language: 'python', filename: 'example.py', code: 'def ease_out(t: float) -> float:\n    """Spring-ish ease-out used for UI motion."""\n    return 1 - (1 - t) ** 3\n', caption: 'Shiki-highlighted at build.' },
    { __component: 'sections.callout', tone: 'note', title: 'Note', body: md('A note callout.') },
    { __component: 'sections.callout', tone: 'tip', title: 'Tip', body: md('A tip callout.') },
    { __component: 'sections.callout', tone: 'caution', title: 'Caution', body: md('A caution callout with the hazard trim.') },
    { __component: 'sections.quote', text: 'A quote section, for rendering tests.', attribution: 'Fixture' },
    { __component: 'sections.model-embed', model: 'dc-rack42-fixture', caption: 'Viewer slot (M7): poster and loop fallback for now.' },
    { __component: 'sections.mod-card', mod: 'data-center' },
    { __component: 'sections.mod-card', mod: 'zz-private-canary' },
    { __component: 'sections.timeline-embed', family: 'servers', fromStage: 2, toStage: 6 },
    { __component: 'sections.timeline-embed', family: 'zz-private-canary-family' },
    { __component: 'sections.stat-grid', stats: [{ value: '12', label: 'section types' }, { value: '1', label: 'post' }] },
  ],
};
const canaryPost: C.PostSeed = {
  title: 'ZZ private canary post', slug: 'zz-private-canary-post', excerpt: 'Private fixture: must never appear in dist/.', date: '2026-10-20',
  category: 'dev-log', tags: [], relatedMods: ['data-center'], visibility: 'private', publish: true, body: [{ __component: 'sections.quote', text: 'canary' }],
};
// Unlisted spoiler fixture: exercises the spoiler warning (body must not render until the reader agrees).
const spoilerPost: C.PostSeed = {
  title: 'Spoiler fixture', slug: 'spoiler-fixture', excerpt: 'Unlisted fixture for the spoiler warning.', date: '2026-10-17', category: 'dev-log',
  tags: [], relatedMods: [], games: [C.SE2], visibility: 'unlisted', publish: true, spoiler: true,
  body: [{ __component: 'sections.rich-text', content: md('SPOILER-BODY-MARKER: only shown after the reader agrees.') }],
};
const posts: C.PostSeed[] = [...C.posts.map((p) => ({ ...p, visibility: 'public' as const, publish: true })), kitchenSink, canaryPost, spoilerPost];

async function main() {
  const tagObj = (slug: string) => {
    const t = C.tags.find((x) => x.slug === slug)!;
    return shallow('tag', slug, 'public', { slug, name: t.name });
  };
  const out: Record<string, any> = { $comment: 'Generated by cms/scripts/build-fixtures.ts from cms/seed/content.ts. Proposed launch state for review + private/unlisted canaries. Do not edit by hand.' };

  out.categories = C.categories.map((c) => ({ id: nextId++, documentId: docId('category', c.slug), name: c.name, slug: c.slug, description: c.description, visibility: 'public', ...stamp() }));
  out.tags = C.tags.map((t) => ({ id: nextId++, documentId: docId('tag', t.slug), name: t.name, slug: t.slug, description: null, visibility: 'public', ...stamp() }));
  out.authors = [{ id: nextId++, documentId: docId('author', C.author.slug), name: C.author.name, slug: C.author.slug, bio: C.author.bio, avatar: null, links: [], visibility: 'public', ...stamp() }];

  const link = (l: any) => ({ id: nextId++, label: l.label, url: l.url, kind: l.kind ?? 'internal', newTab: false });
  out.games = [];
  for (const g of C.games) {
    out.games.push({
      id: nextId++, documentId: docId('game', g.slug), name: g.name, slug: g.slug, shortName: g.shortName, tagline: g.tagline, summary: g.summary ?? null,
      art: await img(g.art), links: g.links.map(link), platformNotes: g.platformNotes ?? null, legalNotice: g.legalNotice ?? null,
      featured: g.featured ?? false, sortOrder: g.sortOrder ?? 100, visibility: 'public', seo: null, ...stamp(g.publish),
    });
  }
  out.games.push({
    id: nextId++, documentId: docId('game', 'canary-private-game'), name: 'ZZ private canary game', slug: 'canary-private-game', shortName: 'CANARY',
    tagline: 'Private fixture game: must never appear in dist/.', summary: null, art: null, links: [], platformNotes: null, legalNotice: 'ZZ private canary notice.',
    featured: true, sortOrder: 1, visibility: 'private', seo: null, ...stamp(),
  });

  out.mods = [];
  for (const m of mods) {
    out.mods.push({
      id: nextId++, documentId: docId('mod', m.slug), name: m.name, slug: m.slug, game: shallow('game', m.game, vis('game', m.game), { slug: m.game }),
      tagline: m.tagline, summary: m.summary ?? null,
      modStatus: m.modStatus, stage: m.stage ?? null, currentVersion: m.currentVersion ?? null, blockedReason: m.blockedReason ?? null, feasibility: m.feasibility ?? null,
      visibility: m.visibility, featured: m.featured ?? false, sortOrder: m.sortOrder ?? 100, gameVersionTested: m.gameVersionTested ?? null, gameVersionBuilt: m.gameVersionBuilt ?? null,
      requiresScripts: m.requiresScripts ?? null, requirements: m.requirements ?? null, steamWorkshopUrl: null, modioUrl: null, githubUrl: null,
      license: m.license ?? null, heroMedia: await visual(m.heroMedia), heroCaption: m.heroCaption ?? null, cardImage: await img(m.cardImage),
      stats: (m.stats ?? []).map((s) => ({ id: nextId++, note: null, ...s })),
      specs: (m.specs ?? []).map((s) => ({ id: nextId++, ...s })),
      features: await Promise.all((m.features ?? []).map(async (f) => ({ id: nextId++, title: f.title, body: f.body, visual: await visual(f.visual) }))),
      gallery: await Promise.all((m.gallery ?? []).map(galleryItem)),
      body: await sections(m.body, vis),
      tags: (m.tags ?? []).map(tagObj),
      seo: null,
      ...stamp(m.publish),
    });
  }

  out.modReleases = [
    { id: nextId++, documentId: docId('release', 'bench-1.0.0'), version: '1.0.0', releasedAt: '2026-10-18', channel: 'stable', gameVersion: '2.4.0.95',
      highlights: [{ id: nextId++, text: 'Fixture release for changelog rendering.' }, { id: nextId++, text: 'Second highlight.' }],
      notes: md('Fixture notes paragraph.'), changeNoteUrl: null, commitRange: null, visibility: 'unlisted',
      mod: shallow('mod', 'fixture-test-bench', 'unlisted', { slug: 'fixture-test-bench' }), ...stamp() },
    { id: nextId++, documentId: docId('release', 'bench-0.9.0'), version: '0.9.0-beta.1', releasedAt: '2026-10-10', channel: 'beta', gameVersion: '2.4.0.95',
      highlights: [{ id: nextId++, text: 'Older fixture release.' }], notes: null, changeNoteUrl: null, commitRange: null, visibility: 'unlisted',
      mod: shallow('mod', 'fixture-test-bench', 'unlisted', { slug: 'fixture-test-bench' }), ...stamp() },
    { id: nextId++, documentId: docId('release', 'canary'), version: '0.0.1', releasedAt: '2026-10-19', channel: 'test', gameVersion: null,
      highlights: [{ id: nextId++, text: 'ZZ private canary release.' }], notes: null, changeNoteUrl: null, commitRange: null, visibility: 'private',
      mod: shallow('mod', 'zz-private-canary', 'private', { slug: 'zz-private-canary' }), ...stamp() },
  ];

  out.timelineFamilies = [];
  for (const f of C.families) {
    out.timelineFamilies.push({
      id: nextId++, documentId: docId('family', f.familyId), familyId: f.familyId, name: f.name, shortName: f.shortName, slug: f.slug, summary: f.summary,
      sortOrder: f.sortOrder, visibility: 'public', mod: shallow('mod', 'data-center', 'public', { slug: 'data-center' }),
      stages: await Promise.all(f.stages.map(async (s: any) => ({ id: nextId++, date: s.date, label: s.label, note: s.note, image: await img(s.image), thumb: await img(s.thumb) }))),
      ...stamp(),
    });
  }
  out.timelineFamilies.push({
    id: nextId++, documentId: docId('family', 'zz-private-canary-family'), familyId: 'zz-private-canary-family', name: 'ZZ private canary family', shortName: 'ZZ canary',
    slug: 'zz-private-canary-family', summary: 'Private fixture: must never appear in dist/.', sortOrder: 1, visibility: 'private',
    mod: shallow('mod', 'zz-private-canary', 'private', { slug: 'zz-private-canary' }),
    stages: [{ id: nextId++, date: T, label: 'ZZ private canary stage', note: 'canary', image: null, thumb: null }], ...stamp(),
  });

  // Roadmap items: the committed ones, all public in the fixtures (like the idea cards), a teaser on an idea fixture,
  // plus a private canary that must never render.
  const fixtureMilestones = [
    ...C.publicMilestones,
    { phase: 'later' as const, label: 'Idea fixture E', note: 'A roadmap teaser tied to an idea card.', mod: 'idea-fixture-e', visibility: 'public' as const, publish: true, sortOrder: 115 } as C.RoadmapSeed,
  ].sort((a, b) => a.sortOrder - b.sortOrder);
  out.milestones = [
    ...fixtureMilestones.map((m) => ({
      id: nextId++, documentId: docId('milestone', m.label), phase: m.phase, date: m.date ?? null, label: m.label, note: m.note ?? null, sortOrder: m.sortOrder,
      visibility: 'public', mod: m.mod ? shallow('mod', m.mod, vis('mod', m.mod), { slug: m.mod }) : null, ...stamp(),
    })),
    { id: nextId++, documentId: docId('milestone', 'canary'), phase: 'next', date: null, label: 'ZZ private canary milestone', note: 'Private fixture.', sortOrder: 1, visibility: 'private', mod: null, ...stamp() },
    { id: nextId++, documentId: docId('milestone', 'canary-mod'), phase: 'now', date: null, label: 'Canary roadmap item', note: 'Public item on a private mod: dropped with the mod, never rendered.', sortOrder: 2, visibility: 'public',
      mod: shallow('mod', 'zz-private-canary', 'private', { slug: 'zz-private-canary' }), ...stamp() },
  ];

  const paint = C.PAINT_PRESETS.map((x) => ({ id: nextId++, ...x }));
  out.blocks = [{
    id: nextId++, documentId: docId('block', 'dc-rack42-fixture'), name: '42U rack, split front doors', slug: 'dc-rack42-fixture', glb: null, glbPath: null,
    fileSizeBytes: 1400000, triangles: null, poster: await img(C.still('rack-42u-front-loaded')), fallbackLoop: await vid(C.loop('rack-42u-turntable')),
    animations: [], paintPresets: [], defaultPaint: null, cameraOrbit: null, dimensionsCells: '4 × 5 × 10 cells (1.0 × 1.25 × 2.5 m)',
    description: 'A 42U server rack with split perforated front doors, loaded with servers.', provenance: 'needs-review', provenanceNote: 'Fixture: a needs-review model never loads a GLB.',
    exporterVersion: null, visibility: 'public', mod: shallow('mod', 'fixture-test-bench', 'unlisted', { slug: 'fixture-test-bench' }), ...stamp(),
  }];
  for (const b of C.blocks3d) {
    out.blocks.push({
      id: nextId++, documentId: docId('block', b.slug), name: b.name, slug: b.slug, glb: null, glbPath: b.glbPath, fileSizeBytes: b.fileSizeBytes,
      triangles: b.triangles, poster: await img(b.poster), fallbackLoop: await vid(b.fallbackLoop),
      animations: b.animations.map((a) => ({ id: nextId++, clip: a.clip, label: a.label, loop: !!a.loop, durationSec: null })),
      paintPresets: paint, defaultPaint: C.PAINT_PRESETS[0].hex, cameraOrbit: b.cameraOrbit, dimensionsCells: b.dimensionsCells,
      description: b.description, provenance: b.provenance, provenanceNote: b.provenanceNote, exporterVersion: 'tools/export-glb 1',
      visibility: 'public', mod: shallow('mod', b.mod, 'public', { slug: b.mod }), ...stamp(),
    });
  }

  out.blogPosts = [];
  for (const p of posts) {
    out.blogPosts.push({
      id: nextId++, documentId: docId('post', p.slug), title: p.title, slug: p.slug, subtitle: p.subtitle ?? null, excerpt: p.excerpt, spoiler: p.spoiler ?? false,
      cover: await img(p.cover), date: p.date, updatedNote: null, visibility: p.visibility,
      author: shallow('author', C.author.slug, 'public', { slug: C.author.slug, name: C.author.name }),
      category: shallow('category', p.category, 'public', { slug: p.category, name: C.categories.find((c) => c.slug === p.category)!.name }),
      tags: p.tags.map(tagObj),
      relatedMods: p.relatedMods.map((s) => shallow('mod', s, vis('mod', s), { slug: s })),
      games: (p.games ?? []).map((g) => shallow('game', g, vis('game', g), { slug: g })),
      body: await sections(p.body, vis), seo: null, ...stamp(p.publish),
    });
  }

  out.siteSettings = { id: nextId++, documentId: docId('single', 'site'), ...C.siteSettings, defaultSeo: { id: nextId++, ...C.siteSettings.defaultSeo, ogImage: null, noindex: false, canonicalOverride: null }, socialLinks: C.siteSettings.socialLinks.map(link), logo: null, logoMark: null, ...stamp() };
  out.navigation = { id: nextId++, documentId: docId('single', 'nav'), header: C.navigation.header.map(link), footer: C.navigation.footer.map((c) => ({ id: nextId++, title: c.title, links: c.links.map(link) })), ...stamp() };
  out.homePage = {
    id: nextId++, documentId: docId('single', 'home'), heroTagline: C.homePage.heroTagline, heroSubline: C.homePage.heroSubline,
    heroMedia: await visual(C.homePage.heroMedia), ctaPrimary: link(C.homePage.ctaPrimary), ctaSecondary: link(C.homePage.ctaSecondary),
    featuredMod: shallow('mod', 'data-center', 'public', { slug: 'data-center' }),
    historyFamily: shallow('family', 'rack42', 'public', { familyId: 'rack42' }),
    principles: C.homePage.principles.map((p) => ({ id: nextId++, ...p, visual: null })),
    seo: { id: nextId++, ...C.homePage.seo, ogImage: null, noindex: false, canonicalOverride: null }, ...stamp(),
  };
  const seo = (s: any) => ({ id: nextId++, ...s, ogImage: null, noindex: false, canonicalOverride: null });
  out.aboutPage = { id: nextId++, documentId: docId('single', 'about'), title: C.aboutPage.title, intro: C.aboutPage.intro, body: await sections(C.aboutPage.body, vis), seo: seo(C.aboutPage.seo), ...stamp() };
  out.brandPage = { id: nextId++, documentId: docId('single', 'brand'), boilerplateShort: C.brandPage.boilerplateShort, boilerplateLong: C.brandPage.boilerplateLong, downloads: [], body: await sections(C.brandPage.body, vis), seo: seo(C.brandPage.seo), ...stamp() };
  out.legalPage = { id: nextId++, documentId: docId('single', 'legal'), body: await sections(C.legalPage.body, vis), seo: seo(C.legalPage.seo), ...stamp() };
  out.redirects = [];

  // The fixtures are committed to a public repo: never let a private seed entry (seed/private.ts) into them.
  const text = JSON.stringify(out).toLowerCase();
  const leaks = [...C.ideaMods.flatMap((m) => [m.slug, m.tagline]), ...(C.privateSeed.milestones ?? []).flatMap((m) => [m.label, m.note ?? ''])]
    .filter((t) => t && t.length > 3 && text.includes(t.toLowerCase()));
  if (leaks.length) throw new Error(`build-fixtures: private seed entries reached the fixtures: ${leaks.length} hit(s)`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`build-fixtures: ${out.mods.length} mods, ${out.blogPosts.length} posts, ${out.timelineFamilies.length} families, ${out.milestones.length} milestones, ${fileCache.size} media → web/fixtures/content.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
