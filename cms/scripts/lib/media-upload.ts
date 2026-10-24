/**
 * Pure helpers for scripts/media-upload.ts: argument parsing, name hygiene, refusal rules, metadata stripping and the
 * multipart request. No Strapi imports and no network, so tests/media-upload.test.ts covers them with a mocked fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isIpExemptFolder, loadPrivacyConfig, loadPrivacyLocal } from '../../src/utils/privacy';
import { AdminClient, checkUrl, DEFAULT_URL, httpError, readEnv, UsageError, type Env } from './admin-http';

export { checkUrl, DEFAULT_URL, readEnv, UsageError, type Env };
export const MAX_BYTES = 20 * 1024 * 1024;

export interface Options {
  files: string[];
  alt?: string;
  decorative: boolean;
  caption?: string;
  name?: string;
  folder?: string;
  createFolder: boolean;
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

export const USAGE = `Usage: npm run media:upload -- <file|glob>... --alt "what the picture shows" [options]

Options:
  --alt "<text>"      Alt text (required unless --decorative). Also the source of the file name.
  --decorative        The image is decorative: empty alt text. Needs --name or a neutral file name.
  --caption "<text>"  Caption shown under the image.
  --name "<slug>"     File name to use instead of one made from the alt text.
  --folder "<path>"   Media Library folder, for example "Blog/Server rack post". Needs STRAPI_ADMIN_TOKEN.
  --create-folder     Create the missing parts of --folder instead of refusing.
  --dry-run           Check and print what would be uploaded; send nothing.
  --force             Allow files over 20 MB (the server still caps uploads at 25 MB).

Env: STRAPI_URL (default ${DEFAULT_URL}).
  STRAPI_ADMIN_TOKEN   Admin token with Media Library permissions only. Preferred; needed for --folder.
  STRAPI_UPLOAD_TOKEN  Content API token (Upload upload + find), used when no admin token is set. No folders.
Prints one JSON line per uploaded file: {"id","documentId","url","name",...}.`;

/** Parse argv (without node and script). Throws UsageError on anything it does not understand. */
export function parseArgs(argv: string[]): Options {
  const o: Options = { files: [], decorative: false, createFolder: false, dryRun: false, force: false, help: false };
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
      case '--folder': o.folder = take(); break;
      case '--create-folder': o.createFolder = true; break;
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
  if (o.folder !== undefined) o.folder = parseFolderPath(o.folder).join('/');
  if (o.createFolder && o.folder === undefined) throw new UsageError('--create-folder needs --folder');
  return o;
}

/**
 * "Blog/Server rack post" -> ["Blog", "Server rack post"]. Leading and trailing slashes are ignored and each part is
 * trimmed (Strapi folder names cannot contain "/" or start or end with a space); empty parts are refused.
 */
export function parseFolderPath(s: string): string[] {
  const parts = s.trim().replace(/^\/+|\/+$/g, '').split('/').map((p) => p.trim());
  if (parts.some((p) => !p)) throw new UsageError(`--folder "${s}" is not a folder path like "Blog/Server rack post"`);
  return parts;
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
  // From the first scan to the end-of-image marker. Inside entropy-coded data 0xFF is always followed by 0x00
  // (stuffing), a restart marker or a fill byte; anything else is a marker segment (progressive JPEGs put tables and
  // further scans here), which is skipped by its length. Bytes after EOI are dropped: they are not part of the image
  // and can carry hidden data.
  let j = i;
  let end = -1;
  while (j + 1 < buf.length) {
    if (buf[j] !== 0xff) { j++; continue; }
    const m = buf[j + 1];
    if (m === 0xff) { j++; continue; }
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) { j += 2; continue; }
    if (m === 0xd9) { end = j + 2; break; }
    if (j + 4 > buf.length) break;
    j += 2 + buf.readUInt16BE(j + 2);
  }
  if (end < 0) throw new Error('corrupt JPEG: no end-of-image marker');
  if (end < buf.length) removed++;
  parts.push(buf.subarray(i, end));
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

/**
 * The terms that apply to an upload into `folder`. Blog media (a folder under "Blog/", see isIpExemptFolder in
 * src/utils/privacy.ts) may name third-party IP in its alt, caption and name: blog posts can talk about what inspired
 * a mod. Every other upload keeps the IP check; the private and retired-name checks apply everywhere.
 */
export function termsForFolder(terms: Term[], folder: string | undefined): Term[] {
  return isIpExemptFolder(folder) ? terms.filter((t) => t.kind !== 'IP') : terms;
}

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

  const hits = privacyHits({ 'file name': path.basename(source), 'upload name': name, alt: opts.alt, caption: opts.caption, folder: opts.folder }, termsForFolder(terms, opts.folder));
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

export interface Uploaded { id: number; documentId: string; url: string; name: string; mime: string; size: number; alternativeText: string | null }

export type RouteKind = 'admin' | 'content';

/**
 * Upload one file and return the created file.
 * - 'content': POST /api/upload with an API token. Always lands in "API Uploads" (fileInfo has no folder there).
 * - 'admin': POST /upload, the Media Library's own route, with an admin token (needs plugin::upload.assets.create).
 *   Same multipart shape as the admin UI: `files` plus a JSON `fileInfo` whose `folder` is the folder id.
 */
export async function uploadOne(
  baseUrl: string,
  token: string,
  file: Pick<Planned, 'name' | 'mime' | 'data'>,
  info: { alternativeText: string; caption?: string; folder?: number },
  fetchImpl: typeof fetch = fetch,
  route: RouteKind = 'content',
): Promise<Uploaded> {
  if (route === 'content' && info.folder !== undefined) throw new Error('the Content API cannot file uploads into a folder');
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
  form.append(
    'fileInfo',
    JSON.stringify({
      name: file.name,
      alternativeText: info.alternativeText,
      ...(info.caption ? { caption: info.caption } : {}),
      ...(info.folder !== undefined ? { folder: info.folder } : {}),
    }),
  );
  const endpoint = route === 'admin' ? '/upload' : '/api/upload';
  const res = await fetchImpl(`${baseUrl}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`upload failed: ${uploadError(res.status, text, route)}`);
  const body = JSON.parse(text);
  const f = Array.isArray(body) ? body[0] : body;
  if (!f?.id) throw new Error('upload response has no file');
  const url = typeof f.url === 'string' && f.url.startsWith('/') ? `${baseUrl}${f.url}` : f.url;
  return { id: f.id, documentId: f.documentId, url, name: f.name, mime: f.mime, size: f.size, alternativeText: f.alternativeText ?? null };
}

const MEDIA_FORBIDDEN = 'the admin token lacks a Media Library permission: Access the Media Library, Create (upload)';
const uploadError = (status: number, text: string, route: RouteKind) =>
  httpError(status, text, { admin: route === 'admin', forbiddenHint: MEDIA_FORBIDDEN });

/**
 * Pick the route: the admin route when STRAPI_ADMIN_TOKEN is set, else the Content API with STRAPI_UPLOAD_TOKEN.
 * --folder needs the admin route. A dry run may go without a token: it sends nothing.
 */
export function selectRoute(env: Env, opts: Pick<Options, 'folder' | 'dryRun'>): { kind: RouteKind; token?: string } {
  if (env.adminToken) return { kind: 'admin', token: env.adminToken };
  if (opts.folder !== undefined) {
    throw new UsageError(
      '--folder needs STRAPI_ADMIN_TOKEN: the Strapi 5.58 Content API (STRAPI_UPLOAD_TOKEN) always puts uploads in ' +
        'the "API Uploads" folder. Set up an admin token (scripts/README-media-upload.md) or move the file afterwards ' +
        'with the MCP media_move_assets tool.',
    );
  }
  if (!opts.dryRun && !env.token) throw new UsageError('neither STRAPI_ADMIN_TOKEN nor STRAPI_UPLOAD_TOKEN is set (environment or cms/.env)');
  return { kind: 'content', token: env.token };
}

// --- Media Library folders (admin route only) -----------------------------------------------------------------------

export interface FolderNode { id: number; name: string; children?: FolderNode[] }

const adminJson = (baseUrl: string, token: string, method: 'GET' | 'POST', route: string, fetchImpl: typeof fetch, body?: unknown) =>
  new AdminClient(baseUrl, token, fetchImpl, MEDIA_FORBIDDEN).request(method, route, { body });

/** GET /upload/folder-structure: every folder as a tree of {id, name, children} (needs plugin::upload.read). */
export async function fetchFolderTree(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<FolderNode[]> {
  const body = await adminJson(baseUrl, token, 'GET', '/upload/folder-structure', fetchImpl);
  if (!Array.isArray(body?.data)) throw new Error('folder list response has no data');
  return body.data;
}

/** One level: the exact name, else the only case-insensitive match. */
function matchChild(children: FolderNode[], name: string): FolderNode | undefined {
  const exact = children.find((c) => c.name === name);
  if (exact) return exact;
  const loose = children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * Walk the tree along `parts`. `found` is how many parts matched, `node` the deepest match (undefined: the root),
 * `children` the folders at the level where matching stopped.
 */
export function findFolder(
  tree: FolderNode[],
  parts: string[],
): { found: number; node?: FolderNode; children: FolderNode[]; matched: string[] } {
  let children = tree;
  let node: FolderNode | undefined;
  const matched: string[] = [];
  for (const part of parts) {
    const next = matchChild(children, part);
    if (!next) break;
    node = next;
    children = next.children ?? [];
    matched.push(next.name);
  }
  return { found: matched.length, node, children, matched };
}

export interface ResolvedFolder { id?: number; path: string; created: string[]; wouldCreate: string[] }

/**
 * Find the folder for a path like "Blog/Server rack post". With `create`, missing parts are made one level at a time
 * with POST /upload/folders {name, parent} (needs plugin::upload.assets.create); without it, refuse and list the
 * folders at the level where the path stopped matching. A dry run only looks and reports what it would create.
 */
export async function resolveFolder(
  baseUrl: string,
  token: string,
  folderPath: string,
  o: { create: boolean; dryRun: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedFolder> {
  const parts = parseFolderPath(folderPath);
  const tree = await fetchFolderTree(baseUrl, token, fetchImpl);
  const { found, node, children, matched } = findFolder(tree, parts);
  // Report the names as stored in Strapi for the matched part ("blog/test" -> "Blog/Test"), as typed for the rest.
  const canonical = [...matched, ...parts.slice(found)];
  const prefix = (n: number) => canonical.slice(0, n).join('/');
  if (found === parts.length) return { id: node!.id, path: prefix(found), created: [], wouldCreate: [] };

  const missing = parts.slice(found);
  if (!o.create) {
    const where = found ? `"${prefix(found)}"` : 'the Media Library root';
    const names = children.map((c) => `"${c.name}"`).sort();
    const shown = names.slice(0, 15).join(', ') + (names.length > 15 ? ` and ${names.length - 15} more` : '');
    const list = names.length ? `Folders in ${where}: ${shown}.` : `There are no folders in ${where}.`;
    throw new Error(`folder "${folderPath}" not found: ${where} has no "${missing[0]}". ${list} Pass --create-folder to create it.`);
  }
  if (o.dryRun) return { path: prefix(parts.length), created: [], wouldCreate: missing.map((_, k) => prefix(found + k + 1)) };

  let parent: number | null = node?.id ?? null;
  const created: string[] = [];
  for (const [k, name] of missing.entries()) {
    const body = await adminJson(baseUrl, token, 'POST', '/upload/folders', fetchImpl, { name, parent });
    const id = body?.data?.id;
    if (typeof id !== 'number') throw new Error(`creating folder "${prefix(found + k + 1)}" returned no id`);
    parent = id;
    created.push(prefix(found + k + 1));
  }
  return { id: parent!, path: prefix(parts.length), created, wouldCreate: [] };
}
