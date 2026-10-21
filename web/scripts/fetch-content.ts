/**
 * Prebuild step: load content (fixtures or Strapi), run the visibility filter and the build assertion, normalise,
 * and sync ONLY the media referenced by visible content into the build:
 *   images → src/assets/cms/<key>   (Astro <Picture> makes AVIF/WebP/JPEG sets)
 *   videos → public/media/<key>     (copied as-is)
 * Writes .cache/site.json, which the pages read (src/lib/site.ts). Fails the build on any privacy/IP problem, and
 * (CMS builds) when site-settings, navigation or home-page is missing or unpublished.
 * CMS media downloads: 30 s timeout, 3 retries with backoff; the download cache keeps only what this build used.
 *
 *   SITE_DATA=fixtures (default) | strapi      STRAPI_URL, STRAPI_BUILD_TOKEN for strapi
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchStrapi, mediaUrl } from '../src/lib/strapi';
import { assertCoreContent, assertPublicOnly, filterVisible, MissingContentError, normalise } from '../src/lib/load';
import { downloadMedia, MediaDownloadError, pruneDir } from '../src/lib/media-sync';
import { loadPrivacyLists, loadPrivacyLocal, PrivacyAssertionError } from '../src/lib/privacy';
import { resolveInside, UnsafeContentError } from '../src/lib/safety';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(WEB, '.env'));
} catch {
  /* no .env: defaults */
}
const MODE = (process.env.SITE_DATA ?? 'fixtures') as 'fixtures' | 'strapi';
const SEED_MEDIA = path.resolve(WEB, '..', 'cms', 'seed', 'media');
const IMG_DIR = path.join(WEB, 'src', 'assets', 'cms');
const VID_DIR = path.join(WEB, 'public', 'media');
const DL_CACHE = path.join(WEB, 'node_modules', '.cache', 'site-media');

async function loadRaw(): Promise<Record<string, any>> {
  // The draft-preview Worker reads drafts per request (src/middleware.ts); its build bakes in NO content at all.
  if (process.env.SITE_MODE === 'preview') return {};
  if (MODE === 'fixtures') return JSON.parse(fs.readFileSync(path.join(WEB, 'fixtures', 'content.json'), 'utf8'));
  const url = process.env.STRAPI_URL;
  // Only the read-only build token: the static build never uses the preview token or asks for drafts.
  const token = process.env.STRAPI_BUILD_TOKEN;
  if (!url || !token) throw new Error('SITE_DATA=strapi needs STRAPI_URL and STRAPI_BUILD_TOKEN (web/.env; `npm run tokens` in cms/ writes it locally)');
  return fetchStrapi({ url, token });
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)));
}

async function materialise(m: ReturnType<typeof normalise>['media'][number], dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (m.from.kind === 'seed') {
    if (MODE !== 'fixtures') throw new UnsafeContentError('seed media outside fixtures mode');
    const src = resolveInside(SEED_MEDIA, m.from.rel);
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) fs.copyFileSync(src, dest);
    return;
  }
  const cached = resolveInside(DL_CACHE, m.key);
  if (!fs.existsSync(cached)) {
    const body = await downloadMedia(mediaUrl(process.env.STRAPI_URL!, m.from.url), { label: m.key });
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    // Write then rename, so an interrupted run never leaves a truncated file that later runs would trust.
    const tmp = `${cached}.part`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, cached);
  }
  if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(cached).size) fs.copyFileSync(cached, dest);
}

async function main() {
  const t0 = Date.now();
  // Fail closed: real CMS content is only checked against the real deny lists, never the public canaries alone.
  if (MODE === 'strapi' && process.env.SITE_MODE !== 'preview' && !loadPrivacyLocal()) {
    console.error('fetch-content: SITE_DATA=strapi needs the private deny lists (cms/config/privacy.local.json or PRIVACY_LOCAL_JSON).');
    process.exit(1);
  }
  const raw = await loadRaw();
  if (MODE === 'strapi' && process.env.SITE_MODE !== 'preview') {
    try {
      assertCoreContent(raw);
    } catch (e) {
      if (e instanceof MissingContentError) {
        console.error(`fetch-content: ${e.message}`);
        process.exit(1);
      }
      throw e;
    }
  }
  const filtered = filterVisible(raw);
  try {
    assertPublicOnly(filtered, loadPrivacyLists());
  } catch (e) {
    if (e instanceof PrivacyAssertionError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  let normalised;
  try {
    normalised = normalise(filtered, MODE);
  } catch (e) {
    if (e instanceof UnsafeContentError) {
      console.error(`fetch-content: unsafe content, build stopped: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  const { site, media } = normalised;

  const wantImg = new Set<string>();
  const wantVid = new Set<string>();
  for (const m of media) {
    const isVideo = m.mime.startsWith('video/');
    (isVideo ? wantVid : wantImg).add(m.key);
    try {
      await materialise(m, resolveInside(isVideo ? VID_DIR : IMG_DIR, m.key));
    } catch (e) {
      if (e instanceof MediaDownloadError) {
        console.error(`fetch-content: ${e.message}`);
        process.exit(1);
      }
      throw e;
    }
  }
  // Every file synced: drop download-cache files this build no longer references, so a cached CI directory does not
  // grow forever. pruneDir only touches safe media keys resolved inside DL_CACHE.
  const cachePruned = MODE === 'strapi' ? pruneDir(DL_CACHE, new Set(media.filter((m) => m.from.kind === 'url').map((m) => m.key))) : 0;
  // Remove stale media (e.g. an entry made private since the last build): only files inside our two media dirs.
  let removed = 0;
  for (const [dir, want] of [[IMG_DIR, wantImg], [VID_DIR, wantVid]] as const) {
    for (const rel of listFiles(dir)) {
      if (!want.has(rel)) {
        fs.unlinkSync(path.join(dir, rel));
        removed++;
      }
    }
  }
  fs.mkdirSync(path.join(WEB, '.cache'), { recursive: true });
  fs.writeFileSync(path.join(WEB, '.cache', 'site.json'), JSON.stringify(site));
  const hidden = ['mods', 'blogPosts', 'timelineFamilies', 'milestones'].map((k) => `${k} ${raw[k]?.length ?? 0}→${filtered[k].length}`).join(', ');
  console.log(`fetch-content [${MODE}]: ${site.mods.length} mods, ${site.posts.length} posts, ${site.families.length} families; ` +
    `${wantImg.size} images, ${wantVid.size} videos (${removed} stale removed, ${cachePruned} pruned from the download cache); filtered ${hidden}; ${Date.now() - t0} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
