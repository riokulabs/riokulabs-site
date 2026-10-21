/**
 * End-to-end draft test (round 3): proves drafts never reach the static build or its feeds, and that the
 * draft-preview Worker does show them, behind its secret + cookie.
 *
 * Against a THROWAWAY copy of the local database on port 1339 (the real local DB and web/.env are untouched):
 *  1. creates: a public post that was never published ("Draft canary post"), and a published public post whose
 *     newer draft edit says "DRAFT EDIT canary"; approves the Data Center so the build has content;
 *  2. creates site-build + site-preview tokens in that copy (kept in memory, never written to disk);
 *  3. runs the STATIC build (SITE_DATA=strapi) and checks dist/ (HTML, rss.xml, sitemap, every text file) has no
 *     draft text while the published text is there;
 *  4. builds the preview Worker and runs it locally with `wrangler dev` (secrets passed as --var, not stored), then
 *     checks: no cookie → 401; forged, tampered, expired or raw-secret link → 401; a link signed like the admin signs
 *     it (src/utils/preview-link.ts) → 302 + Partitioned cookie; with the cookie the never-published post and the
 *     draft edit render with the PREVIEW banner and noindex; feeds are not served there.
 *  5. rebuilds the normal fixtures site so dist/ is back to its usual state.
 * Run from cms/: npm run test:drafts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const DB = '.tmp/drafts-test.db';
process.env.DATABASE_CLIENT = 'sqlite';
process.env.DATABASE_FILENAME = DB;
process.env.PORT = '1339';
process.env.HOST = '127.0.0.1';

import { bootStrapi, CMS_ROOT } from './lib/boot';
import { ensureReadToken } from './lib/tokens';
import { previewLink, signPreviewPath } from '../src/utils/preview-link';

const WEB = path.resolve(CMS_ROOT, '..', 'web');
const STRAPI = 'http://127.0.0.1:1339';
const PREVIEW = 'http://127.0.0.1:8788';
const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

/** Async on purpose: Strapi runs in THIS process, so a blocking spawnSync would starve it and deadlock the build. */
function run(cmd: string, args: string[], env: Record<string, string>, cwd = WEB): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed (${code}):\n${out.slice(-3000)}`))));
  });
}

function grepDist(dir: string, needles: string[]): string[] {
  const hits: string[] = [];
  for (const d of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!d.isFile() || !/\.(html|xml|json|txt|js|css)$/.test(d.name)) continue;
    const f = path.join(d.parentPath, d.name);
    const text = fs.readFileSync(f, 'utf8');
    for (const n of needles) if (text.includes(n)) hits.push(`${path.relative(dir, f)}: ${n}`);
  }
  return hits;
}

async function waitFor(url: string, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url, { redirect: 'manual' }); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function main() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(path.join(CMS_ROOT, f), { force: true });
  fs.copyFileSync(path.join(CMS_ROOT, '.tmp', 'data.db'), path.join(CMS_ROOT, DB));
  const app = await bootStrapi({ listen: true });
  let wrangler: ReturnType<typeof spawn> | null = null;
  try {
    // 1. content in the throwaway copy
    const mods = app.documents('api::mod.mod');
    const dc: any = await mods.findFirst({ filters: { slug: 'data-center' }, status: 'draft' } as any);
    await mods.update({ documentId: dc.documentId, data: { visibility: 'public' } } as any);
    await mods.publish({ documentId: dc.documentId } as any);
    const games = app.documents('api::game.game');
    const se2: any = await games.findFirst({ filters: { slug: 'space-engineers-2' }, status: 'draft' } as any);
    await games.update({ documentId: se2.documentId, data: { visibility: 'public' } } as any);
    // A private draft idea card of our own (the real idea cards are private seed entries and may be absent).
    await mods.create({ data: { name: 'Draft canary idea', slug: 'draft-canary-idea', tagline: 'x', modStatus: 'idea', visibility: 'private', game: se2.documentId } as any });
    await games.publish({ documentId: se2.documentId } as any);
    const posts = app.documents('api::blog-post.blog-post');
    const body = [{ __component: 'sections.rich-text', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body text of a test post.' }] }] }];
    await posts.create({ data: { title: 'Draft canary post', slug: 'draft-canary-post', excerpt: 'Never published: must only ever show on the preview host.', date: '2026-10-20', visibility: 'public', body } as any });
    const pub: any = await posts.create({ data: { title: 'Published canary', slug: 'published-canary', excerpt: 'The published excerpt of the published canary.', date: '2026-10-20', visibility: 'public', body } as any });
    await posts.publish({ documentId: pub.documentId } as any);
    await posts.update({ documentId: pub.documentId, data: { excerpt: 'DRAFT EDIT canary: unpublished change.' } } as any);

    // 2. tokens (memory only)
    const buildToken = await ensureReadToken(app, 'site-build', 'drafts test');
    const previewToken = await ensureReadToken(app, 'site-preview', 'drafts test');
    const secret = crypto.randomBytes(32).toString('hex');

    // 3. the static build against this CMS
    await run('npm', ['run', 'build'], { SITE_DATA: 'strapi', STRAPI_URL: STRAPI, STRAPI_BUILD_TOKEN: buildToken, STRAPI_PREVIEW_TOKEN: '' });
    const dist = path.join(WEB, 'dist');
    const draftHits = grepDist(dist, ['Draft canary post', 'draft-canary-post', 'DRAFT EDIT canary']);
    check('static build: no never-published post and no unpublished edit anywhere in dist/', draftHits.length === 0, draftHits.join('; '));
    const rss = fs.readFileSync(path.join(dist, 'rss.xml'), 'utf8');
    check('static build: rss.xml has the published post with its PUBLISHED excerpt', rss.includes('Published canary') && rss.includes('The published excerpt') && !rss.includes('DRAFT EDIT'), rss.slice(0, 200));
    const sitemap = fs.readFileSync(path.join(dist, 'sitemap-0.xml'), 'utf8');
    check('static build: sitemap lists the published post, not the draft', sitemap.includes('/blog/published-canary') && !sitemap.includes('draft-canary'));
    check('static build: the Data Center is built under its game, and its old URL redirects there',
      fs.existsSync(path.join(dist, 'games', 'space-engineers-2', 'mods', 'data-center.html')) && fs.existsSync(path.join(dist, 'games', 'space-engineers-2.html')) &&
      fs.readFileSync(path.join(dist, '_redirects'), 'utf8').includes('/mods/data-center /games/space-engineers-2/mods/data-center 301'));
    check('static build: no /preview route in dist/', !fs.existsSync(path.join(dist, 'preview.html')) && !fs.existsSync(path.join(dist, 'preview')));

    // 4. the preview Worker, locally
    await run('npm', ['run', 'build:preview'], {});
    const vars = { STRAPI_URL: STRAPI, STRAPI_PREVIEW_TOKEN: previewToken, PREVIEW_SECRET: secret, STRAPI_ADMIN_ORIGIN: STRAPI };
    wrangler = spawn('npx', ['wrangler', 'dev', '--config', 'dist-preview/server/wrangler.json', '--port', '8788', '--ip', '127.0.0.1',
      ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])],
      // detached = its own process group, so the whole npx → wrangler → workerd tree can be stopped (a bare SIGINT to npx
      // left `wrangler dev` running on port 8788 after earlier runs)
      { cwd: WEB, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '';
    wrangler.stdout!.on('data', (d) => { log += d; });
    wrangler.stderr!.on('data', (d) => { log += d; });
    await waitFor(`${PREVIEW}/`, 120_000).catch((e) => { throw new Error(`${e.message}\n${log.slice(-2000)}`); });

    const noCookie = await fetch(`${PREVIEW}/blog/draft-canary-post`, { redirect: 'manual' });
    check('preview: without the cookie → 401', noCookie.status === 401, String(noCookie.status));
    const draftPath = '/blog/draft-canary-post';
    const nowS = Math.floor(Date.now() / 1000);
    const linkFor = (p: string, exp: number, key = secret) => `${PREVIEW}/preview?${new URLSearchParams({ path: p, exp: String(exp), sig: signPreviewPath(key, p, exp) })}`;
    const refused = async (name: string, url: string) => {
      const r = await fetch(url, { redirect: 'manual' });
      check(name, r.status === 401 && !r.headers.get('set-cookie') && /noindex/.test(r.headers.get('x-robots-tag') ?? ''), String(r.status));
    };
    await refused('preview: link signed with another secret → 401, no cookie', linkFor(draftPath, nowS + 600, 'x'.repeat(64)));
    await refused('preview: tampered path → 401, no cookie', linkFor(draftPath, nowS + 600).replace('draft-canary-post', 'published-canary'));
    await refused('preview: expired link → 401, no cookie', linkFor(draftPath, nowS - 1));
    await refused('preview: the old raw-secret link → 401, no cookie', `${PREVIEW}/preview?secret=${secret}&path=${draftPath}&status=draft`);
    const evil = await fetch(linkFor('//evil.example', nowS + 600), { redirect: 'manual' });
    check('preview: off-site redirect path refused (400)', evil.status === 400, String(evil.status));
    // Exactly what "Open preview" in the admin returns (config/admin.ts → previewLink)
    const ok = await fetch(previewLink(PREVIEW, secret, draftPath)!, { redirect: 'manual' });
    const setCookie = ok.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(';')[0];
    check('preview: signed link → 302 to the path + Secure; HttpOnly; SameSite=None; Partitioned cookie',
      ok.status === 302 && ok.headers.get('location') === draftPath && ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned'].every((a) => new RegExp(a, 'i').test(setCookie)),
      `${ok.status} ${ok.headers.get('location')} ${setCookie}`);
    const draftPage = await fetch(`${PREVIEW}/blog/draft-canary-post`, { headers: { cookie } });
    const draftHtml = await draftPage.text();
    check('preview: the never-published post renders, with the PREVIEW banner', draftPage.status === 200 && draftHtml.includes('Draft canary post') && draftHtml.includes('PREVIEW'), `${draftPage.status} ${draftHtml.slice(0, 200)}`);
    check('preview: responses are noindex + no-store + framed only by the CMS origin',
      /noindex/.test(draftPage.headers.get('x-robots-tag') ?? '') && draftPage.headers.get('cache-control') === 'no-store' && (draftPage.headers.get('content-security-policy') ?? '').includes(STRAPI),
      JSON.stringify(Object.fromEntries(draftPage.headers)));
    const editPage = await (await fetch(`${PREVIEW}/blog/published-canary`, { headers: { cookie } })).text();
    check('preview: shows the unpublished edit of a published post', editPage.includes('DRAFT EDIT canary'));
    const legacy = await fetch(`${PREVIEW}/mods/draft-canary-idea`, { headers: { cookie }, redirect: 'manual' });
    check('preview: an old flat mod URL redirects to the game URL', legacy.status === 302 && legacy.headers.get('location') === '/games/space-engineers-2/mods/draft-canary-idea',
      `${legacy.status} ${legacy.headers.get('location')}`);
    const privateIdea = await fetch(`${PREVIEW}/games/space-engineers-2/mods/draft-canary-idea`, { headers: { cookie } });
    const privateHtml = await privateIdea.text();
    check('preview: a private draft mod renders with the red "not public" banner', privateIdea.status === 200 && /visibility: private · not public/.test(privateHtml), String(privateIdea.status));
    const feed = await fetch(`${PREVIEW}/rss.xml`, { headers: { cookie } });
    check('preview: feeds are not served from the preview host', feed.status === 404, String(feed.status));
    const robots = await (await fetch(`${PREVIEW}/robots.txt`)).text();
    check('preview: robots.txt disallows everything', /Disallow: \//.test(robots));
  } finally {
    if (wrangler?.pid) {
      try { process.kill(-wrangler.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    await app.destroy();
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(path.join(CMS_ROOT, f), { force: true });
  }
  // 5. back to the usual fixtures dist/
  await run('npm', ['run', 'build'], { SITE_DATA: 'fixtures' });
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  (${r.detail})`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} draft check(s) failed` : `\ndrafts: all ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
