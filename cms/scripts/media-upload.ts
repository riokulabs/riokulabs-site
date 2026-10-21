/**
 * Upload images and videos to the Strapi media library from the command line (Strapi's MCP server cannot upload).
 *
 *   npm run media:upload -- shot.png --alt "Server racks in the cold aisle" [--caption "..."] [--name "..."] [--dry-run]
 *
 * Every file is checked before anything is sent: image/video only, 20 MB unless --force, a neutral public file name
 * (from --name or the alt text), and the privacy deny lists against the file name, alt text and caption. JPEG and PNG
 * metadata (EXIF, GPS, XMP, text chunks) is removed. Prints one JSON line per uploaded file on stdout; notes go to
 * stderr. Uploads land in the "API Uploads" folder (the Content API has no folder option).
 * Env: STRAPI_URL (default https://cms.rioku.dev), STRAPI_UPLOAD_TOKEN; both also read from cms/.env.
 * See scripts/README-media-upload.md.
 */
import path from 'node:path';
import { checkUrl, expandFiles, loadTerms, parseArgs, planFile, readEnv, uploadOne, UsageError, USAGE } from './lib/media-upload';

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
  const { url, token } = readEnv(CMS);
  const base = checkUrl(url);
  if (!opts.dryRun && !token) throw new UsageError('STRAPI_UPLOAD_TOKEN is not set (environment or cms/.env)');

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

  for (const p of planned) {
    for (const n of p.notes) console.error(`media-upload: ${path.basename(p.source)}: ${n}`);
    if (opts.dryRun) {
      console.log(JSON.stringify({ dryRun: true, target: base, source: p.source, name: p.name, mime: p.mime, size: p.bytes }));
      continue;
    }
    const up = await uploadOne(base, token!, p, { alternativeText: opts.alt ?? '', caption: opts.caption });
    console.log(JSON.stringify({ id: up.id, documentId: up.documentId, url: up.url, name: up.name, mime: up.mime, size: up.size }));
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
