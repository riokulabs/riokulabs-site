/**
 * Local-only helper: create (or rotate) the `site-build` and `site-preview` read-only API tokens in the LOCAL Strapi
 * and write them into web/.env (gitignored). Keys are never printed. On Strapi Cloud, create the tokens in the admin
 * (Settings → API Tokens) and paste them into the Cloudflare dashboard yourself (README "Tokens").
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootStrapi, CMS_ROOT } from './lib/boot';
import { ensureReadToken } from './lib/tokens';

function setEnv(file: string, key: string, value: string) {
  let s = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `${key}=${value}`;
  s = new RegExp(`^${key}=.*$`, 'm').test(s) ? s.replace(new RegExp(`^${key}=.*$`, 'm'), line) : s + (s.endsWith('\n') || !s ? '' : '\n') + line + '\n';
  fs.writeFileSync(file, s, { mode: 0o600 });
}

async function main() {
  const app = await bootStrapi();
  const build = await ensureReadToken(app, 'site-build', 'Production build: find/findOne on public types (visibility-guarded).');
  const preview = await ensureReadToken(app, 'site-preview', 'Preview site: drafts and private entries (shown with a banner).');
  await app.destroy();
  const envFile = path.resolve(CMS_ROOT, '..', 'web', '.env');
  if (!fs.existsSync(envFile)) fs.copyFileSync(path.resolve(CMS_ROOT, '..', 'web', '.env.example'), envFile);
  setEnv(envFile, 'STRAPI_BUILD_TOKEN', build);
  setEnv(envFile, 'STRAPI_PREVIEW_TOKEN', preview);
  console.log(`tokens: site-build and site-preview written to web/.env (not printed).`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
