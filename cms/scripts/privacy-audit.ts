/**
 * Privacy audit (CONTENT-MODEL §6.3). Boots Strapi against the configured database and:
 * 1. scans every row of every api:: content type and every component table, and every Media Library file
 *    (name, alt, caption, folder, url), for privacy deny patterns and IP deny terms;
 * 2. lists every entry whose visibility isn't public (for the user's review), and what is published.
 * Exit code 1 on any deny/IP hit. Run: npm run privacy-audit [-- --json]
 */
import { bootStrapi } from './lib/boot';
import { compilePatterns, loadPrivacyConfig, loadPrivacyLocal, scanDeep } from '../src/utils/privacy';

async function main() {
  const app = await bootStrapi();
  if (!loadPrivacyLocal(app.dirs.app.root)) console.warn('privacy-audit: WARNING: private lists absent (config/privacy.local.json / PRIVACY_LOCAL_JSON); checking the public canaries only');
  const cfg = loadPrivacyConfig(app.dirs.app.root);
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

  const apiUids = Object.keys(app.contentTypes).filter((u) => u.startsWith('api::'));
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
