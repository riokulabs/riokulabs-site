/**
 * Privacy audit (CONTENT-MODEL §6.3). Boots Strapi against the configured database and:
 * 1. scans every row of every api:: content type and every component table, and every Media Library file
 *    (name, alt, caption, folder, url), for privacy deny patterns and IP deny terms;
 * 2. lists every entry whose visibility isn't public (for the user's review), and what is published.
 * Exit code 1 on any deny/IP hit. Run: npm run privacy-audit [-- --json]
 *
 * Lists: the booted CMS's own (its Privacy lists entry, else config/privacy.local.json, else PRIVACY_LOCAL_JSON); when
 * all three are empty, the Privacy lists of the Strapi at STRAPI_URL read with STRAPI_ADMIN_TOKEN (cms/.env); else the
 * public canaries only, with a warning. The Privacy lists entry itself is never scanned (it holds every term).
 */
import { bootStrapi } from './lib/boot';
import { loadLocalOrRemote } from './lib/privacy-remote';
import { compilePatterns, loadPublicPrivacy, scanDeep, withPrivateLists } from '../src/utils/privacy';
import { PRIVACY_LISTS_UID, summarize } from '../src/utils/privacy-lists';
import { refreshPrivacy } from '../src/privacy-runtime';

async function main() {
  const app = await bootStrapi();
  const state = await refreshPrivacy(app);
  let cfg = state.config;
  let source: string = state.source;
  let local = state.local;
  if (state.source === 'none') {
    const remote = await loadLocalOrRemote(app.dirs.app.root);
    if (remote.local) {
      cfg = withPrivateLists(loadPublicPrivacy(app.dirs.app.root), remote.local);
      source = remote.source;
      local = remote.local;
    } else console.warn(`privacy-audit: WARNING: private lists absent (Privacy lists entry, config/privacy.local.json, PRIVACY_LOCAL_JSON${remote.note ? `; ${remote.note}` : ''}); checking the public canaries only`);
  }
  if (source !== 'none') console.error(`privacy-audit: private lists from ${source} (${summarize(local)})`);
  const deny = compilePatterns(cfg.denyPatterns, 'i');
  const ip = compilePatterns(cfg.ipDenyTerms, 'i');
  const retired = compilePatterns(cfg.retiredBrandTerms ?? [], 'i');
  const hits: string[] = [];
  const nonPublic: string[] = [];
  const published: string[] = [];

  const scan = (where: string, value: unknown) => {
    for (const h of scanDeep(value, deny)) hits.push(`PRIVACY ${where} ${h.path} /${h.pattern}/ "${h.text}"`);
    for (const h of scanDeep(value, ip)) hits.push(`IP      ${where} ${h.path} /${h.pattern}/ "${h.text}"`);
    for (const h of scanDeep(value, retired)) hits.push(`BRAND   ${where} ${h.path} /${h.pattern}/ "${h.text}"`);
  };

  const apiUids = Object.keys(app.contentTypes).filter((u) => u.startsWith('api::') && u !== PRIVACY_LISTS_UID);
  let rows = 0;
  for (const uid of apiUids) {
    const all = await app.db.query(uid as any).findMany({});
    for (const r of all as any[]) {
      rows++;
      const label = r.title ?? r.name ?? r.label ?? r.from ?? r.documentId;
      scan(`${uid}#${r.documentId}${r.publishedAt ? '(published)' : '(draft)'}`, r);
      if ('visibility' in r && !r.publishedAt && r.visibility !== 'public') nonPublic.push(`${uid.split('.')[1]}: "${label}" → ${r.visibility}`);
      if (r.publishedAt) published.push(`${uid.split('.')[1]}: "${label}" (${r.visibility ?? 'single type'})`);
    }
  }
  let compRows = 0;
  for (const uid of Object.keys(app.components)) {
    const all = await app.db.query(uid as any).findMany({});
    compRows += all.length;
    for (const r of all as any[]) scan(`component ${uid}#${r.id}`, r);
  }
  const files = await app.db.query('plugin::upload.file').findMany({});
  for (const f of files as any[]) {
    scan(`media #${f.id}`, { name: f.name, alt: f.alternativeText, caption: f.caption, folderPath: f.folderPath, url: f.url, hash: f.hash });
  }
  const folders = await app.db.query('plugin::upload.folder').findMany({});
  for (const f of folders as any[]) scan(`media-folder #${f.id}`, { name: f.name, path: f.path });

  const report = { rows, componentRows: compRows, media: files.length, hits, nonPublic, published };
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`privacy-audit: scanned ${rows} entry rows, ${compRows} component rows, ${files.length} media files, ${folders.length} folders`);
    console.log(`\nNot public (drafts, for review): ${nonPublic.length}`);
    nonPublic.forEach((l) => console.log('  - ' + l));
    console.log(`\nPublished rows: ${published.length}`);
    published.forEach((l) => console.log('  - ' + l));
    console.log(`\nDeny-pattern / IP hits: ${hits.length}`);
    hits.forEach((l) => console.log('  ! ' + l));
  }
  await app.destroy();
  process.exit(hits.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
