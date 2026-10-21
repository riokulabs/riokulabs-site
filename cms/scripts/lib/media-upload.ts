/**
 * Pure helpers for scripts/media-upload.ts: argument parsing, name hygiene, refusal rules, metadata stripping and the
 * multipart request. No Strapi imports and no network, so tests/media-upload.test.ts covers them with a mocked fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPrivacyConfig, loadPrivacyLocal } from '../../src/utils/privacy';

export const DEFAULT_URL = 'https://cms.rioku.dev';
export const MAX_BYTES = 20 * 1024 * 1024;

export interface Options {
  files: string[];
  alt?: string;
  decorative: boolean;
  caption?: string;
  name?: string;
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

export class UsageError extends Error {}

export const USAGE = `Usage: npm run media:upload -- <file|glob>... --alt "what the picture shows" [options]

Options:
  --alt "<text>"      Alt text (required unless --decorative). Also the source of the file name.
  --decorative        The image is decorative: empty alt text. Needs --name or a neutral file name.
  --caption "<text>"  Caption shown under the image.
  --name "<slug>"     File name to use instead of one made from the alt text.
  --dry-run           Check and print what would be uploaded; send nothing.
  --force             Allow files over 20 MB (the server still caps uploads at 25 MB).

Env: STRAPI_URL (default ${DEFAULT_URL}), STRAPI_UPLOAD_TOKEN (Content API token: Upload upload + find).
Prints one JSON line per uploaded file: {"id","documentId","url","name",...}.`;

/** Parse argv (without node and script). Throws UsageError on anything it does not understand. */
export function parseArgs(argv: string[]): Options {
  const o: Options = { files: [], decorative: false, dryRun: false, force: false, help: false };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.match(/^(--[a-z-]+)=(.*)$/s);
    const flag = eq ? eq[1] : a;
    const take = () => (eq ? eq[2] : value(i++, flag));
    switch (flag) {
      case '--alt': o.alt = take(); break;
      case '--caption': o.caption = take(); break;
      case '--name': o.name = take(); break;
      case '--decorative': o.decorative = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--force': o.force = true; break;
      case '-h':
      case '--help': o.help = true; break;
      case '--folder':
        throw new UsageError(
          '--folder is not supported: the Strapi 5.58 Content API always puts uploads in the "API Uploads" folder ' +
            '(fileInfo has no folder field). Move the file afterwards with the MCP media_move_assets tool.',
        );
      default:
        if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
        o.files.push(a);
    }
  }
  if (o.help) return o;
  if (!o.files.length) throw new UsageError('no files given');
  if (o.alt !== undefined) o.alt = o.alt.trim();
  if (o.decorative && o.alt) throw new UsageError('--decorative means no alt text; drop one of --alt and --decorative');
  if (!o.decorative && !o.alt) throw new UsageError('--alt is required (describe what the picture shows), or pass --decorative');
  if (o.name !== undefined && !slugify(o.name)) throw new UsageError('--name has no usable characters');
  return o;
}

/** Expand globs (Node 22+ fs.globSync); plain paths pass through. Missing files throw. */
export function expandFiles(patterns: string[], cwd = process.cwd()): string[] {
  const out: string[] = [];
  const glob = (fs as unknown as { globSync?: (p: string, o: { cwd: string }) => string[] }).globSync;
  for (const p of patterns) {
    if (/[*?[{]/.test(p)) {
      if (!glob) throw new UsageError(`globs need Node 22+ (or let the shell expand them): ${p}`);
      const hits = glob(p, { cwd }).map((f) => path.resolve(cwd, f)).filter((f) => fs.statSync(f).isFile());
      if (!hits.length) throw new UsageError(`no files match ${p}`);
      out.push(...hits.sort());
    } else {
      const abs = path.resolve(cwd, p);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new UsageError(`not a file: ${p}`);
      out.push(abs);
    }
  }
  return [...new Set(out)];
}

/** Lowercase ASCII words joined by hyphens, at most 60 characters, cut on a word boundary. */
export function slugify(s: string, max = 60): string {
  let slug = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > max) {
    slug = slug.slice(0, max);
    const cut = slug.lastIndexOf('-');
    if (cut > 20) slug = slug.slice(0, cut);
    slug = slug.replace(/-+$/, '');
  }
  return slug;
}

/**
 * Names that read like internal work items (plan-3-task-2, t12c, wip, audit). Public URLs must not carry them.
 * The trailing lookahead keeps ordinary words such as "planet", "tasks" or "wipe" from matching.
 */
export const INTERNAL_NAME = /\b(plan|task|t\d+c?|ruling|audit|wip)[-_ ]?\d*(?![a-z])/i;

/** Word boundaries around hyphens and underscores, so "plan_3" and "x-wip-2" both hit. */
export const looksInternal = (s: string) => INTERNAL_NAME.test(s.replace(/[_-]/g, ' '));

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

/** The file's type from its first bytes. null when it is none of the image/video types we accept. */
export function sniffMime(buf: Buffer): string | null {
  const at = (o: number, s: string) => buf.subarray(o, o + s.length).toString('latin1') === s;
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  if (at(4, 'ftyp')) {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return null;
}

/** Decide the upload type: the extension must be an image/video type and agree with the content. */
export function detectMime(file: string, buf: Buffer): string {
  const ext = path.extname(file).toLowerCase();
  const byExt = MIME_BY_EXT[ext];
  if (!byExt) throw new Error(`only images and videos can be uploaded (${ext || 'no extension'} is not one)`);
  const sniffed = sniffMime(buf);
  if (!sniffed) throw new Error(`content is not a recognised image or video`);
  // mp4/mov share a container; trust the extension between those two.
  const same = sniffed === byExt || (sniffed.startsWith('video/') && byExt.startsWith('video/') && sniffed !== 'video/webm' && byExt !== 'video/webm');
  if (!same) throw new Error(`extension says ${byExt} but the content is ${sniffed}`);
  return byExt;
}

export const extFor = (mime: string) => EXT_BY_MIME[mime] ?? '';

/**
 * Remove EXIF/XMP/IPTC/comments from a JPEG without re-encoding: drops APP1 (Exif, XMP), APP13 (IPTC) and COM
 * segments, keeps JFIF (APP0), ICC colour (APP2) and Adobe (APP14). Returns the orientation found in EXIF (1 = none)
 * so the caller can rotate the pixels before the tag is lost.
 */
export function stripJpeg(buf: Buffer): { out: Buffer; removed: number; orientation: number } {
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw new Error('not a JPEG');
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  let removed = 0;
  let orientation = 1;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error('corrupt JPEG segment');
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xda) break; // start of scan: the rest is image data
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (marker === 0xe1 && seg.subarray(4, 10).toString('latin1') === 'Exif\0\0') orientation = exifOrientation(seg.subarray(10)) ?? orientation;
    if (drop) removed++;
    else parts.push(seg);
    i += 2 + len;
  }
  parts.push(buf.subarray(i));
  return { out: Buffer.concat(parts), removed, orientation };
}

function exifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const le = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > tiff.length) return null;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return null;
}

/** Remove PNG text and EXIF chunks (tEXt, zTXt, iTXt, eXIf, tIME) without touching pixels. */
export function stripPng(buf: Buffer): { out: Buffer; removed: number } {
  const DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  let removed = 0;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const chunk = buf.subarray(i, i + 12 + len);
    if (DROP.has(type)) removed++;
    else parts.push(chunk);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return { out: Buffer.concat(parts), removed };
}

/** Privacy terms: the deny, IP and retired-name patterns plus the private entry names (as in check-public). */
export interface Term { re: RegExp; kind: string; index: number }

export function loadTerms(cmsRoot: string): { terms: Term[]; hasPrivate: boolean } {
  const cfg = loadPrivacyConfig(cmsRoot) as Record<string, any>;
  const local = loadPrivacyLocal(cmsRoot) as Record<string, any> | null;
  const flags = cfg.patternFlags ?? 'i';
  const terms: Term[] = [];
  for (const [key, kind] of [['denyPatterns', 'PRIVACY'], ['ipDenyTerms', 'IP'], ['retiredBrandTerms', 'BRAND']] as const) {
    ((cfg[key] ?? []) as string[]).forEach((s, i) => terms.push({ re: new RegExp(s, flags), kind, index: i + 1 }));
  }
  const literals: string[] = [];
  const add = (t: unknown) => { if (typeof t === 'string' && t.trim().length >= 3) literals.push(t.trim()); };
  for (const m of local?.privateDraft?.ideaMods ?? []) [m.name, m.slug].forEach(add);
  for (const t of local?.publicLeakTerms ?? []) add(t);
  const privateSeed = path.join(cmsRoot, 'seed', 'private.ts');
  if (fs.existsSync(privateSeed)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require(privateSeed);
    for (const m of p.ideaMods ?? []) [m.name, m.slug].forEach(add);
  }
  // Compare with separators folded, so "My-Project" in a file name still matches "My Project".
  [...new Set(literals)].forEach((t, i) => {
    const src = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s_-]+/g, '[\\s_-]*');
    terms.push({ re: new RegExp(`(?<![a-z0-9])${src}(?![a-z0-9])`, 'i'), kind: 'PRIVATE-SEED', index: i + 1 });
  });
  return { terms, hasPrivate: !!local };
}

/** FNV-1a, as placeTag in web/src/lib/privacy.ts: a stable tag that names a place without showing it. */
export const placeTag = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** Hits as "KIND in <field> @<tag> (term #n)": never the term, never the text. */
export function privacyHits(fields: Record<string, string | undefined>, terms: Term[]): string[] {
  const hits: string[] = [];
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    const variants = [text, text.replace(/[_-]+/g, ' ')];
    for (const t of terms) {
      if (variants.some((v) => t.re.test(v))) hits.push(`${t.kind} in ${field} @${placeTag(`${field}:${text}`)} (term #${t.index})`);
    }
  }
  return hits;
}

export interface Planned {
  source: string;
  name: string; // uploaded file name, with extension
  mime: string;
  bytes: number;
  data: Buffer;
  notes: string[];
}

/**
 * Check one file and decide its upload name. Throws with a short reason on any refusal.
 * `rotate` re-encodes a JPEG whose EXIF orientation is not 1 (injected so tests need no sharp).
 */
export async function planFile(
  source: string,
  opts: Options,
  terms: Term[],
  seq: { n: number; of: number },
  rotate?: (buf: Buffer) => Promise<Buffer>,
): Promise<Planned> {
  const stat = fs.statSync(source);
  if (stat.size > MAX_BYTES && !opts.force) throw new Error(`${(stat.size / 1048576).toFixed(1)} MB is over the 20 MB limit (pass --force to allow up to 25 MB)`);
  let data: Buffer = fs.readFileSync(source);
  const mime = detectMime(source, data);

  const fromName = opts.name !== undefined;
  const base = slugify(opts.name ?? (opts.alt || path.basename(source, path.extname(source))));
  if (!base) throw new Error('no usable file name: pass --name');
  if (!fromName && looksInternal(base)) throw new Error('the file name would read like an internal work item; pass --name with a neutral name');
  const slug = seq.of > 1 ? `${base}-${seq.n}` : base;
  const name = `${slug}${extFor(mime)}`;

  const hits = privacyHits({ 'file name': path.basename(source), 'upload name': name, alt: opts.alt, caption: opts.caption }, terms);
  if (hits.length) throw new Error(`privacy check failed: ${hits.join('; ')}`);

  const notes: string[] = [];
  if (mime === 'image/jpeg') {
    const s = stripJpeg(data);
    data = s.out;
    if (s.removed) notes.push(`removed ${s.removed} metadata segment(s)`);
    if (s.orientation !== 1) {
      if (!rotate) throw new Error('JPEG has an EXIF rotation and sharp is not available to apply it; rotate the image first');
      // sharp reads the orientation from the original and writes no metadata
      data = await rotate(fs.readFileSync(source));
      notes.push('re-encoded to apply EXIF rotation');
    }
  } else if (mime === 'image/png') {
    const s = stripPng(data);
    data = s.out;
    if (s.removed) notes.push(`removed ${s.removed} metadata chunk(s)`);
  } else {
    notes.push('metadata not stripped (only JPEG and PNG are cleaned)');
  }
  return { source, name, mime, bytes: data.length, data, notes };
}

/** Allow plain http only for a local Strapi: the token must not cross the network unencrypted. */
export function checkUrl(url: string): string {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new UsageError(`STRAPI_URL must be https (or http on localhost): ${url}`);
  return u.origin;
}

export interface Uploaded { id: number; documentId: string; url: string; name: string; mime: string; size: number; alternativeText: string | null }

/** POST /api/upload with one file. Returns the created file. */
export async function uploadOne(
  baseUrl: string,
  token: string,
  file: Pick<Planned, 'name' | 'mime' | 'data'>,
  info: { alternativeText: string; caption?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Uploaded> {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  form.append('fileInfo', JSON.stringify({ name: file.name, alternativeText: info.alternativeText, ...(info.caption ? { caption: info.caption } : {}) }));
  const res = await fetchImpl(`${baseUrl}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch { /* not JSON */ }
    throw new Error(`upload failed: HTTP ${res.status} ${msg}`);
  }
  const body = JSON.parse(text);
  const f = Array.isArray(body) ? body[0] : body;
  if (!f?.id) throw new Error('upload response has no file');
  const url = typeof f.url === 'string' && f.url.startsWith('/') ? `${baseUrl}${f.url}` : f.url;
  return { id: f.id, documentId: f.documentId, url, name: f.name, mime: f.mime, size: f.size, alternativeText: f.alternativeText ?? null };
}

/** STRAPI_URL / STRAPI_UPLOAD_TOKEN from the environment, else from cms/.env (only those two keys are read). */
export function readEnv(cmsRoot: string, env = process.env): { url: string; token?: string } {
  let fileVars: Record<string, string> = {};
  const envFile = path.join(cmsRoot, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*(STRAPI_URL|STRAPI_UPLOAD_TOKEN)\s*=\s*(.*?)\s*$/);
      if (m) fileVars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { url: env.STRAPI_URL || fileVars.STRAPI_URL || DEFAULT_URL, token: env.STRAPI_UPLOAD_TOKEN || fileVars.STRAPI_UPLOAD_TOKEN || undefined };
}
