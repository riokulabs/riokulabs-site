/**
 * Seed Strapi from cms/seed/content.ts (CONTENT-MODEL §9). Allowlist-driven, idempotent (upsert by slug / key).
 *
 *   npm run seed                      # create what's missing; confirm-items stay PRIVATE (default, HANDOFF §2.5)
 *   npm run seed -- --update          # also overwrite existing entries with the seed text (careful: loses edits)
 *   npm run seed -- --approve=games,data-center,history,roadmap,author,site-copy
 *                                     # set those confirm-items to their intended visibility (the user's call)
 *
 * Safety: before touching the database the whole seed text is linted against the privacy deny patterns and the IP
 * deny terms (any hit aborts), and only files listed in seed/media/MANIFEST.json (staged by prepare-media from the
 * allowlist) can be uploaded. Idea mods and blog posts are always created as private drafts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootStrapi, CMS_ROOT } from './lib/boot';
import { compilePatterns, loadPrivacyConfig, loadPrivacyLocal, scanDeep } from '../src/utils/privacy';
import * as C from '../seed/content';
import type { Img, Vid, Visual, Section, GalleryItem } from '../seed/content';

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const APPROVED = new Set((args.find((a) => a.startsWith('--approve='))?.split('=')[1] ?? '').split(',').filter(Boolean));
// 'history' used to cover the milestones too; keep it approving the roadmap so old commands still work.
if (APPROVED.has('history')) APPROVED.add('roadmap');
const MEDIA = path.join(CMS_ROOT, 'seed', 'media');
const manifest: { file: string; bytes: number }[] = JSON.parse(fs.readFileSync(path.join(MEDIA, 'MANIFEST.json'), 'utf8'));
const allowedFiles = new Set(manifest.map((m) => m.file));

/** Drop undefined keys: Strapi treats a present-but-undefined component key as an empty component. */
const clean = <T extends Record<string, any>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm' };

/** Visibility for an item: private drafts stay private; confirm-items need an explicit --approve key. */
function vis(item: { visibility: C.Vis; confirm?: boolean }, approveKey: string): C.Vis {
  if (!item.confirm) return item.visibility;
  return APPROVED.has(approveKey) ? item.visibility : 'private';
}

function lint() {
  if (!loadPrivacyLocal(CMS_ROOT)) {
    console.error('seed: the private lists (config/privacy.local.json) are missing, so the seed lint would only check the public canaries. Aborting.');
    process.exit(1);
  }
  const cfg = loadPrivacyConfig(CMS_ROOT);
  const all = {
    categories: C.categories, tags: C.tags, author: C.author, games: C.games, mods: [C.dataCenter, ...C.ideaMods], families: C.families,
    milestones: C.milestones, posts: C.posts, singles: [C.siteSettings, C.navigation, C.homePage, C.aboutPage, C.brandPage, C.legalPage],
  };
  const hits = [...scanDeep(all, compilePatterns(cfg.denyPatterns, 'i')), ...scanDeep(all, compilePatterns(cfg.ipDenyTerms, 'i')),
    ...scanDeep(all, compilePatterns(cfg.retiredBrandTerms ?? [], 'i'))];
  if (hits.length) {
    console.error('seed: the seed text matches privacy/IP deny lists, aborting:\n' + hits.map((h) => `  ${h.path} /${h.pattern}/ "${h.text}"`).join('\n'));
    process.exit(1);
  }
}

async function main() {
  lint();
  const app = await bootStrapi();
  const upload = app.plugin('upload').service('upload');
  const folderSvc = app.plugin('upload').service('folder');
  const stats = { uploaded: 0, reusedMedia: 0, created: 0, updated: 0, skipped: 0, published: 0, unpublished: 0 };

  // ---- media -------------------------------------------------------------------------------------------------
  const folderCache = new Map<string, number>();
  async function folder(p: string): Promise<number | null> {
    let parent: number | null = null;
    let acc = '';
    for (const name of p.split('/').filter(Boolean)) {
      acc += '/' + name;
      if (folderCache.has(acc)) {
        parent = folderCache.get(acc)!;
        continue;
      }
      const existing: any = await app.db.query('plugin::upload.folder').findOne({ where: { name, parent: parent ?? null } });
      const f: any = existing ?? (await folderSvc.create({ name, parent }));
      folderCache.set(acc, f.id);
      parent = f.id;
    }
    return parent;
  }
  const fileIds = new Map<string, number>();
  async function media(rel: string): Promise<number> {
    if (fileIds.has(rel)) return fileIds.get(rel)!;
    if (!allowedFiles.has(rel)) throw new Error(`seed: ${rel} is not in seed/media/MANIFEST.json (not allow-listed)`);
    const name = rel.replace(/\//g, '-');
    const existing: any = await app.db.query('plugin::upload.file').findOne({ where: { name } });
    if (existing) {
      stats.reusedMedia++;
      fileIds.set(rel, existing.id);
      return existing.id;
    }
    const dir = rel.startsWith('history/') ? `/history/${rel.split('/')[2]}` : '/mods/data-center';
    const filepath = path.join(MEDIA, rel);
    const [f]: any[] = await upload.upload({
      data: { fileInfo: { name, folder: await folder(dir) } },
      files: { filepath, originalFilename: name, mimetype: MIME[path.extname(rel).toLowerCase()], size: fs.statSync(filepath).size },
    });
    stats.uploaded++;
    fileIds.set(rel, f.id);
    return f.id;
  }
  const img = async (i?: Img) => (i ? { file: await media(i.file), alt: i.alt, caption: i.caption, focalX: i.focalX ?? 0.5, focalY: i.focalY ?? 0.5 } : undefined);
  const vid = async (v?: Vid) => (v ? { mp4: await media(v.mp4), poster: await media(v.poster), caption: v.caption, loop: true } : undefined);
  const visual = async (v?: Visual) =>
    v ? (v.kind === 'image' ? { kind: 'image', image: await img(v.image) } : { kind: 'video', video: await vid(v.video) }) : undefined;
  const galleryItem = async (g: GalleryItem) => clean({ kind: g.kind, image: await img(g.image), video: await vid(g.video), title: g.title, caption: g.caption });

  // ---- documents ---------------------------------------------------------------------------------------------
  const docIds = new Map<string, string>(); // `${uid}:${key}` → documentId
  async function upsert(uid: any, key: { field: string; value: string }, data: Record<string, any>, publish: boolean) {
    const docs = app.documents(uid);
    const existing: any = await docs.findFirst({ filters: { [key.field]: key.value }, status: 'draft' } as any);
    let documentId: string;
    if (existing) {
      documentId = existing.documentId;
      if (UPDATE) {
        await docs.update({ documentId, data } as any);
        stats.updated++;
      } else stats.skipped++;
    } else {
      documentId = (await docs.create({ data } as any)).documentId;
      stats.created++;
    }
    // Publish new/updated entries, and repair entries a previous (interrupted) run created but never published.
    const hasPublished = existing && (await docs.findFirst({ filters: { documentId }, status: 'published' } as any));
    if (publish && (!existing || UPDATE || !hasPublished)) {
      await docs.publish({ documentId } as any);
      stats.published++;
    }
    docIds.set(`${uid}:${key.value}`, documentId);
    return documentId;
  }
  const ref = (uid: string, key: string) => {
    const id = docIds.get(`${uid}:${key}`);
    if (!id) throw new Error(`seed: no ${uid} "${key}" seeded yet`);
    return id;
  };
  async function sections(list?: Section[]) {
    if (!list) return [];
    const out: any[] = [];
    for (const s of list) {
      switch (s.__component) {
        case 'sections.image': out.push({ ...s, image: await img(s.image) }); break;
        case 'sections.gallery': out.push({ ...s, items: await Promise.all(s.items.map(galleryItem)) }); break;
        case 'sections.loop-video': out.push({ ...s, video: await vid(s.video) }); break;
        case 'sections.compare': out.push({ ...s, before: await img(s.before), after: await img(s.after) }); break;
        case 'sections.mod-card': out.push({ ...s, mod: ref('api::mod.mod', s.mod) }); break;
        case 'sections.timeline-embed': out.push({ ...s, family: ref('api::timeline-family.timeline-family', s.family) }); break;
        case 'sections.model-embed': break; // no Block3DModels until M7
        default: out.push(s);
      }
    }
    return out;
  }

  // Seed entries renamed by the 2026-10-20 rebrand (slugs are the upsert key): remove the old copies so no entry keeps
  // the retired studio name. Only these exact seed slugs (listed in the gitignored seed/private.ts), only ever created
  // by this script.
  for (const [uid, slug] of C.privateSeed.retiredSeedEntries ?? []) {
    const old: any = await app.documents(uid as any).findFirst({ filters: { slug }, status: 'draft' } as any);
    if (old) {
      await app.documents(uid as any).delete({ documentId: old.documentId } as any);
      console.log(`seed: removed retired seed entry ${uid} "${slug}"`);
    }
  }

  for (const c of C.categories) await upsert('api::category.category', { field: 'slug', value: c.slug }, { name: c.name, slug: c.slug, description: c.description, visibility: c.visibility }, c.publish);
  for (const t of C.tags) await upsert('api::tag.tag', { field: 'slug', value: t.slug }, { name: t.name, slug: t.slug, visibility: t.visibility }, t.publish);
  await upsert('api::author.author', { field: 'slug', value: C.author.slug },
    { name: C.author.name, slug: C.author.slug, bio: C.author.bio, visibility: vis(C.author, 'author') }, C.author.publish);

  // Games first: every mod references one, and a mod whose game is hidden is not built (web/src/lib/load.ts).
  for (const g of C.games) {
    await upsert('api::game.game', { field: 'slug', value: g.slug }, clean({
      name: g.name, slug: g.slug, shortName: g.shortName, tagline: g.tagline, summary: g.summary, art: await img(g.art),
      links: g.links.map((l) => ({ label: l.label, url: l.url, kind: l.kind ?? 'external', newTab: false })), platformNotes: g.platformNotes,
      legalNotice: g.legalNotice, featured: g.featured ?? false, sortOrder: g.sortOrder ?? 100, visibility: vis(g, 'games'),
    }), g.publish);
  }
  if (APPROVED.has('data-center') && !APPROVED.has('games')) {
    console.warn('seed: --approve=data-center without games: the Data Center stays off the site until its game is public too.');
  }

  for (const m of [C.dataCenter, ...C.ideaMods]) {
    const data: Record<string, any> = clean({
      name: m.name, slug: m.slug, game: ref('api::game.game', m.game), tagline: m.tagline, summary: m.summary, modStatus: m.modStatus, stage: m.stage,
      blockedReason: m.blockedReason, feasibility: m.feasibility, featured: m.featured ?? false, sortOrder: m.sortOrder ?? 100,
      gameVersionTested: m.gameVersionTested, gameVersionBuilt: m.gameVersionBuilt, requiresScripts: m.requiresScripts, requirements: m.requirements, license: m.license,
      heroMedia: await visual(m.heroMedia), heroCaption: m.heroCaption, cardImage: await img(m.cardImage), stats: m.stats ?? [], specs: m.specs ?? [], currentVersion: m.currentVersion,
      features: await Promise.all((m.features ?? []).map(async (f) => clean({ title: f.title, body: f.body, visual: await visual(f.visual) }))),
      gallery: await Promise.all((m.gallery ?? []).map(galleryItem)),
      tags: (m.tags ?? []).map((t) => ref('api::tag.tag', t)),
      visibility: m.slug === 'data-center' ? vis(m, 'data-center') : 'private', // ideas: always private drafts
    });
    await upsert('api::mod.mod', { field: 'slug', value: m.slug }, data, m.slug === 'data-center' ? m.publish : false);
  }
  // Mod bodies can reference families (timeline-embed), so they are written after the families exist.
  for (const f of C.families) {
    const stages = [];
    for (const s of f.stages) stages.push(clean({ date: s.date, label: s.label, note: s.note, image: await img(s.image), thumb: await img(s.thumb) }));
    await upsert('api::timeline-family.timeline-family', { field: 'familyId', value: f.familyId }, {
      familyId: f.familyId, name: f.name, shortName: f.shortName, slug: f.slug, summary: f.summary, sortOrder: f.sortOrder,
      mod: ref('api::mod.mod', f.mod), stages, visibility: vis(f, 'history'),
    }, f.publish);
  }
  const dcBody = await sections(C.dataCenter.body);
  const dcId = ref('api::mod.mod', 'data-center');
  const dcDraft: any = await app.documents('api::mod.mod').findOne({ documentId: dcId, status: 'draft', populate: { body: true } } as any);
  if (!dcDraft?.body?.length || UPDATE) {
    await app.documents('api::mod.mod').update({ documentId: dcId, data: { body: dcBody } } as any);
    if (C.dataCenter.publish) await app.documents('api::mod.mod').publish({ documentId: dcId } as any);
  }

  // Roadmap items (milestone collection). Upserted by label; old per-task milestones are not removed here (see README).
  for (const m of C.milestones) {
    await upsert('api::milestone.milestone', { field: 'label', value: m.label }, clean({
      phase: m.phase, date: m.date ?? null, label: m.label, note: m.note, sortOrder: m.sortOrder,
      mod: m.mod ? ref('api::mod.mod', m.mod) : null, visibility: vis(m, 'roadmap'),
    }), m.publish);
  }

  // 3D block models (M7): confirm-items with the Data Center (public only with --approve=data-center)
  for (const b of C.blocks3d) {
    await upsert('api::block-3d-model.block-3d-model', { field: 'slug', value: b.slug }, clean({
      name: b.name, slug: b.slug, mod: ref('api::mod.mod', b.mod), glbPath: b.glbPath, fileSizeBytes: b.fileSizeBytes,
      triangles: b.triangles, poster: await img(b.poster), fallbackLoop: await vid(b.fallbackLoop),
      animations: b.animations.map((a) => ({ clip: a.clip, label: a.label, loop: !!a.loop })),
      paintPresets: C.PAINT_PRESETS, defaultPaint: C.PAINT_PRESETS[0].hex, cameraOrbit: b.cameraOrbit,
      dimensionsCells: b.dimensionsCells, description: b.description, provenance: b.provenance,
      provenanceNote: b.provenanceNote, exporterVersion: 'tools/export-glb 1', visibility: vis(b, 'data-center'),
    }), b.publish);
  }

  for (const p of C.posts) {
    await upsert('api::blog-post.blog-post', { field: 'slug', value: p.slug }, clean({
      title: p.title, slug: p.slug, subtitle: p.subtitle, excerpt: p.excerpt, spoiler: p.spoiler ?? false, cover: await img(p.cover), date: p.date,
      author: ref('api::author.author', C.author.slug), category: ref('api::category.category', p.category),
      tags: p.tags.map((t) => ref('api::tag.tag', t)), relatedMods: p.relatedMods.map((m) => ref('api::mod.mod', m)),
      games: (p.games ?? []).map((g) => ref('api::game.game', g)),
      body: await sections(p.body), visibility: 'private', // blog posts: always private drafts (HANDOFF §2.5)
    }), false);
  }

  // ---- single types (published) -------------------------------------------------------------------------------
  // Single types hold the site copy (not-affiliated wording, about, legal, brand). Controller ruling 2026-10-20: they
  // stay drafts until the user approves the wording (`--approve=site-copy`); unapproved published versions are
  // unpublished so the local state matches.
  async function single(uid: any, data: Record<string, any>) {
    const docs = app.documents(uid);
    const existing: any = await docs.findFirst({ status: 'draft' } as any);
    let documentId: string = existing?.documentId;
    if (!existing) {
      documentId = (await docs.create({ data } as any)).documentId;
      stats.created++;
    } else if (UPDATE) {
      await docs.update({ documentId, data } as any);
      stats.updated++;
    } else stats.skipped++;
    const published = await docs.findFirst({ status: 'published' } as any);
    if (APPROVED.has('site-copy')) {
      if (!published || UPDATE || !existing) {
        await docs.publish({ documentId } as any);
        stats.published++;
      }
    } else if (published) {
      await docs.unpublish({ documentId } as any);
      stats.unpublished++;
    }
  }
  await single('api::site-settings.site-settings', C.siteSettings);
  await single('api::navigation.navigation', C.navigation);
  await single('api::home-page.home-page', {
    ...C.homePage, heroMedia: await visual(C.homePage.heroMedia),
    featuredMod: ref('api::mod.mod', C.homePage.featuredMod),
    historyFamily: ref('api::timeline-family.timeline-family', C.homePage.historyFamily),
  });
  await single('api::about-page.about-page', { ...C.aboutPage, body: await sections(C.aboutPage.body) });
  await single('api::brand-page.brand-page', { ...C.brandPage, body: await sections(C.brandPage.body) });
  await single('api::legal-page.legal-page', { ...C.legalPage, body: await sections(C.legalPage.body) });

  await app.destroy();
  console.log(`seed: ${JSON.stringify(stats)}; approved: ${[...APPROVED].join(',') || 'none (confirm-items private)'}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.details ? JSON.stringify(e.details, null, 2) : '', e);
  process.exit(1);
});
