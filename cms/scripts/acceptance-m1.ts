/**
 * M1 acceptance (HANDOFF §3 M1), against a throwaway SQLite database on port 1338:
 * - every content type from CONTENT-MODEL §3 is registered;
 * - a Mod created without touching visibility is private;
 * - publishing "ZZ private canary test" with visibility public is rejected by the publish guard;
 * - unauthenticated GET /api/mods is denied (Strapi 5.58 answers 401; the spec says 403);
 * - with the site-build token, a private published mod isn't returned (list or by id), and a private relation on a
 *   single type is stripped;
 * - games (2026-10-20): a new Game is private; a private game is invisible to the build token (list, id, populated
 *   from a mod) and can't be probed through a relation filter.
 * - admin: every content type sits in a Content Manager folder, and the view settings in admin-views-data.ts are applied.
 * - Privacy lists (admin-only single type): boot works with no private lists anywhere, and then (production rule
 *   forced on) a public publish is refused while a private one is not; the public role and the preview token can't
 *   read the entry; the build token reads the three lists only; an edit is validated and reaches the guard at once.
 * Run: npm run test:acceptance
 */
import fs from 'node:fs';
import path from 'node:path';

const DB = '.tmp/acceptance.db';
process.env.DATABASE_CLIENT = 'sqlite';
process.env.DATABASE_FILENAME = DB;
process.env.PORT = '1338';
process.env.HOST = '127.0.0.1';
// A throwaway database needs throwaway secrets: CI has no cms/.env. Random per run, never written anywhere.
import crypto from 'node:crypto';
const rnd = () => crypto.randomBytes(24).toString('base64');
process.env.APP_KEYS ||= [rnd(), rnd()].join(',');
for (const k of ['API_TOKEN_SALT', 'ADMIN_JWT_SECRET', 'TRANSFER_TOKEN_SALT', 'JWT_SECRET', 'ENCRYPTION_KEY']) process.env[k] ||= rnd();

import { bootStrapi, CMS_ROOT } from './lib/boot';
import { ensureReadToken } from './lib/tokens';
import { readPrivacyLocalEnv, readPrivacyLocalFile } from '../src/utils/privacy';
import { EMPTY_LISTS_MESSAGE, PRIVACY_LISTS_UID } from '../src/utils/privacy-lists';

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail });

async function main() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(path.join(CMS_ROOT, f), { force: true });
  // No local file and no PRIVACY_LOCAL_JSON (CI, a fork): the boot below proves Strapi starts with no private lists.
  const emptySetup = !readPrivacyLocalFile(CMS_ROOT) && !readPrivacyLocalEnv();
  const app = await bootStrapi({ listen: true });
  try {
    const expected = ['game', 'mod', 'mod-release', 'blog-post', 'author', 'tag', 'category', 'block-3d-model', 'timeline-family',
      'milestone', 'redirect', 'site-settings', 'navigation', 'home-page', 'about-page', 'brand-page', 'legal-page', 'privacy-lists'];
    const missing = expected.filter((t) => !app.contentTypes[`api::${t}.${t}` as any]);
    check('all 18 content types registered', missing.length === 0, missing.join(', '));

    // Admin organisation: content-type folders load from groups.json; view settings are applied at bootstrap.
    const tree: any = await (app as any).get('content-structure').resolve();
    const inFolders = new Set<string>();
    const walk = (nodes: any[]) => nodes.forEach((n) => (n.type === 'group' ? walk(n.children) : inFolders.add(n.uid)));
    walk([...tree.collectionTypes, ...tree.singleTypes]);
    const loose = expected.filter((t) => !inFolders.has(`api::${t}.${t}`));
    check('every content type is in a Content Manager folder', loose.length === 0, loose.join(', ') || JSON.stringify(tree).slice(0, 200));
    const cm: any = app.plugin('content-manager');
    const modConf = await cm.service('content-types').findConfiguration({ uid: 'api::mod.mod' });
    check('Mod list view: entry title, columns and labels come from admin-views',
      modConf.settings.mainField === 'name' && modConf.layouts.list.join() === 'name,game,modStatus,stage,visibility,updatedAt'
        && modConf.metadatas.modStatus.edit.label === 'Mod status' && modConf.metadatas.game.edit.mainField === 'name',
      JSON.stringify({ s: modConf.settings, l: modConf.layouts.list }).slice(0, 200));
    const imgConf = await cm.service('components').findConfiguration({ uid: 'media.image' });
    check('media.image component: labels come from admin-views', imgConf.metadatas.alt.edit.label === 'Alt text', JSON.stringify(imgConf.metadatas.alt));

    const mods = app.documents('api::mod.mod');
    const d1 = await mods.create({ data: { name: 'Default visibility', tagline: 'x', modStatus: 'idea', slug: 'default-visibility' } as any });
    check('new Mod defaults to visibility private', (d1 as any).visibility === 'private', (d1 as any).visibility);

    const canary = await mods.create({ data: { name: 'ZZ private canary test', slug: 'zz-private-canary-test', tagline: 'x', modStatus: 'wip', visibility: 'public' } as any });
    let rejected = false;
    let msg = '';
    try {
      await mods.publish({ documentId: canary.documentId });
    } catch (e) {
      rejected = true;
      msg = (e as Error).message;
    }
    check('publishing "ZZ private canary test" (public) is rejected', rejected, msg.slice(0, 100));

    const priv = await mods.create({ data: { name: 'Hidden published', slug: 'hidden-published', tagline: 'x', modStatus: 'wip', visibility: 'private' } as any });
    await mods.publish({ documentId: priv.documentId });
    const pub = await mods.create({ data: { name: 'Shown published', slug: 'shown-published', tagline: 'x', modStatus: 'wip', visibility: 'public' } as any });
    await mods.publish({ documentId: pub.documentId });
    await app.documents('api::home-page.home-page').create({
      data: { heroTagline: 't', featuredMod: priv.documentId } as any,
      status: 'published',
    } as any);

    const base = 'http://127.0.0.1:1338/api';
    const anon = await fetch(`${base}/mods`);
    // Strapi 5.58 answers 401 (no credentials) where the spec expected 403; both mean denied.
    check('unauthenticated GET /api/mods → denied (401/403)', [401, 403].includes(anon.status), String(anon.status));

    const token = await ensureReadToken(app, 'site-build', 'acceptance');
    const h = { Authorization: `Bearer ${token}` };
    const list: any = await (await fetch(`${base}/mods?status=published`, { headers: h })).json();
    const names = (list.data ?? []).map((m: any) => m.name);
    check('site-build: public published mod is returned', names.includes('Shown published'), names.join(', '));
    check('site-build: private published mod is NOT returned', !names.includes('Hidden published'), names.join(', '));
    const sneaky: any = await (await fetch(`${base}/mods?filters[visibility][$eq]=private`, { headers: h })).json();
    check('site-build: asking for private explicitly returns nothing', (sneaky.data ?? []).length === 0, JSON.stringify(sneaky).slice(0, 120));
    const one = await fetch(`${base}/mods/${priv.documentId}`, { headers: h });
    check('site-build: GET /api/mods/<private id> → 404', one.status === 404, String(one.status));
    const home: any = await (await fetch(`${base}/home-page?populate[featuredMod]=true`, { headers: h })).json();
    check('site-build: private featuredMod stripped from the home page', home.data && home.data.featuredMod == null, JSON.stringify(home).slice(0, 160));
    // --- security review 2026-10-19 ---
    const posts = app.documents('api::blog-post.blog-post');
    const body = [{ __component: 'sections.quote', text: 'q' }];
    const secret = await posts.create({ data: { title: 'Secret post', slug: 'secret-post', excerpt: 'x', date: '2026-10-19', visibility: 'private', relatedMods: [pub.documentId], body } as any });
    await posts.publish({ documentId: secret.documentId });
    const open = await posts.create({ data: { title: 'Open post', slug: 'open-post', excerpt: 'x', date: '2026-10-19', visibility: 'public', relatedMods: [pub.documentId], body } as any });
    await posts.publish({ documentId: open.documentId });
    // A public entry that was never published (draft only).
    await mods.create({ data: { name: 'Draft only', slug: 'draft-only', tagline: 'x', modStatus: 'wip', visibility: 'public' } as any });

    const pop: any = await (await fetch(`${base}/mods/${pub.documentId}?populate[posts][fields][0]=title`, { headers: h })).json();
    const popTitles = (pop.data?.posts ?? []).map((p: any) => p.title);
    check('populate with fields omitting visibility: private related post stays hidden', !popTitles.includes('Secret post') && popTitles.includes('Open post'), JSON.stringify(popTitles));
    const popStr: any = await (await fetch(`${base}/mods?populate=*&fields[0]=name`, { headers: h })).json();
    const allPosts = (popStr.data ?? []).flatMap((m: any) => (m.posts ?? []).map((p: any) => p.title));
    check('populate=* with root fields: private related post stays hidden', !allPosts.includes('Secret post'), JSON.stringify(allPosts));

    const drafts: any = await (await fetch(`${base}/mods?status=draft`, { headers: h })).json();
    const draftNames = (drafts.data ?? []).map((m: any) => m.name);
    check('status=draft returns only published entries', !draftNames.includes('Draft only') && draftNames.includes('Shown published'), JSON.stringify(draftNames));
    const draftOne = await fetch(`${base}/mods/${pub.documentId}?status=draft`, { headers: h });
    check('status=draft on findOne still answers from the published version', draftOne.status === 200, String(draftOne.status));

    const probeHit = await fetch(`${base}/mods?filters[posts][title][$eq]=Secret%20post`, { headers: h });
    const probeMiss = await fetch(`${base}/mods?filters[posts][title][$eq]=No%20such%20post`, { headers: h });
    const hitBody = await probeHit.text();
    const missBody = await probeMiss.text();
    check('relation filter into a private entry is rejected (400), same answer as a miss (no oracle)',
      probeHit.status === 400 && probeMiss.status === 400 && hitBody.replace(/Secret post/g, '') === missBody.replace(/No such post/g, ''),
      `${probeHit.status}/${probeMiss.status}`);
    const sortProbe = await fetch(`${base}/mods?sort=posts.title:asc`, { headers: h });
    check('sort through a guarded relation is rejected (400)', sortProbe.status === 400, String(sortProbe.status));
    const popFilter = await fetch(`${base}/mods?populate[posts][filters][relatedMods][name][$eq]=Hidden%20published`, { headers: h });
    check('relation filter hidden inside populate is rejected (400)', popFilter.status === 400, String(popFilter.status));
    const count = (r: any) => r?.meta?.pagination?.total;
    const plain: any = await (await fetch(`${base}/mods`, { headers: h })).json();
    check('result count unaffected by private related entries', count(plain) === 1, String(count(plain)));

    // --- security review round 2 ---
    const host = await mods.create({ data: { name: 'Card host', slug: 'card-host', tagline: 'x', modStatus: 'wip', visibility: 'public',
      body: [{ __component: 'sections.mod-card', mod: priv.documentId }] } as any });
    await mods.publish({ documentId: host.documentId });
    const dzOn: any = await (await fetch(`${base}/mods/${host.documentId}?populate[body][on][sections.mod-card][populate][mod][fields][0]=name`, { headers: h })).json();
    const card = dzOn.data?.body?.[0];
    check('DZ on-fragment: private mod in a mod-card stays hidden', !!card && card.mod == null, JSON.stringify(dzOn).slice(0, 200));
    const dzRaw = await fetch(`${base}/mods/${host.documentId}?populate[body][populate][mod]=true`, { headers: h });
    check('DZ object populate without on-fragments is rejected (400)', dzRaw.status === 400, String(dzRaw.status));
    const unknown = await fetch(`${base}/mods?populate[nope]=true`, { headers: h });
    check('unknown populate key is rejected (400)', unknown.status === 400, String(unknown.status));
    const mediaF = await fetch(`${base}/mods?populate[cardImage][populate][file][filters][name][$eq]=x`, { headers: h });
    check('media populate with nested filters is rejected (400)', mediaF.status === 400, String(mediaF.status));

    // --- games (2026-10-20) ---
    const games = app.documents('api::game.game');
    const g0 = await games.create({ data: { name: 'Default game', slug: 'default-game', tagline: 'x' } as any });
    check('new Game defaults to visibility private', (g0 as any).visibility === 'private', (g0 as any).visibility);
    const hiddenGame = await games.create({ data: { name: 'Hidden game', slug: 'hidden-game', tagline: 'x', visibility: 'private' } as any });
    await games.publish({ documentId: hiddenGame.documentId });
    const shownGame = await games.create({ data: { name: 'Shown game', slug: 'shown-game', tagline: 'x', visibility: 'public' } as any });
    await games.publish({ documentId: shownGame.documentId });
    const onHidden = await mods.create({ data: { name: 'On hidden game', slug: 'on-hidden-game', tagline: 'x', modStatus: 'wip', visibility: 'public', game: hiddenGame.documentId } as any });
    await mods.publish({ documentId: onHidden.documentId });
    const onShown = await mods.create({ data: { name: 'On shown game', slug: 'on-shown-game', tagline: 'x', modStatus: 'wip', visibility: 'public', game: shownGame.documentId } as any });
    await mods.publish({ documentId: onShown.documentId });
    const gl: any = await (await fetch(`${base}/games`, { headers: h })).json();
    const gNames = (gl.data ?? []).map((g: any) => g.name);
    check('site-build: public game listed, private game not', gNames.includes('Shown game') && !gNames.includes('Hidden game'), gNames.join(', '));
    check('site-build: GET /api/games/<private id> → 404', (await fetch(`${base}/games/${hiddenGame.documentId}`, { headers: h })).status === 404);
    const mg: any = await (await fetch(`${base}/mods?populate[game][fields][0]=slug&pagination[pageSize]=100`, { headers: h })).json();
    const byName = Object.fromEntries((mg.data ?? []).map((m: any) => [m.name, m.game]));
    check('site-build: a private game is stripped from a populated mod; a public one is kept',
      'On hidden game' in byName && byName['On hidden game'] == null && byName['On shown game']?.slug === 'shown-game', JSON.stringify(byName).slice(0, 200));
    const gp = await fetch(`${base}/mods?filters[game][name][$eq]=Hidden%20game`, { headers: h });
    check('relation filter into games is rejected (400)', gp.status === 400, String(gp.status));

    // --- round 3: the preview token (and only it) reads drafts and private entries ---
    const ptoken = await ensureReadToken(app, 'site-preview', 'acceptance');
    const pv: any = await (await fetch(`${base}/mods?status=draft&fields[0]=name&pagination[pageSize]=100`, { headers: { Authorization: `Bearer ${ptoken}` } })).json();
    const pvNames = (pv.data ?? []).map((m: any) => m.name);
    check('site-preview: sees private and never-published drafts', pvNames.includes('Hidden published') && pvNames.includes('Draft only'), pvNames.join(', '));

    const upload = await fetch(`${base}/upload/files`);
    check('unauthenticated GET /api/upload/files → denied (401/403)', [401, 403].includes(upload.status), String(upload.status));

    // --- round 4: Privacy lists (admin-only single type). Details print status codes and counts only. ---
    // (Strapi runs its compiled copy of privacy-runtime, so its state is checked by behaviour, not read from here.)
    if (emptySetup) {
      check('empty privacy setup: Strapi booted without private lists', true);
      process.env.PRIVACY_REQUIRE_LISTS = '1';
      try {
        const em = await mods.create({ data: { name: 'Empty lists public', slug: 'empty-lists-public', tagline: 'x', modStatus: 'wip', visibility: 'public' } as any });
        let emMsg = '';
        try {
          await mods.publish({ documentId: em.documentId });
        } catch (e) {
          emMsg = (e as Error).message;
        }
        check('empty lists (production rule): publishing a public mod is refused with "Privacy lists are empty"', emMsg === EMPTY_LISTS_MESSAGE, emMsg.slice(0, 120));
        const ep = await mods.create({ data: { name: 'Empty lists private', slug: 'empty-lists-private', tagline: 'x', modStatus: 'wip', visibility: 'private' } as any });
        let epOk = true;
        try {
          await mods.publish({ documentId: ep.documentId });
        } catch {
          epOk = false;
        }
        check('empty lists (production rule): a private mod can still be published', epOk);
      } finally {
        delete process.env.PRIVACY_REQUIRE_LISTS;
      }
    } else console.log('note: local private lists present, so the empty-setup checks are skipped (they run in CI)');

    const plAnon = await fetch(`${base}/privacy-lists`);
    check('unauthenticated GET /api/privacy-lists → denied (401/403)', [401, 403].includes(plAnon.status), String(plAnon.status));
    const plPreview = await fetch(`${base}/privacy-lists`, { headers: { Authorization: `Bearer ${ptoken}` } });
    check('site-preview: GET /api/privacy-lists → denied (403)', plPreview.status === 403, String(plPreview.status));
    const plPut = await fetch(`${base}/privacy-lists`, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { denyPatterns: [] } }) });
    check('site-build: PUT /api/privacy-lists has no route (404/405)', [404, 405].includes(plPut.status), String(plPut.status));

    const pl = app.documents(PRIVACY_LISTS_UID as any);
    const plDoc: any = await pl.findFirst({} as any);
    const write = (data: Record<string, unknown>) =>
      plDoc ? pl.update({ documentId: plDoc.documentId, data } as any) : pl.create({ data } as any);
    let invalidMsg = '';
    try {
      await write({ denyPatterns: ['zz(unclosed'] });
    } catch (e) {
      invalidMsg = (e as Error).message;
    }
    check('an invalid pattern is refused, naming the item but not the text', /denyPatterns item 1 is not a valid regular expression/.test(invalidMsg) && !invalidMsg.includes('zz(unclosed'), invalidMsg.slice(0, 120));
    await write({
      denyPatterns: ['zz[ _-]?db[ _-]?canary'], ipDenyTerms: ['zz[ _-]?db[ _-]?ip'], retiredBrandTerms: ['zz[ _-]?db[ _-]?retired'],
      neverSeed: ['zz/db/never'], testSamples: { deny: ['zz db canary'] },
    });
    const dbHit = await mods.create({ data: { name: 'ZZ db canary mod', slug: 'zz-db-canary-mod', tagline: 'x', modStatus: 'wip', visibility: 'public' } as any });
    let dbRejected = false;
    try {
      await mods.publish({ documentId: dbHit.documentId });
    } catch {
      dbRejected = true;
    }
    check('saving the entry reloads the guard: a term just saved blocks publishing at once', dbRejected);
    const plBuild = await fetch(`${base}/privacy-lists`, { headers: h });
    const plBody: any = plBuild.ok ? await plBuild.json() : null;
    const plKeys = Object.keys(plBody?.data ?? {}).sort().join(',');
    check('site-build: GET /api/privacy-lists → 200 with the three build lists only',
      plBuild.status === 200 && plKeys === 'denyPatterns,ipDenyTerms,retiredBrandTerms' && plBody.data.denyPatterns.includes('zz[ _-]?db[ _-]?canary'),
      `${plBuild.status} ${plKeys}`);
  } finally {
    await app.destroy();
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(path.join(CMS_ROOT, f), { force: true });
  }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  (${r.detail})`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} acceptance check(s) failed` : `\nM1 acceptance: all ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
