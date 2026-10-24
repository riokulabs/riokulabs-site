/**
 * The private lists for local tools (check:public, privacy-audit, privacy:push): the local file, PRIVACY_LOCAL_JSON,
 * or the "Privacy lists" entry of a Strapi read through the admin Content Manager API with STRAPI_ADMIN_TOKEN
 * (STRAPI_URL; both from the environment or cms/.env, see admin-http.ts). Never prints a term.
 */
import { AdminClient, checkUrl, readEnv } from './admin-http';
import { readPrivacyLocalEnv, readPrivacyLocalFile } from '../../src/utils/privacy';
import { entryToLocal, hasPrivateLists, PRIVACY_LISTS_UID, type PrivacyLocal } from '../../src/utils/privacy-lists';

export const CM_PATH = `/content-manager/single-types/${PRIVACY_LISTS_UID}`;

export type LocalSource = 'file' | 'env' | 'strapi' | 'none';

/** The entry from the admin API as file-shaped lists, or null when it is empty or the type isn't deployed yet. */
export async function fetchPrivacyListsAdmin(client: AdminClient): Promise<PrivacyLocal | null> {
  try {
    const res: any = await client.get(CM_PATH);
    return entryToLocal(res?.data ?? null);
  } catch (e) {
    // A Strapi without the type (not deployed yet) answers 404: nothing to read there.
    if (/ failed: HTTP 404\b/.test((e as Error).message)) return null;
    throw e;
  }
}

/**
 * File → PRIVACY_LOCAL_JSON → Strapi (only when an admin token is configured). `note` explains a skipped remote read
 * (no token, or Strapi unreachable) without any list content.
 */
export async function loadLocalOrRemote(
  cmsRoot: string,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; remote?: boolean } = {},
): Promise<{ source: LocalSource; local: PrivacyLocal | null; note?: string }> {
  const env = opts.env ?? process.env;
  const file = readPrivacyLocalFile(cmsRoot);
  if (file && hasPrivateLists(file)) return { source: 'file', local: file };
  const fromEnv = readPrivacyLocalEnv(env);
  if (fromEnv && hasPrivateLists(fromEnv)) return { source: 'env', local: fromEnv };
  if (opts.remote === false) return { source: 'none', local: null };
  const e = readEnv(cmsRoot, env);
  if (!e.adminToken) return { source: 'none', local: null, note: 'no STRAPI_ADMIN_TOKEN to read the Privacy lists from Strapi' };
  try {
    const client = new AdminClient(checkUrl(e.url), e.adminToken, opts.fetchImpl ?? fetch, 'the admin token needs read access to Privacy lists');
    const local = await fetchPrivacyListsAdmin(client);
    return local ? { source: 'strapi', local } : { source: 'none', local: null, note: `the Privacy lists entry on ${new URL(e.url).host} is empty` };
  } catch (err) {
    return { source: 'none', local: null, note: `could not read the Privacy lists from Strapi: ${(err as Error).message.slice(0, 200)}` };
  }
}
