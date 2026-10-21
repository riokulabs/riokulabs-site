// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile('.env');
} catch {
  /* optional */
}

/** The canonical origin: https://<identity domain> (src/config/identity.json) unless SITE_URL overrides it. */
const IDENTITY = JSON.parse(fs.readFileSync(new URL('./src/config/identity.json', import.meta.url), 'utf8'));
const SITE_URL = process.env.SITE_URL || `https://${IDENTITY.domain}`;
/** SITE_MODE=preview builds the draft-preview Worker (ARCHITECTURE §6); anything else is the static production site. */
const PREVIEW = process.env.SITE_MODE === 'preview';

/** Unlisted pages are built (reachable by URL) but never listed: keep them out of the sitemap (CONTENT-MODEL §5). */
function unlistedPaths() {
  try {
    const site = JSON.parse(fs.readFileSync('.cache/site.json', 'utf8'));
    return new Set([
      ...site.mods.filter((/** @type {any} */ m) => m.visibility !== 'public').flatMap((/** @type {any} */ m) => [`/games/${m.game}/mods/${m.slug}`, `/games/${m.game}/mods/${m.slug}/history`]),
      ...site.games.filter((/** @type {any} */ g) => g.visibility !== 'public').map((/** @type {any} */ g) => `/games/${g.slug}`),
      ...site.posts.filter((/** @type {any} */ p) => p.visibility !== 'public').map((/** @type {any} */ p) => `/blog/${p.slug}`),
    ]);
  } catch {
    return new Set();
  }
}
const unlisted = unlistedPaths();

/** In the preview Worker, routes that need Node at build (feeds, OG cards, control files) stay prerendered (and the
 *  middleware refuses to serve them); every page is rendered on demand with draft data. */
// (the [file] control files are NOT prerendered there: the static site's _headers would otherwise forbid framing)
const PRERENDER_IN_PREVIEW = /(og\/\[\.\.\.slug\]\.png|rss\.xml|releases\.xml|robots\.txt|site\.webmanifest)\.ts$/;
/** @type {import('astro').AstroIntegration} */
const previewRoutes = {
  name: 'site-preview-routes',
  hooks: {
    'astro:route:setup': ({ route }) => {
      if (!PREVIEW) return;
      route.prerender = PRERENDER_IN_PREVIEW.test(route.component);
    },
  },
};

const integrations = [previewRoutes];
if (!PREVIEW) {
  integrations.push(
    sitemap({
      filter: (page) => {
        const p = new URL(page).pathname.replace(/\/$/, '') || '/';
        return !unlisted.has(p) && p !== '/404';
      },
    }),
  );
}

const adapter = PREVIEW ? (await import('@astrojs/cloudflare')).default({ prerenderEnvironment: 'node', imageService: 'passthrough', configPath: 'wrangler.preview.jsonc' }) : undefined;

export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'never',
  output: PREVIEW ? 'server' : 'static',
  adapter,
  outDir: PREVIEW ? './dist-preview' : './dist',
  build: { format: 'file', inlineStylesheets: 'always' }, // no render-blocking CSS requests (~10 KB gz per page)
  compressHTML: true,
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  image: { responsiveStyles: false },
  integrations,
  vite: {
    build: { assetsInlineLimit: 2048 },
    define: { __SITE_PREVIEW__: JSON.stringify(PREVIEW) },
    resolve: {
      alias: {
        '#site-env': fileURLToPath(new URL(PREVIEW ? './src/lib/env.worker.ts' : './src/lib/env.static.ts', import.meta.url)),
      },
    },
  },
});
