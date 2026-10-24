/**
 * Build-time privacy rules (ARCHITECTURE §4, §9). Node-only: imported by the content loader and the dist lint, never
 * by client code, so the deny patterns themselves never ship to the browser.
 *
 * Sources, merged: cms/config/privacy.json (committed: the mechanism plus synthetic canary terms) and the private lists
 * (the real terms; never committed). A Strapi build reads the private lists from the CMS "Privacy lists" entry
 * (privacy-source.ts); local builds and tests use cms/config/privacy.local.json, or the PRIVACY_LOCAL_JSON environment
 * variable. Same merge as cms/src/utils/privacy.ts.
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

/** cms/config/privacy.local.json, or null when absent. */
export function readPrivacyLocalFile(localFile = privacyLocalFile()): Record<string, unknown> | null {
  return fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, 'utf8')) : null;
}

/** PRIVACY_LOCAL_JSON, or null when unset or blank. */
export function readPrivacyLocalEnv(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> | null {
  const v = env.PRIVACY_LOCAL_JSON;
  return v && v.trim() ? JSON.parse(v) : null;
}

/** The local private lists (file, then PRIVACY_LOCAL_JSON), or null when absent (a fork, CI). */
export function loadPrivacyLocal(localFile = privacyLocalFile()): Record<string, unknown> | null {
  return readPrivacyLocalFile(localFile) ?? readPrivacyLocalEnv();
}

/** File/env lists, compiled. A Strapi build uses resolvePrivacyLists (privacy-source.ts) instead. */
export function loadPrivacyLists(file = privacyFile(), localFile = privacyLocalFile(file)): PrivacyLists {
  return compilePrivacyLists(loadPrivacyLocal(localFile), file);
}

/** The public lists merged with the given private lists (null: the public canaries alone), compiled. */
export function compilePrivacyLists(local: Record<string, unknown> | null | undefined, file = privacyFile()): PrivacyLists {
  const pub = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = local ? mergePrivacy(pub, local) : pub;
  const flags = cfg.patternFlags ?? 'i';
  return {
    deny: (cfg.denyPatterns as string[]).map((s) => new RegExp(s, flags)),
    ip: (cfg.ipDenyTerms as string[]).map((s) => new RegExp(s, flags)),
    retired: ((cfg.retiredBrandTerms ?? []) as string[]).map((s) => new RegExp(s, flags)),
  };
}

/**
 * IP terms are product rules, not discussion rules (same rule as IP_EXEMPT_TYPES in cms/src/utils/privacy.ts). Mod,
 * block, release and timeline names, the site chrome and the fixed pages must be our own, so the IP list applies to
 * them. A dev log post may name the show or game that inspired a mod (nominative, fan reference), so blog posts skip
 * the IP list: the entries below in the build assertion, and in dist/ the pages and files that carry post content
 * (isIpExemptPath, maskIpExempt). The private deny patterns and the retired studio names apply everywhere.
 */
export const IP_EXEMPT_COLLECTIONS: readonly string[] = ['blogPosts'];

/**
 * dist/ files that are blog post content: the post pages, the blog index and tag pages (post cards; their chrome comes
 * from site settings, which the build assertion checks) and the post OG cards. Paths are relative to dist/, "/"-separated.
 */
export function isIpExemptPath(rel: string): boolean {
  return rel === 'blog.html' || rel.startsWith('blog/') || rel.startsWith('og/blog/');
}

/** Marks a post card on any other page (PostCard.astro): the IP lint skips the text between the two markers. */
export const IP_EXEMPT_OPEN = '<!--ip-exempt:post-->';
export const IP_EXEMPT_CLOSE = '<!--/ip-exempt:post-->';

/**
 * The text the IP lint should see in a dist/ file that is not exempt as a whole: post cards (between the markers, in
 * HTML), RSS <item>s (in rss.xml) and post URLs (/blog/<slug>, /og/blog/<slug>, for example in the sitemap) are blanked.
 * Newlines are kept, so line numbers still point at the right place.
 */
export function maskIpExempt(rel: string, text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  let out = text;
  if (/\.html?$/i.test(rel)) {
    const open = IP_EXEMPT_OPEN.replace(/[/!-]/g, '\\$&');
    const close = IP_EXEMPT_CLOSE.replace(/[/!-]/g, '\\$&');
    out = out.replace(new RegExp(`${open}[\\s\\S]*?${close}`, 'g'), blank);
  }
  if (rel === 'rss.xml') out = out.replace(/<item>[\s\S]*?<\/item>/g, blank);
  return out.replace(/\/(?:og\/)?blog\/[^\s"'<>()\\]+/g, blank);
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

/**
 * Text lint: returns "path /pattern/ text" lines for every deny or IP hit in the value (redacted under CI).
 * `ip: false` skips the IP list (blog posts, IP_EXEMPT_COLLECTIONS); deny and retired terms are always checked.
 */
export function lintText(value: unknown, lists: PrivacyLists, label = '', opts: { ip?: boolean } = {}): string[] {
  const hits: string[] = [];
  const ip = opts.ip === false ? [] : lists.ip;
  for (const [p, s] of strings(value)) {
    const all = [...lists.deny, ...lists.ip, ...(lists.retired ?? [])];
    for (const re of lists.deny) if (re.test(s)) hits.push(hitLine('PRIVACY', `${label}${p}`, re, lists.deny, s.slice(0, 80), all));
    for (const re of ip) if (re.test(s)) hits.push(hitLine('IP', `${label}${p}`, re, lists.ip, s.slice(0, 80), all));
    for (const re of lists.retired ?? []) if (re.test(s)) hits.push(hitLine('BRAND', `${label}${p}`, re, lists.retired ?? [], s.slice(0, 80), all));
  }
  return hits;
}
