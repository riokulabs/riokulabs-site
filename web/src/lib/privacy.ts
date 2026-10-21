/**
 * Build-time privacy rules (ARCHITECTURE §4, §9). Node-only: imported by the content loader and the dist lint, never
 * by client code, so the deny patterns themselves never ship to the browser.
 *
 * Sources, merged: cms/config/privacy.json (committed: the mechanism plus synthetic canary terms) and the private lists
 * (the real terms; never committed): cms/config/privacy.local.json, or the PRIVACY_LOCAL_JSON environment variable.
 * Same merge as cms/src/utils/privacy.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolved lazily: this module is also bundled into the preview Worker, where import.meta.url isn't a file URL. */
export const privacyFile = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'cms', 'config', 'privacy.json');
/** The gitignored private lists next to the public file. */
export const privacyLocalFile = (file = privacyFile()) => path.join(path.dirname(file), 'privacy.local.json');

export interface PrivacyLists {
  deny: RegExp[];
  ip: RegExp[];
  /** Retired studio names: no leftovers in public output. */
  retired: RegExp[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge: arrays concatenated (exact duplicates dropped), objects merged per key, scalars from `extra` win. */
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

/** The private lists, or null when absent (a fork, or CI without the PRIVACY_LOCAL_JSON secret). */
export function loadPrivacyLocal(localFile = privacyLocalFile()): Record<string, unknown> | null {
  if (fs.existsSync(localFile)) return JSON.parse(fs.readFileSync(localFile, 'utf8'));
  const env = process.env.PRIVACY_LOCAL_JSON;
  return env && env.trim() ? JSON.parse(env) : null;
}

export function loadPrivacyLists(file = privacyFile(), localFile = privacyLocalFile(file)): PrivacyLists {
  const pub = JSON.parse(fs.readFileSync(file, 'utf8'));
  const local = loadPrivacyLocal(localFile);
  const cfg = local ? mergePrivacy(pub, local) : pub;
  const flags = cfg.patternFlags ?? 'i';
  return {
    deny: (cfg.denyPatterns as string[]).map((s) => new RegExp(s, flags)),
    ip: (cfg.ipDenyTerms as string[]).map((s) => new RegExp(s, flags)),
    retired: ((cfg.retiredBrandTerms ?? []) as string[]).map((s) => new RegExp(s, flags)),
  };
}

export const VISIBLE = ['public', 'unlisted'] as const;
export const isVisible = (v: unknown) => v === 'public' || v === 'unlisted';

export class PrivacyAssertionError extends Error {
  constructor(public problems: string[]) {
    super(`Build assertion failed (privacy/IP): ${problems.length} problem(s)\n - ${problems.slice(0, 30).join('\n - ')}`);
  }
}

/** Every string anywhere in a value, with its path. */
export function* strings(value: unknown, at = '$'): Generator<[string, string]> {
  if (typeof value === 'string') yield [at, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], `${at}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, `${at}.${k}`);
}

/**
 * The repo is public, and so are its Actions logs: under CI a hit names its kind, a masked location and the term's
 * list index only, never the pattern or the text around it. Locally (or with PRIVACY_VERBOSE=1) it says everything.
 */
const publicLog = () => !!process.env.CI && process.env.PRIVACY_VERBOSE !== '1';
/** FNV-1a: a stable tag for a location, so a CI log can say "the same place again" without naming it. */
export const placeTag = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };
export function hitLine(kind: string, where: string, re: RegExp, list: RegExp[], text: string | undefined, _all?: RegExp[]): string {
  // never print the location itself under CI: a path or snippet can contain the term (masking a string is not enough)
  if (publicLog()) return `${kind} @${placeTag(where)} (term #${list.indexOf(re) + 1})`;
  return `${kind} ${where} /${re.source}/${text === undefined ? '' : ` "${text}"`}`;
}

/** Text lint: returns "path /pattern/ text" lines for every deny or IP hit in the value (redacted under CI). */
export function lintText(value: unknown, lists: PrivacyLists, label = ''): string[] {
  const hits: string[] = [];
  for (const [p, s] of strings(value)) {
    const all = [...lists.deny, ...lists.ip, ...(lists.retired ?? [])];
    for (const re of lists.deny) if (re.test(s)) hits.push(hitLine('PRIVACY', `${label}${p}`, re, lists.deny, s.slice(0, 80), all));
    for (const re of lists.ip) if (re.test(s)) hits.push(hitLine('IP', `${label}${p}`, re, lists.ip, s.slice(0, 80), all));
    for (const re of lists.retired ?? []) if (re.test(s)) hits.push(hitLine('BRAND', `${label}${p}`, re, lists.retired ?? [], s.slice(0, 80), all));
  }
  return hits;
}
