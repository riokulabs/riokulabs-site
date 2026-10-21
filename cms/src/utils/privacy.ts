/**
 * Privacy rules shared by the publish guard, the visibility-guard middleware, the seed and the audit
 * (CONTENT-MODEL §6).
 *
 * The lists come from two sources, merged (arrays concatenated, objects merged key by key):
 * - config/privacy.json: committed and public. The mechanism plus SYNTHETIC canary terms, so a fresh clone or a fork
 *   still proves every gate works.
 * - the private lists (the real deny patterns, IP terms, retired names, private seed entries): gitignored
 *   config/privacy.local.json, or the PRIVACY_LOCAL_JSON environment variable (same JSON; CI writes the file from the
 *   Actions secret of that name, Strapi Cloud sets the variable). Never committed.
 *
 * Pure functions only (no Strapi imports), so they are unit-tested in tests/privacy.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Visibility = 'public' | 'unlisted' | 'private';

export interface PrivacyConfig {
  denyPatterns: string[];
  ipDenyTerms: string[];
  /** Retired studio names: checked by the seed lint, the privacy audit and the site build, not the publish guard. */
  retiredBrandTerms?: string[];
  patternFlags?: string;
  neverSeed?: string[];
  [k: string]: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge: arrays are concatenated (exact duplicates dropped), objects merged per key, scalars from `extra` win. */
export function mergePrivacy<T>(base: T, extra: unknown): T {
  if (extra === undefined) return base;
  if (Array.isArray(base) && Array.isArray(extra)) {
    const seen = new Set(base.map((x) => JSON.stringify(x)));
    return [...base, ...extra.filter((x) => !seen.has(JSON.stringify(x)))] as T;
  }
  if (isObj(base) && isObj(extra)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(extra)) out[k] = k in base ? mergePrivacy(base[k], v) : v;
    return out as T;
  }
  return extra as T;
}

export const privacyLocalFile = (rootDir: string = process.cwd()) => path.join(rootDir, 'config', 'privacy.local.json');

/** The private lists, or null when neither the local file nor PRIVACY_LOCAL_JSON is present (a fork, CI without the secret). */
export function loadPrivacyLocal(rootDir: string = process.cwd()): Record<string, unknown> | null {
  const file = privacyLocalFile(rootDir);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const env = process.env.PRIVACY_LOCAL_JSON;
  if (env && env.trim()) return JSON.parse(env);
  return null;
}

const cache = new Map<string, PrivacyConfig>();

/** Public config/privacy.json merged with the private lists when they are present. */
export function loadPrivacyConfig(rootDir: string = process.cwd()): PrivacyConfig {
  const hit = cache.get(rootDir);
  if (hit) return hit;
  const pub = JSON.parse(fs.readFileSync(path.join(rootDir, 'config', 'privacy.json'), 'utf8')) as PrivacyConfig;
  const local = loadPrivacyLocal(rootDir);
  const json = local ? mergePrivacy(pub, local) : pub;
  cache.set(rootDir, json);
  return json;
}

export function compilePatterns(sources: string[], flags = 'i'): RegExp[] {
  return sources.map((s) => new RegExp(s, flags));
}

/** Fields whose text identifies an entry (titles, slugs, captions). Checked by the publish guard. */
export const IDENTIFYING_FIELDS = ['title', 'name', 'slug', 'label', 'tagline', 'summary', 'excerpt', 'subtitle', 'familyId', 'from', 'to'];

/** Returns the first deny pattern that matches any identifying field, or null. */
export function findDenyHit(data: Record<string, unknown>, patterns: RegExp[], fields = IDENTIFYING_FIELDS): { field: string; pattern: string } | null {
  for (const field of fields) {
    const v = data[field];
    if (typeof v !== 'string') continue;
    for (const re of patterns) {
      if (re.test(v)) return { field, pattern: re.source };
    }
  }
  return null;
}

/** Deep text scan: every string anywhere in the value (used by the audit and seed checks). */
export function scanDeep(value: unknown, patterns: RegExp[], at = '$'): { path: string; pattern: string; text: string }[] {
  const hits: { path: string; pattern: string; text: string }[] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === 'string') {
      for (const re of patterns) if (re.test(v)) hits.push({ path: p, pattern: re.source, text: v.slice(0, 120) });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    }
  };
  walk(value, at);
  return hits;
}

/** Visibilities a read is allowed to return. Unlisted only when the build asks for it explicitly. */
export function allowedVisibilities(includeUnlisted: boolean): Visibility[] {
  return includeUnlisted ? ['public', 'unlisted'] : ['public'];
}

/** Merge `visibility $in allowed` into a REST query's filters without dropping the caller's filters. */
export function withVisibilityFilter<Q extends Record<string, any>>(query: Q, allowed: Visibility[]): Q {
  const guard = { visibility: { $in: allowed } };
  const existing = query?.filters;
  const filters = existing && Object.keys(existing).length ? { $and: [existing, guard] } : guard;
  return { ...query, filters };
}

/**
 * Remove any populated object whose `visibility` is not allowed, anywhere below the root of a response body.
 * Arrays drop the item; single relations become null. Returns the number of objects removed.
 */
export function stripNonVisible(node: unknown, allowed: Visibility[]): number {
  let removed = 0;
  const isHidden = (v: unknown) =>
    !!v && typeof v === 'object' && !Array.isArray(v) && 'visibility' in (v as any) && !allowed.includes((v as any).visibility);
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        if (isHidden(v[i])) {
          v.splice(i, 1);
          removed++;
        } else walk(v[i]);
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (isHidden(x)) {
          (v as any)[k] = null;
          removed++;
        } else walk(x);
      }
    }
  };
  walk(node);
  return removed;
}

/** True when the entry would be reachable on the public internet if published. */
export function isPubliclyReachable(visibility: unknown): boolean {
  return visibility === 'public' || visibility === 'unlisted';
}

export interface PublishCheck {
  ok: boolean;
  reason?: string;
}

/**
 * The publish guard's decision (CONTENT-MODEL §6.1). An entry may not be published when it would be reachable
 * (visibility public/unlisted, or a single type, which is always public) and an identifying field matches a privacy
 * deny pattern or an IP deny term.
 */
export function checkPublishable(
  entry: Record<string, unknown>,
  opts: { hasVisibility: boolean; deny: RegExp[]; ip: RegExp[] },
): PublishCheck {
  const reachable = opts.hasVisibility ? isPubliclyReachable(entry.visibility) : true;
  if (!reachable) return { ok: true };
  const deny = findDenyHit(entry, opts.deny);
  if (deny) {
    return {
      ok: false,
      reason: `This looks like a private project (${deny.field} matches /${deny.pattern}/i). Set visibility to private, or remove the term from the private deny list once the project is meant to go public.`,
    };
  }
  const ip = findDenyHit(entry, opts.ip);
  if (ip) {
    return { ok: false, reason: `${ip.field} contains a term on the IP deny list (/${ip.pattern}/i). Rephrase it in generic terms.` };
  }
  return { ok: true };
}
