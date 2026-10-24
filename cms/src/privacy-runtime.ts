/**
 * The privacy lists the running CMS uses (publish guard, privacy audit): the public config/privacy.json merged with the
 * private lists from, in order, the "Privacy lists" entry in the database, config/privacy.local.json, or
 * PRIVACY_LOCAL_JSON (utils/privacy-lists.ts resolvePrivateLists).
 *
 * Cached in memory. Refreshed at bootstrap, after every write to the entry (the Document Service middleware in
 * index.ts), and at most once a minute on the next publish, so a second instance sees an edit too.
 *
 * Boot never fails for missing lists. In production (utils/privacy-lists.ts privacyListsRequired) the publish guard
 * then refuses to publish anything public until the entry is filled in.
 *
 * One-time migration: at bootstrap, an empty entry is seeded from the local file or PRIVACY_LOCAL_JSON when one of them
 * holds lists. Logs give counts only, never a term.
 */
import type { Core } from '@strapi/strapi';
import { compilePatterns, loadPublicPrivacy, readPrivacyLocalEnv, readPrivacyLocalFile, withPrivateLists, type PrivacyConfig } from './utils/privacy';
import {
  entryToLocal,
  localToEntry,
  PRIVACY_LISTS_UID,
  resolvePrivateLists,
  summarize,
  type PrivacyLocal,
  type PrivacySource,
} from './utils/privacy-lists';

export interface PrivacyState {
  source: PrivacySource;
  /** The merged config (public + private). */
  config: PrivacyConfig;
  /** The private lists alone (null when source is 'none'). */
  local: PrivacyLocal | null;
  deny: RegExp[];
  ip: RegExp[];
  loadedAt: number;
}

const STALE_MS = 60_000;
let state: PrivacyState | null = null;

function compile(rootDir: string, source: PrivacySource, local: PrivacyLocal | null): PrivacyState {
  const config = withPrivateLists(loadPublicPrivacy(rootDir), local);
  const flags = config.patternFlags ?? 'i';
  return { source, config, local, deny: compilePatterns(config.denyPatterns, flags), ip: compilePatterns(config.ipDenyTerms, flags), loadedAt: Date.now() };
}

/** The entry as file-shaped lists, or null when it is missing/empty (or the table isn't there yet). */
export async function readEntry(strapi: Core.Strapi): Promise<PrivacyLocal | null> {
  if (!strapi.contentType(PRIVACY_LISTS_UID as any)) return null;
  const doc = await strapi.documents(PRIVACY_LISTS_UID as any).findFirst({} as any);
  return entryToLocal(doc as any);
}

/** File, then env, each only read when needed. A broken file or variable is reported (no content) and skipped. */
function fallbackSources(rootDir: string, log?: Core.Strapi['log']) {
  const safe = (what: string, fn: () => PrivacyLocal | null) => () => {
    try {
      return fn();
    } catch {
      log?.error(`[privacy] ${what} is not valid JSON; ignored`);
      return null;
    }
  };
  return { file: safe('config/privacy.local.json', () => readPrivacyLocalFile(rootDir)), env: safe('PRIVACY_LOCAL_JSON', () => readPrivacyLocalEnv()) };
}

/** Re-read every source. On a database error the previous state is kept (or, before the first load, the fallbacks). */
export async function refreshPrivacy(strapi: Core.Strapi): Promise<PrivacyState> {
  const rootDir = strapi.dirs.app.root;
  let db: PrivacyLocal | null = null;
  try {
    db = await readEntry(strapi);
  } catch (e) {
    strapi.log.error(`[privacy] could not read the Privacy lists entry: ${(e as Error).message}`);
    if (state) return state;
  }
  const { source, local } = resolvePrivateLists({ db: () => db, ...fallbackSources(rootDir, strapi.log) });
  const prev = state?.source;
  state = compile(rootDir, source, local);
  if (prev !== source) strapi.log.info(`[privacy] private lists from ${source === 'none' ? 'nowhere (empty)' : source}: ${summarize(local)}`);
  return state;
}

/** The current state, refreshed when older than a minute. */
export async function getPrivacy(strapi: Core.Strapi): Promise<PrivacyState> {
  if (!state || Date.now() - state.loadedAt > STALE_MS) return refreshPrivacy(strapi);
  return state;
}

/** The cached state without touching the database (null before bootstrap). */
export const currentPrivacy = () => state;

/** Tests: forget the cache. */
export function resetPrivacyState() {
  state = null;
}

/**
 * One-time migration at bootstrap: when the entry is empty and the local file or PRIVACY_LOCAL_JSON holds lists, copy
 * them into the entry. Returns what it did. Never overwrites a filled-in entry.
 */
export async function seedPrivacyListsIfEmpty(strapi: Core.Strapi): Promise<'seeded' | 'kept' | 'nothing-to-seed'> {
  if (!strapi.contentType(PRIVACY_LISTS_UID as any)) return 'nothing-to-seed';
  const docs = strapi.documents(PRIVACY_LISTS_UID as any);
  const existing: any = await docs.findFirst({} as any);
  if (entryToLocal(existing)) return 'kept';
  const { source, local } = resolvePrivateLists(fallbackSources(strapi.dirs.app.root, strapi.log));
  if (!local) return 'nothing-to-seed';
  const { data, unknownKeys } = localToEntry(local);
  if (existing?.documentId) await docs.update({ documentId: existing.documentId, data } as any);
  else await docs.create({ data } as any);
  strapi.log.info(`[privacy] seeded the Privacy lists entry from ${source === 'file' ? 'config/privacy.local.json' : 'PRIVACY_LOCAL_JSON'} (${summarize(local)})`);
  if (unknownKeys.length) strapi.log.warn(`[privacy] keys with no field in Privacy lists were not copied: ${unknownKeys.join(', ')}`);
  return 'seeded';
}
