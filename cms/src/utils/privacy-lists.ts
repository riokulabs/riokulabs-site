/**
 * The "Privacy lists" single type (api::privacy-lists.privacy-lists): the private half of the privacy config, kept in
 * the CMS database instead of a file or an environment variable. Admin-only: the content API exposes one read route,
 * for the site-build API token, and it returns only the three lists the build needs (see buildView).
 *
 * The entry mirrors config/privacy.local.json field by field, so the merge logic in privacy.ts is unchanged:
 *   denyPatterns, ipDenyTerms, retiredBrandTerms, neverSeed, publicLeakTerms  string[]
 *   privateIdeaMods                                                          privateDraft.ideaMods
 *   legacyModelPrefix                                                        string
 *   testSamples                                                              { deny, ip, retired, allowed: string[] }
 *
 * Pure functions only (no Strapi imports), unit-tested in tests/privacy-lists.test.ts. Nothing here ever puts a list
 * term into an error message or a log line: problems name the field and the item index, summaries give counts.
 */

export const PRIVACY_LISTS_UID = 'api::privacy-lists.privacy-lists';

/** The admin error when public content is published before any private list exists. */
export const EMPTY_LISTS_MESSAGE = 'Privacy lists are empty; fill in Settings > Privacy lists first.';

/** Lists of regex sources (compiled case-insensitive). */
export const PATTERN_FIELDS = ['denyPatterns', 'ipDenyTerms', 'retiredBrandTerms'] as const;
/** Lists of plain strings. */
export const STRING_LIST_FIELDS = ['neverSeed', 'publicLeakTerms'] as const;
export const TEST_SAMPLE_KEYS = ['deny', 'ip', 'retired', 'allowed'] as const;

export interface PrivacyListsEntry {
  denyPatterns?: string[] | null;
  ipDenyTerms?: string[] | null;
  retiredBrandTerms?: string[] | null;
  neverSeed?: string[] | null;
  publicLeakTerms?: string[] | null;
  privateIdeaMods?: Record<string, unknown>[] | null;
  legacyModelPrefix?: string | null;
  testSamples?: Partial<Record<(typeof TEST_SAMPLE_KEYS)[number], string[]>> | null;
  [k: string]: unknown;
}

export type PrivacyLocal = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Keys of privacy.local.json the entry has a field for (`$` comment keys are dropped, never stored). */
export const KNOWN_LOCAL_KEYS = [...PATTERN_FIELDS, ...STRING_LIST_FIELDS, 'privateDraft', 'legacyModelPrefix', 'testSamples'];

/** privacy.local.json → entry data. Unknown keys are listed (by name) so the caller can warn about them. */
export function localToEntry(local: PrivacyLocal): { data: PrivacyListsEntry; unknownKeys: string[] } {
  const data: PrivacyListsEntry = {};
  for (const k of [...PATTERN_FIELDS, ...STRING_LIST_FIELDS]) data[k] = strings(local[k]);
  const pd = isObj(local.privateDraft) ? local.privateDraft : {};
  data.privateIdeaMods = Array.isArray(pd.ideaMods) ? (pd.ideaMods as unknown[]).filter(isObj) : [];
  data.legacyModelPrefix = typeof local.legacyModelPrefix === 'string' ? local.legacyModelPrefix : null;
  data.testSamples = isObj(local.testSamples)
    ? Object.fromEntries(TEST_SAMPLE_KEYS.filter((k) => k in (local.testSamples as object)).map((k) => [k, strings((local.testSamples as any)[k])]))
    : null;
  const unknownKeys = Object.keys(local).filter((k) => !k.startsWith('$') && !KNOWN_LOCAL_KEYS.includes(k));
  if (isObj(local.privateDraft)) for (const k of Object.keys(local.privateDraft)) if (!k.startsWith('$') && k !== 'ideaMods') unknownKeys.push(`privateDraft.${k}`);
  return { data, unknownKeys };
}

/**
 * Entry → the same shape as privacy.local.json, or null when the entry is missing or holds no list at all (a fresh
 * database). Empty lists and empty optional fields are left out.
 */
export function entryToLocal(entry: PrivacyListsEntry | null | undefined): PrivacyLocal | null {
  if (!entry || !isObj(entry)) return null;
  const out: PrivacyLocal = {};
  for (const k of [...PATTERN_FIELDS, ...STRING_LIST_FIELDS]) {
    const v = strings(entry[k]);
    if (v.length) out[k] = v;
  }
  const ideas = Array.isArray(entry.privateIdeaMods) ? entry.privateIdeaMods.filter(isObj) : [];
  if (ideas.length) out.privateDraft = { ideaMods: ideas };
  if (typeof entry.legacyModelPrefix === 'string' && entry.legacyModelPrefix.trim()) out.legacyModelPrefix = entry.legacyModelPrefix.trim();
  if (isObj(entry.testSamples)) out.testSamples = entry.testSamples;
  return hasPrivateLists(out) ? out : null;
}

/** True when at least one deny, IP or retired pattern is present: the minimum for the publish guard to count as set up. */
export function hasPrivateLists(local: PrivacyLocal | null | undefined): boolean {
  return !!local && PATTERN_FIELDS.some((k) => strings(local[k]).length > 0);
}

/** Counts only, for logs: `deny 7, IP 14, retired 3, ideas 5, neverSeed 19`. Never the terms. */
export function summarize(local: PrivacyLocal | null | undefined): string {
  if (!local) return 'empty';
  const pd = isObj(local.privateDraft) ? local.privateDraft : {};
  const parts = [
    `deny ${strings(local.denyPatterns).length}`,
    `IP ${strings(local.ipDenyTerms).length}`,
    `retired ${strings(local.retiredBrandTerms).length}`,
    `ideas ${Array.isArray(pd.ideaMods) ? pd.ideaMods.length : 0}`,
    `neverSeed ${strings(local.neverSeed).length}`,
  ];
  if (strings(local.publicLeakTerms).length) parts.push(`leak terms ${strings(local.publicLeakTerms).length}`);
  if (typeof local.legacyModelPrefix === 'string') parts.push('model prefix set');
  if (isObj(local.testSamples)) parts.push('test samples set');
  return parts.join(', ');
}

/**
 * Validation for a create/update of the entry. Only the fields present in `data` are checked (a partial update leaves
 * the rest alone). Messages name the field and the item number, never the value.
 */
export function validateEntry(data: Record<string, unknown>, flags = 'i'): string[] {
  const problems: string[] = [];
  const list = (k: string, v: unknown, regex: boolean) => {
    if (v === null || v === undefined) return;
    if (!Array.isArray(v)) return problems.push(`${k} must be a JSON list of strings, like ["first", "second"]`);
    v.forEach((x, i) => {
      if (typeof x !== 'string' || !x.trim()) return problems.push(`${k} item ${i + 1} must be a non-empty string`);
      if (regex) {
        try {
          new RegExp(x, flags);
        } catch {
          problems.push(`${k} item ${i + 1} is not a valid regular expression`);
        }
      }
    });
  };
  for (const k of PATTERN_FIELDS) if (k in data) list(k, data[k], true);
  for (const k of STRING_LIST_FIELDS) if (k in data) list(k, data[k], false);
  if ('privateIdeaMods' in data && data.privateIdeaMods != null) {
    const v = data.privateIdeaMods;
    if (!Array.isArray(v)) problems.push('privateIdeaMods must be a JSON list of objects, like [{"name": "...", "slug": "..."}]');
    else v.forEach((x, i) => {
      if (!isObj(x)) problems.push(`privateIdeaMods item ${i + 1} must be an object`);
      else if (typeof x.name !== 'string' && typeof x.slug !== 'string') problems.push(`privateIdeaMods item ${i + 1} needs a name or a slug`);
    });
  }
  if ('legacyModelPrefix' in data && data.legacyModelPrefix != null && data.legacyModelPrefix !== '') {
    if (typeof data.legacyModelPrefix !== 'string' || !/^[A-Za-z0-9]+$/.test(data.legacyModelPrefix)) problems.push('legacyModelPrefix must be letters and digits only');
  }
  if ('testSamples' in data && data.testSamples != null) {
    const v = data.testSamples;
    if (!isObj(v)) problems.push('testSamples must be a JSON object like {"deny": [], "ip": [], "retired": [], "allowed": []}');
    else for (const [k, x] of Object.entries(v)) {
      if (!(TEST_SAMPLE_KEYS as readonly string[]).includes(k)) problems.push(`testSamples.${k} is not a known key (deny, ip, retired, allowed)`);
      else list(`testSamples.${k}`, x, false);
    }
  }
  return problems;
}

/** What the content API returns to the build token: the three lists it checks the site against, nothing else. */
export function buildView(entry: PrivacyListsEntry | null | undefined): Record<string, string[]> | null {
  if (!entry) return null;
  const out = Object.fromEntries(PATTERN_FIELDS.map((k) => [k, strings(entry[k])]));
  return hasPrivateLists(out) ? out : null;
}

export type PrivacySource = 'db' | 'file' | 'env' | 'none';

/**
 * Where the private lists come from, in order: the CMS entry, then config/privacy.local.json, then PRIVACY_LOCAL_JSON.
 * Each source is a thunk so a later one is only read when the earlier ones are empty.
 */
export function resolvePrivateLists(sources: {
  db?: () => PrivacyLocal | null | undefined;
  file?: () => PrivacyLocal | null | undefined;
  env?: () => PrivacyLocal | null | undefined;
}): { source: PrivacySource; local: PrivacyLocal | null } {
  for (const source of ['db', 'file', 'env'] as const) {
    const local = sources[source]?.();
    if (local && hasPrivateLists(local)) return { source, local };
  }
  return { source: 'none', local: null };
}

/**
 * Whether publishing public content needs the private lists. On by default in production; PRIVACY_REQUIRE_LISTS=1
 * turns it on elsewhere (tests), PRIVACY_REQUIRE_LISTS=0 off.
 */
export function privacyListsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PRIVACY_REQUIRE_LISTS === '1') return true;
  if (env.PRIVACY_REQUIRE_LISTS === '0') return false;
  return env.NODE_ENV === 'production';
}

/** True for a call made through Strapi's MCP server (server.mcp, path /mcp). */
export function isMcpRequest(ctx: { path?: string } | undefined | null): boolean {
  const p = ctx?.path ?? '';
  return p === '/mcp' || p.startsWith('/mcp/');
}
