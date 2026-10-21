/** Boot Strapi in-process for CLI scripts (seed, audit, tokens, acceptance). Run from cms/. */
import path from 'node:path';
import { compileStrapi, createStrapi } from '@strapi/strapi';
import type { Core } from '@strapi/strapi';

export const CMS_ROOT = path.resolve(__dirname, '..', '..');

export async function bootStrapi(opts: { listen?: boolean } = {}): Promise<Core.Strapi> {
  process.chdir(CMS_ROOT);
  const appContext = await compileStrapi();
  const app = createStrapi({ ...appContext, autoReload: false } as any);
  app.log.level = process.env.LOG_LEVEL ?? 'warn';
  if (opts.listen) await app.start();
  else await app.load();
  return app;
}
