/**
 * Upload images and videos to the Strapi media library from the command line (Strapi's MCP server cannot upload).
 *
 *   npm run media:upload -- shot.png --alt "Server racks in the cold aisle" [--caption "..."] [--name "..."]
 *     [--folder "Blog/Server rack post" [--create-folder]] [--dry-run]
 *
 * Every file is checked before anything is sent: image/video only, 20 MB unless --force, a neutral public file name
 * (from --name or the alt text), and the privacy deny lists against the file name, alt text, caption and folder. JPEG
 * and PNG metadata (EXIF, GPS, XMP, text chunks) is removed. Prints one JSON line per uploaded file on stdout; notes go
 * to stderr.
 * Env: STRAPI_URL (default https://cms.rioku.dev); STRAPI_ADMIN_TOKEN (admin token, Media Library permissions only:
 * uploads through the admin route POST /upload and supports --folder), else STRAPI_UPLOAD_TOKEN (Content API token:
 * POST /api/upload, always into "API Uploads"). All three are also read from cms/.env. Tokens are never printed.
 * See scripts/README-media-upload.md.
 */
import path from 'node:path';
import {
  checkUrl,
  expandFiles,
  loadTerms,
  parseArgs,
  planFile,
  readEnv,
  resolveFolder,
  selectRoute,
  uploadOne,
  UsageError,
  USAGE,
  type ResolvedFolder,
} from './lib/media-upload';

const CMS = path.resolve(__dirname, '..');

/** Rotate a JPEG by its EXIF orientation with sharp (shipped with @strapi/upload). Output carries no metadata. */
async function loadRotate(): Promise<((buf: Buffer) => Promise<Buffer>) | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    return (buf: Buffer) => sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch {
    return undefined;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const files = expandFiles(opts.files);
  const env = readEnv(CMS);
  const base = checkUrl(env.url);
  const route = selectRoute(env, opts);
  console.error(
    route.kind === 'admin'
      ? 'media-upload: using STRAPI_ADMIN_TOKEN (admin route POST /upload)'
      : `media-upload: using ${route.token ? 'STRAPI_UPLOAD_TOKEN' : 'no token'} (Content API POST /api/upload; files land in "API Uploads")`,
  );

  const { terms, hasPrivate } = loadTerms(CMS);
  if (!hasPrivate) console.error('media-upload: note: private lists absent (config/privacy.local.json); only the public canaries are checked');
  const rotate = await loadRotate();

  // Check every file first: one refusal stops the whole batch before anything is sent.
  const planned = [];
  const errors: string[] = [];
  for (const [i, f] of files.entries()) {
    try {
      planned.push(await planFile(f, opts, terms, { n: i + 1, of: files.length }, rotate));
    } catch (e) {
      errors.push(`${path.basename(f)}: ${(e as Error).message}`);
    }
  }
  if (errors.length) {
    console.error(`media-upload: refused, nothing uploaded:\n - ${errors.join('\n - ')}`);
    return 1;
  }

  // Folder: look it up (read only), create the missing parts only with --create-folder; a dry run never creates.
  let folder: ResolvedFolder | undefined;
  if (opts.folder !== undefined) {
    folder = await resolveFolder(base, route.token!, opts.folder, { create: opts.createFolder, dryRun: opts.dryRun });
    for (const c of folder.created) console.error(`media-upload: created folder "${c}"`);
    for (const c of folder.wouldCreate) console.error(`media-upload: would create folder "${c}"`);
  }
  const folderOut = folder ? { folder: folder.path, ...(folder.id !== undefined ? { folderId: folder.id } : {}) } : {};

  for (const p of planned) {
    for (const n of p.notes) console.error(`media-upload: ${path.basename(p.source)}: ${n}`);
    if (opts.dryRun) {
      console.log(JSON.stringify({ dryRun: true, target: base, route: route.kind, source: p.source, name: p.name, mime: p.mime, size: p.bytes, ...folderOut }));
      continue;
    }
    const up = await uploadOne(
      base,
      route.token!,
      p,
      { alternativeText: opts.alt ?? '', caption: opts.caption, ...(folder?.id !== undefined ? { folder: folder.id } : {}) },
      fetch,
      route.kind,
    );
    console.log(JSON.stringify({ id: up.id, documentId: up.documentId, url: up.url, name: up.name, mime: up.mime, size: up.size, ...folderOut }));
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`media-upload: ${(e as Error).message}`);
    if (e instanceof UsageError) console.error(`\n${USAGE}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  },
);
