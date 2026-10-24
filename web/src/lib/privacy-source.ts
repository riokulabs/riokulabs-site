/**
 * Where the build's private lists come from (Node-only, build scripts only):
 * - a Strapi build (SITE_DATA=strapi, not the preview build) reads the CMS "Privacy lists" entry from
 *   GET /api/privacy-lists with STRAPI_BUILD_TOKEN (the site-build token needs find on Privacy-lists);
 * - otherwise, or while that entry is empty, cms/config/privacy.local.json, then PRIVACY_LOCAL_JSON (local builds);
 * - fixtures/CI builds without either use the public canaries alone (cms/config/privacy.json).
 * The lists stay in memory: nothing here writes them to disk or prints them.
 */
import { fetchWithRetry } from './strapi';
import { compilePrivacyLists, privacyFile, privacyLocalFile, readPrivacyLocalEnv, readPrivacyLocalFile, type PrivacyLists } from './privacy';

export type PrivacySource = 'strapi' | 'file' | 'env' | 'none';

const LIST_KEYS = ['denyPatterns', 'ipDenyTerms', 'retiredBrandTerms'] as const;

export class PrivacyListsAccessError extends Error {}

/**
 * The CMS entry's lists, or null when the entry is empty or the CMS has no such type yet (404). A token without
 * access (401/403) is an error: a Strapi build must not silently fall back.
 */
export async function fetchPrivacyLocal(opts: { url: string; token: string; fetchImpl?: typeof fetch; retries?: number; baseDelayMs?: number }): Promise<Record<string, string[]> | null> {
  const base = opts.url.replace(/\/+$/, '');
  const res = await fetchWithRetry(`${base}/api/privacy-lists`, { headers: { Authorization: `Bearer ${opts.token}` } }, {
    retries: opts.retries ?? 4, baseDelayMs: opts.baseDelayMs ?? 1500, fetchImpl: opts.fetchImpl ?? fetch,
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new PrivacyListsAccessError(`the build token cannot read the Privacy lists (HTTP ${res.status}): give the site-build API token the find permission on Privacy-lists`);
  }
  if (!res.ok) throw new Error(`GET /api/privacy-lists failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Record<string, unknown> | null };
  const d = body?.data;
  if (!d || typeof d !== 'object') return null;
  const out: Record<string, string[]> = {};
  for (const k of LIST_KEYS) {
    const v = d[k];
    if (v !== undefined && v !== null && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) throw new Error(`GET /api/privacy-lists: ${k} is not a list of strings`);
    out[k] = (v as string[] | undefined) ?? [];
  }
  return LIST_KEYS.some((k) => out[k].length) ? out : null;
}

/** True when this process builds the static site from Strapi (not fixtures, not the preview Worker). */
export const isStrapiBuild = (env: NodeJS.ProcessEnv = process.env) => env.SITE_DATA === 'strapi' && env.SITE_MODE !== 'preview';

/** Strapi (Strapi builds only) → local file → PRIVACY_LOCAL_JSON → none. */
export async function resolvePrivacyLocal(opts: { env?: NodeJS.ProcessEnv; localFile?: string; fetchImpl?: typeof fetch; retries?: number; baseDelayMs?: number } = {}): Promise<{ source: PrivacySource; local: Record<string, unknown> | null }> {
  const env = opts.env ?? process.env;
  if (isStrapiBuild(env) && env.STRAPI_URL && env.STRAPI_BUILD_TOKEN) {
    const local = await fetchPrivacyLocal({ url: env.STRAPI_URL, token: env.STRAPI_BUILD_TOKEN, fetchImpl: opts.fetchImpl, retries: opts.retries, baseDelayMs: opts.baseDelayMs });
    if (local) return { source: 'strapi', local };
  }
  const fromFile = readPrivacyLocalFile(opts.localFile ?? privacyLocalFile());
  if (fromFile) return { source: 'file', local: fromFile };
  const fromEnv = readPrivacyLocalEnv(env);
  return fromEnv ? { source: 'env', local: fromEnv } : { source: 'none', local: null };
}

/** The compiled lists for the build plus where the private half came from. */
export async function resolvePrivacyLists(opts: Parameters<typeof resolvePrivacyLocal>[0] & { file?: string } = {}): Promise<{ source: PrivacySource; lists: PrivacyLists }> {
  const { source, local } = await resolvePrivacyLocal(opts);
  return { source, lists: compilePrivacyLists(local, opts.file ?? privacyFile()) };
}
