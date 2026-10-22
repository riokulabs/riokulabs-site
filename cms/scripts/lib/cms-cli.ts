/**
 * Logic for scripts/cms.ts, a compact Content Manager CLI: argument parsing, type resolution, compact rendering
 * (lines, outlines), markdown to Strapi blocks, section edits, and the verify-after-write check. It talks to the admin
 * Content Manager routes (the ones the admin UI uses) through AdminClient, so tests drive it with a mocked fetch.
 *
 * Write model (checked against @strapi/content-manager 5.58):
 * - GET  /content-manager/collection-types/:uid/:documentId (or /single-types/:uid) returns the draft with media
 *   populated and every relation, top level and inside components, as {count}. Relation ids come from
 *   GET /content-manager/relations/:model/:id/:field (model = content type or component uid, id = documentId or
 *   component id).
 * - PUT on the same path updates the draft with only the keys sent; keys left out stay as they are.
 * - A component sent back with its id is updated in place, and relations left out of it are kept. So a body edit sends
 *   every section with its id, media as ids and no relation keys, except a relation that is being changed.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { AdminClient, UsageError } from './admin-http';
import { youtubeId } from '../../../web/src/lib/youtube';

// --- arguments ------------------------------------------------------------------------------------------------------

export const CM_FORBIDDEN =
  'the admin token lacks a Content Manager permission for this type (Read, Update, or Publish for publish/unpublish)';

export const USAGE = `Usage: npm run cms -- <command> ...

  types                                      Content types and their short names.
  list <type> [--fields a,b] [--status draft|published|modified] [--filter field=value]... [--limit N] [--sort f:asc]
  get <type> <documentId|single> [--fields a,b] [--outline] [--status published]
  set <type> <id> field=value ... [--json-value field='<json>']...
  section <type> <id> <n>                    Show one body section.
  section <type> <id> <n> [--image <fileId>] [--alt "..."] [--caption "..."] [--size wide] [--text-file post.md]
          [--title "..."] [--tone note] [--language ts] [--model <documentId>] [--url <YouTube URL>] [--set field=value]...
  section-insert <type> <id> <n|end> --kind rich-text|image|code|quote|callout|model-embed|youtube-embed [section options]
  section-move <type> <id> <from> <to>
  publish <type> <id> --yes
  unpublish <type> <id> --yes

<type> is a short name (blog-post) or a uid (api::blog-post.blog-post). <id> is a documentId, or "single" for a single
type. Sections are numbered from 1 (see get --outline). Writes change the draft only, then re-read it and check that
nothing else changed. --json prints the full JSON instead of the compact lines. There is no delete command.
Env: STRAPI_URL (default https://cms.rioku.dev), STRAPI_ADMIN_TOKEN (admin token with Content Manager permissions).`;

const VALUE_FLAGS = new Set([
  'fields', 'status', 'filter', 'limit', 'sort', 'image', 'alt', 'caption', 'size', 'text-file', 'json-value', 'kind',
  'language', 'tone', 'model', 'title', 'set', 'url',
]);
const REPEATABLE = new Set(['filter', 'json-value', 'set']);
const BOOL_FLAGS = new Set(['json', 'yes', 'outline', 'help']);
export const SECTION_FLAGS = ['image', 'alt', 'caption', 'size', 'text-file', 'title', 'tone', 'language', 'model', 'url', 'set'] as const;

const COMMANDS: Record<string, { pos: [number, number]; flags: string[] }> = {
  types: { pos: [0, 0], flags: ['json'] },
  list: { pos: [1, 1], flags: ['fields', 'status', 'filter', 'limit', 'sort', 'json'] },
  get: { pos: [2, 2], flags: ['fields', 'outline', 'status', 'json'] },
  set: { pos: [2, Infinity], flags: ['json-value'] },
  section: { pos: [3, 3], flags: [...SECTION_FLAGS, 'json'] },
  'section-insert': { pos: [3, 3], flags: ['kind', ...SECTION_FLAGS] },
  'section-move': { pos: [4, 4], flags: [] },
  publish: { pos: [2, 2], flags: ['yes'] },
  unpublish: { pos: [2, 2], flags: ['yes'] },
};

export interface Cli {
  cmd: string;
  pos: string[];
  flags: Record<string, string | boolean | string[] | undefined>;
}

export function parseCli(argv: string[]): Cli {
  const pos: string[] = [];
  const flags: Cli['flags'] = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const name = a.slice(2, eq < 0 ? undefined : eq);
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0) throw new UsageError(`--${name} takes no value`);
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      let v: string | undefined;
      if (eq >= 0) v = a.slice(eq + 1);
      else {
        v = argv[++i];
        if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new UsageError(`--${name} needs a value`);
      }
      if (REPEATABLE.has(name)) flags[name] = [...((flags[name] as string[]) ?? []), v];
      else if (flags[name] !== undefined) throw new UsageError(`--${name} given twice`);
      else flags[name] = v;
    } else throw new UsageError(`unknown option ${a}`);
  }
  const cmd = pos.shift() ?? '';
  if (flags.help || cmd === 'help' || !cmd) return { cmd: 'help', pos: [], flags };
  if (cmd === 'delete' || cmd === 'remove' || cmd === 'rm') throw new UsageError('there is no delete command: delete entries in the admin');
  const spec = COMMANDS[cmd];
  if (!spec) throw new UsageError(`unknown command ${cmd}`);
  const [min, max] = spec.pos;
  if (pos.length < min || pos.length > max) throw new UsageError(`${cmd}: expected ${min === max ? min : `at least ${min}`} argument(s), got ${pos.length}`);
  for (const f of Object.keys(flags)) if (f !== 'help' && !spec.flags.includes(f)) throw new UsageError(`${cmd} does not take --${f}`);
  if (cmd === 'set' && pos.slice(2).some((p) => !p.includes('='))) throw new UsageError('set: give changes as field=value');
  if (cmd === 'set' && pos.length === 2 && !listFlag(flags['json-value']).length) throw new UsageError('set: nothing to change (field=value or --json-value)');
  if ((cmd === 'publish' || cmd === 'unpublish') && !flags.yes) {
    throw new UsageError(`${cmd} changes the live site: check the entry first, then repeat with --yes`);
  }
  if (cmd === 'section-insert' && !flags.kind) throw new UsageError('section-insert needs --kind');
  return { cmd, pos, flags };
}

export const listFlag = (v: unknown): string[] => (v === undefined ? [] : (v as string[]));
export const csv = (v: unknown): string[] | undefined =>
  typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

/** "a=b=c" -> ["a", "b=c"]. */
export function splitAssign(s: string, what = 'field=value'): [string, string] {
  const i = s.indexOf('=');
  if (i <= 0) throw new UsageError(`expected ${what}, got "${s}"`);
  return [s.slice(0, i).trim(), s.slice(i + 1)];
}

/** "3" -> 3 (1-based), checked against the section count. "end" -> count + 1 when allowEnd. */
export function sectionNumber(s: string, count: number, allowEnd = false): number {
  if (allowEnd && s === 'end') return count + 1;
  const n = Number(s);
  const max = allowEnd ? count + 1 : count;
  if (!Number.isInteger(n) || n < 1 || n > max) throw new UsageError(`section number must be 1..${max}${allowEnd ? ' or end' : ''}, got "${s}"`);
  return n;
}

// --- schemas --------------------------------------------------------------------------------------------------------

export interface Attr {
  type: string;
  component?: string;
  components?: string[];
  repeatable?: boolean;
  multiple?: boolean;
  target?: string;
  relation?: string;
  enum?: string[];
}
export interface TypeSchema {
  uid: string;
  kind: 'collectionType' | 'singleType';
  attributes: Record<string, Attr>;
  info?: { singularName?: string; pluralName?: string; displayName?: string };
  options?: { draftAndPublish?: boolean };
  mainField?: string;
}
export interface Schemas { types: Map<string, TypeSchema>; components: Map<string, { uid: string; attributes: Record<string, Attr> }> }

export const SYSTEM = new Set(['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'locale', 'localizations', 'status']);

export async function loadSchemas(client: AdminClient): Promise<Schemas> {
  const [ct, comps, settings] = await Promise.all([
    client.get('/content-manager/content-types'),
    client.get('/content-manager/components'),
    client.get('/content-manager/content-types-settings'),
  ]);
  const main = new Map<string, string>((settings?.data ?? []).map((s: any) => [s.uid, s.settings?.mainField]));
  const types = new Map<string, TypeSchema>();
  for (const t of ct?.data ?? []) if (String(t.uid).startsWith('api::')) types.set(t.uid, { ...t, mainField: main.get(t.uid) });
  const components = new Map<string, { uid: string; attributes: Record<string, Attr> }>();
  for (const c of comps?.data ?? []) components.set(c.uid, c);
  return { types, components };
}

/** "blog-post", "blog-posts" or "api::blog-post.blog-post" -> the schema. */
export function resolveType(name: string, schemas: Schemas): TypeSchema {
  const direct = schemas.types.get(name);
  if (direct) return direct;
  const n = name.toLowerCase();
  for (const t of schemas.types.values()) {
    if (t.uid === `api::${n}.${n}` || t.info?.singularName === n || t.info?.pluralName === n) return t;
  }
  const names = [...schemas.types.values()].map((t) => t.info?.singularName ?? t.uid).sort();
  throw new UsageError(`unknown type "${name}". Types: ${names.join(', ')}`);
}

const isCollection = (t: TypeSchema) => t.kind === 'collectionType';
export function docPath(t: TypeSchema, id: string): string {
  if (isCollection(t)) {
    if (id === 'single') throw new UsageError(`${t.info?.singularName} is a collection type: give a documentId`);
    return `/content-manager/collection-types/${t.uid}/${encodeURIComponent(id)}`;
  }
  if (id !== 'single') throw new UsageError(`${t.info?.singularName} is a single type: use "single" as the id`);
  return `/content-manager/single-types/${t.uid}`;
}

export function attrsOf(uid: string, schemas: Schemas): Record<string, Attr> {
  const c = schemas.components.get(uid) ?? schemas.types.get(uid);
  if (!c) throw new Error(`no schema for ${uid}`);
  return c.attributes;
}

const isUserRelation = (a: Attr) => a.type === 'relation' && !!a.target && !a.target.startsWith('admin::');

// --- normalising values ---------------------------------------------------------------------------------------------

const OMIT = Symbol('omit');

/**
 * A field value as read (or as about to be written) -> 'write' form (components keep their id, media are ids,
 * relations left out) or 'compare' form (the same without component ids). Idempotent: works on either input.
 */
export function conv(value: unknown, attr: Attr, schemas: Schemas, mode: 'write' | 'compare'): unknown {
  switch (attr.type) {
    case 'relation':
      return OMIT;
    case 'media': {
      const id = (f: any) => (f && typeof f === 'object' ? f.id : f);
      if (attr.multiple) return ((value as unknown[]) ?? []).map(id);
      return value == null ? null : id(value);
    }
    case 'component':
      if (attr.repeatable) return ((value as unknown[]) ?? []).map((c) => convComponent(c, attr.component!, schemas, mode));
      return value == null ? null : convComponent(value, attr.component!, schemas, mode);
    case 'dynamiczone':
      return ((value as any[]) ?? []).map((c) => ({ __component: c.__component, ...convComponent(c, c.__component, schemas, mode) }));
    default:
      return value === undefined ? null : value;
  }
}

function convComponent(obj: any, uid: string, schemas: Schemas, mode: 'write' | 'compare'): Record<string, unknown> {
  const out: Record<string, unknown> = mode === 'write' && obj?.id != null ? { id: obj.id } : {};
  for (const [k, a] of Object.entries(attrsOf(uid, schemas))) {
    // Keep a relation change that is being written ({set|connect|disconnect}); read values ({count}) are dropped.
    if (a.type === 'relation') {
      const v = obj?.[k];
      if (mode === 'write' && v && typeof v === 'object' && ('set' in v || 'connect' in v || 'disconnect' in v)) out[k] = v;
      continue;
    }
    const v = conv(obj?.[k], a, schemas, mode);
    if (v !== OMIT) out[k] = v;
  }
  return out;
}

export function writableBody(body: unknown, attr: Attr, schemas: Schemas): any[] {
  return conv(body, attr, schemas, 'write') as any[];
}

export const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

// --- relations ------------------------------------------------------------------------------------------------------

/** documentIds of one relation field, in order. `model` is a content type uid or a component uid. */
export async function relationIds(client: AdminClient, model: string, id: string | number, field: string): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await client.get(`/content-manager/relations/${model}/${encodeURIComponent(String(id))}/${field}`, { page, pageSize: 100 });
    for (const x of r?.results ?? []) out.push(x.documentId);
    if (page >= (r?.pagination?.pageCount ?? 1)) break;
  }
  return out;
}

export interface Snapshot {
  data: any;
  top: Record<string, string[]>; // top-level relation field -> documentIds
  sections: Record<string, string[]>[]; // body section index -> relation field -> documentIds
}

export const dzField = (t: TypeSchema): string | undefined => Object.entries(t.attributes).find(([, a]) => a.type === 'dynamiczone')?.[0];

/** The draft plus every relation's ids (top level and in body sections), for before/after comparison. */
export async function snapshot(client: AdminClient, schemas: Schemas, t: TypeSchema, id: string, status = 'draft'): Promise<Snapshot> {
  const res = await client.get(docPath(t, id), { status });
  const data = res?.data;
  if (!data || !data.documentId) throw new Error(`${t.info?.singularName} ${id}: not found${status !== 'draft' ? ` (${status})` : ''}`);
  const top: Snapshot['top'] = {};
  for (const [k, a] of Object.entries(t.attributes)) {
    if (SYSTEM.has(k) || !isUserRelation(a)) continue;
    top[k] = await relationIds(client, t.uid, data.documentId, k);
  }
  const sections: Snapshot['sections'] = [];
  const dz = dzField(t);
  for (const s of dz ? ((data[dz] as any[]) ?? []) : []) {
    const rels: Record<string, string[]> = {};
    for (const [k, a] of Object.entries(attrsOf(s.__component, schemas))) {
      if (isUserRelation(a)) rels[k] = await relationIds(client, s.__component, s.id, k);
    }
    sections.push(rels);
  }
  return { data, top, sections };
}

// --- expectations and the verify-after-write check ------------------------------------------------------------------

export interface Expectation {
  /** Top-level fields that were asked to change (left out of the "unchanged" check). */
  fields: Set<string>;
  /**
   * For body edits: the body as sent (write form), the relation ids each section should have afterwards, and the
   * sections that were edited or inserted (0-based). Those are checked as a subset: every value sent must come back,
   * while fields not sent may hold the server's defaults. Every other section must come back exactly as it was.
   */
  body?: { sent: any[]; rels: Record<string, string[]>[]; targets: Set<number> };
}

/** Every non-null value in `want` is in `got` (null/undefined in `want` means "the server decides"). */
export function subsetMatch(want: unknown, got: unknown): boolean {
  if (want == null) return true;
  if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => subsetMatch(w, got[i]));
  if (typeof want === 'object') {
    if (!got || typeof got !== 'object') return false;
    return Object.entries(want).every(([k, w]) => subsetMatch(w, (got as Record<string, unknown>)[k]));
  }
  return want === got;
}

/** Everything that changed but was not asked for. Empty means the write did only what was asked. */
export function unexpectedChanges(t: TypeSchema, schemas: Schemas, before: Snapshot, after: Snapshot, exp: Expectation): string[] {
  const out: string[] = [];
  const dz = dzField(t);
  for (const [k, a] of Object.entries(t.attributes)) {
    if (SYSTEM.has(k) || exp.fields.has(k)) continue;
    if (k === dz && exp.body) continue;
    if (a.type === 'relation') {
      if (isUserRelation(a) && stable(before.top[k] ?? []) !== stable(after.top[k] ?? [])) out.push(`${k} (relation)`);
      continue;
    }
    if (stable(conv(before.data[k], a, schemas, 'compare')) !== stable(conv(after.data[k], a, schemas, 'compare'))) out.push(k);
  }
  if (dz && !exp.fields.has(dz)) {
    const dzAttr = t.attributes[dz];
    const want = conv(exp.body ? exp.body.sent : before.data[dz], dzAttr, schemas, 'compare') as any[];
    const got = conv(after.data[dz], dzAttr, schemas, 'compare') as any[];
    const wantRels = exp.body ? exp.body.rels : before.sections;
    if (want.length !== got.length) out.push(`${dz}: ${got.length} sections, expected ${want.length}`);
    else {
      want.forEach((w, i) => {
        const same = exp.body?.targets.has(i) ? w.__component === got[i].__component && subsetMatch(w, got[i]) : stable(w) === stable(got[i]);
        if (!same) out.push(`${dz} section ${i + 1} (${shortKind(got[i].__component)})`);
        else if (stable(wantRels[i] ?? {}) !== stable(after.sections[i] ?? {})) out.push(`${dz} section ${i + 1} (${shortKind(got[i].__component)}) relation`);
      });
    }
  }
  return out;
}

/** Save the pre-write draft (write form) so a failed check can be put right by hand. Returns the file. */
export function saveBackup(t: TypeSchema, schemas: Schemas, before: Snapshot, dir = os.tmpdir()): string {
  const data: Record<string, unknown> = { documentId: before.data.documentId };
  for (const [k, a] of Object.entries(t.attributes)) {
    if (SYSTEM.has(k)) continue;
    if (a.type === 'relation') data[k] = isUserRelation(a) ? { set: (before.top[k] ?? []).map((documentId) => ({ documentId })) } : undefined;
    else data[k] = conv(before.data[k], a, schemas, 'write');
  }
  const file = path.join(dir, `cms-cli-backup-${t.info?.singularName ?? 'entry'}-${before.data.documentId}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ uid: t.uid, data, sectionRelations: before.sections }, null, 1), { mode: 0o600 });
  return file;
}

export class VerifyError extends Error {}

/** PUT `payload` to the draft, re-read, and throw VerifyError if anything else changed. Returns the after-snapshot. */
export async function writeAndVerify(
  client: AdminClient,
  schemas: Schemas,
  t: TypeSchema,
  id: string,
  before: Snapshot,
  payload: Record<string, unknown>,
  exp: Expectation,
  backupDir?: string,
): Promise<Snapshot> {
  const backup = saveBackup(t, schemas, before, backupDir);
  await client.put(docPath(t, id), payload);
  const after = await snapshot(client, schemas, t, id);
  const bad = unexpectedChanges(t, schemas, before, after, exp);
  if (bad.length) {
    throw new VerifyError(
      `VERIFY FAILED: the save changed more than asked: ${bad.join('; ')}. Stop here and check the entry in the admin. ` +
        `The draft as it was before this write is saved in ${backup}.`,
    );
  }
  fs.rmSync(backup, { force: true });
  return after;
}

// --- rendering ------------------------------------------------------------------------------------------------------

export const shortKind = (uid: string) => uid.replace(/^sections\./, '');
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const q = (s: unknown, n = 60) => `"${clip(String(s ?? '').replace(/\s+/g, ' ').trim(), n)}"`;

type Block = { type: string; children?: any[]; level?: number; format?: string; [k: string]: unknown };

/** "3 paragraphs, 2 headings, 1 list". */
export function summarizeBlocks(blocks: unknown): string {
  const list = Array.isArray(blocks) ? (blocks as Block[]) : [];
  if (!list.length) return 'empty';
  const names: Record<string, [string, string]> = {
    paragraph: ['paragraph', 'paragraphs'], heading: ['heading', 'headings'], list: ['list', 'lists'],
    quote: ['quote', 'quotes'], code: ['code block', 'code blocks'], image: ['image', 'images'],
  };
  const counts = new Map<string, number>();
  for (const b of list) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${(names[k] ?? [k, k])[n === 1 ? 0 : 1]}`).join(', ');
}

const inlineText = (nodes: any[] = []): string => nodes.map((n) => (n.type === 'link' ? inlineText(n.children) : n.text ?? inlineText(n.children))).join('');
export const blocksText = (blocks: unknown): string =>
  (Array.isArray(blocks) ? (blocks as Block[]) : []).map((b) => (b.type === 'list' ? (b.children ?? []).map((li: any) => inlineText(li.children)).join(' ') : inlineText(b.children))).join(' ');

function mediaImage(img: any): string {
  if (!img) return 'none';
  const parts = [`file=${img.file?.id ?? img.file ?? 'none'}`];
  if (img.decorative) parts.push('decorative');
  else parts.push(`alt=${q(img.alt, 50)}`);
  if (img.caption) parts.push(`caption=${q(img.caption, 40)}`);
  return parts.join(' ');
}
function mediaVideo(v: any): string {
  if (!v) return 'none';
  const id = (f: any) => f?.id ?? f ?? 'none';
  return [`mp4=${id(v.mp4)}`, ...(v.webm ? [`webm=${id(v.webm)}`] : []), `poster=${id(v.poster)}`].join(' ');
}

/** One outline line for a body section. `rels` holds the section's relation documentIds. */
export function outlineLine(n: number, s: any, rels: Record<string, string[]> = {}): string {
  const kind = shortKind(s.__component);
  const rel = (k: string) => (rels[k]?.length ? rels[k].join(',') : 'none');
  const size = s.size ? ` size=${s.size}` : '';
  switch (s.__component) {
    case 'sections.rich-text':
      return `${n} ${kind} ${summarizeBlocks(s.content)} ${q(blocksText(s.content), 50)}`;
    case 'sections.image':
      return `${n} ${kind} ${mediaImage(s.image)}${size}`;
    case 'sections.gallery': {
      const items = (s.items ?? []) as any[];
      const files = items.map((it) => (it.kind === 'loop' ? `v${it.video?.mp4?.id ?? it.video?.mp4 ?? '?'}` : it.image?.file?.id ?? it.image?.file ?? '?'));
      return `${n} ${kind} ${items.length} items layout=${s.layout ?? 'grid'} files=${files.join(',')}`;
    }
    case 'sections.loop-video':
      return `${n} ${kind} ${mediaVideo(s.video)}${size}`;
    case 'sections.compare':
      return `${n} ${kind} before=${s.before?.file?.id ?? s.before?.file ?? 'none'} after=${s.after?.file?.id ?? s.after?.file ?? 'none'}${s.caption ? ` caption=${q(s.caption, 40)}` : ''}`;
    case 'sections.code':
      return `${n} ${kind} language=${s.language ?? '?'} ${String(s.code ?? '').split('\n').length} lines${s.filename ? ` filename=${s.filename}` : ''}`;
    case 'sections.callout':
      return `${n} ${kind} tone=${s.tone ?? 'note'}${s.title ? ` title=${q(s.title, 40)}` : ''} ${summarizeBlocks(s.body)}`;
    case 'sections.quote':
      return `${n} ${kind} ${q(s.text, 50)}${s.attribution ? ` attribution=${q(s.attribution, 30)}` : ''}`;
    case 'sections.model-embed':
      return `${n} ${kind} model=${rel('model')}${s.caption ? ` caption=${q(s.caption, 40)}` : ''}`;
    case 'sections.mod-card':
      return `${n} ${kind} mod=${rel('mod')}`;
    case 'sections.timeline-embed':
      return `${n} ${kind} family=${rel('family')} from=${s.fromStage ?? '-'} to=${s.toStage ?? '-'}`;
    case 'sections.stat-grid':
      return `${n} ${kind} ${(s.stats ?? []).length} stats`;
    case 'sections.youtube-embed':
      return `${n} ${kind} video=${youtubeId(s.url) ?? 'invalid'} title=${q(s.title, 40)}${s.caption ? ` caption=${q(s.caption, 40)}` : ''}${size}`;
    default: {
      const scalars = Object.entries(s).filter(([k, v]) => !['id', '__component'].includes(k) && v != null && typeof v !== 'object');
      return `${n} ${kind} ${scalars.map(([k, v]) => `${k}=${q(v, 30)}`).join(' ')}`.trimEnd();
    }
  }
}

export const outline = (body: any[], rels: Record<string, string[]>[] = []) => body.map((s, i) => outlineLine(i + 1, s, rels[i]));

/** A field value in one short line. */
export function shortValue(v: unknown, a?: Attr): string {
  if (v == null) return '-';
  if (a?.type === 'relation') return Array.isArray(v) ? v.join(',') || '-' : `(${(v as any)?.count ?? '?'})`;
  if (a?.type === 'blocks') return summarizeBlocks(v);
  if (a?.type === 'dynamiczone') return `${(v as unknown[]).length} sections (get --outline)`;
  if (a?.type === 'media') return Array.isArray(v) ? `files=${v.map((f: any) => f?.id ?? f).join(',')}` : `file=${(v as any)?.id ?? v}`;
  if (a?.type === 'component') {
    if (a.component === 'media.image') return mediaImage(v);
    if (a.component === 'media.video') return mediaVideo(v);
    if (Array.isArray(v)) return `${v.length} items`;
    const scalars = Object.entries(v as object).filter(([k, x]) => k !== 'id' && x != null && typeof x !== 'object');
    return scalars.map(([k, x]) => `${k}=${q(x, 30)}`).join(' ') || '{}';
  }
  if (typeof v === 'string') return q(v, 80);
  if (typeof v === 'object') return clip(JSON.stringify(v), 80);
  return String(v);
}

// --- markdown <-> blocks --------------------------------------------------------------------------------------------

type Inline = { type: 'text'; text: string; bold?: true; code?: true } | { type: 'link'; url: string; children: Inline[] };

const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i;

/** Inline markdown: **bold**, `code`, [text](url). Anything else is plain text. */
export function parseInline(s: string, bold = false): Inline[] {
  const out: Inline[] = [];
  const push = (text: string, marks: { bold?: boolean; code?: boolean } = {}) => {
    if (!text) return;
    const node: Inline = { type: 'text', text, ...(marks.bold ? { bold: true as const } : {}), ...(marks.code ? { code: true as const } : {}) };
    const last = out[out.length - 1];
    if (last && last.type === 'text' && node.type === 'text' && !!last.bold === !!node.bold && !!last.code === !!node.code) last.text += node.text;
    else out.push(node);
  };
  let i = 0;
  let buf = '';
  const flush = () => { push(buf, { bold }); buf = ''; };
  while (i < s.length) {
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) { flush(); push(s.slice(i + 1, end), { bold, code: true }); i = end + 1; continue; }
    }
    if (s.startsWith('**', i) && !bold) {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) { flush(); for (const n of parseInline(s.slice(i + 2, end), true)) n.type === 'text' ? push(n.text, { bold: true, code: n.code }) : out.push(n); i = end + 2; continue; }
    }
    if (s[i] === '[') {
      const m = s.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
      if (m) {
        if (!SAFE_URL.test(m[2])) throw new UsageError(`link URL must be http(s), mailto, / or #: ${m[2]}`);
        flush();
        out.push({ type: 'link', url: m[2], children: parseInline(m[1], bold) });
        i += m[0].length;
        continue;
      }
    }
    buf += s[i++];
  }
  flush();
  return out.length ? out : [{ type: 'text', text: '' }];
}

/**
 * A small markdown subset -> Strapi blocks: paragraphs (blank-line separated), # to ###### headings, "- " / "* " and
 * "1. " lists, plus the inline marks above. Fenced code, quotes, tables and images are refused rather than mangled.
 */
export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { format: 'ordered' | 'unordered'; items: string[] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ type: 'list', format: list.format, children: list.items.map((t) => ({ type: 'list-item', children: parseInline(t) })) });
    list = null;
  };
  md.replace(/\r\n?/g, '\n').split('\n').forEach((raw, idx) => {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) { endPara(); endList(); return; }
    if (/^(```|~~~|>|\||!\[)/.test(t)) throw new UsageError(`line ${idx + 1}: code fences, quotes, tables and images are not supported in --text-file; use a code/quote/image section`);
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { endPara(); endList(); blocks.push({ type: 'heading', level: h[1].length, children: parseInline(h[2].trim()) }); return; }
    const ul = t.match(/^[-*]\s+(.*)$/);
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      endPara();
      const format = ul ? 'unordered' : 'ordered';
      if (list && list.format !== format) endList();
      if (!list) list = { format, items: [] };
      list.items.push((ul ?? ol)![1]);
      return;
    }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ` ${t}`; return; }
    endList();
    para.push(t);
  });
  endPara();
  endList();
  if (!blocks.length) throw new UsageError('the text file is empty');
  return blocks;
}

function inlineToMd(nodes: any[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'link') return `[${inlineToMd(n.children)}](${n.url})`;
      let t = String(n.text ?? '');
      if (n.code) t = `\`${t}\``;
      if (n.bold) t = `**${t}**`;
      return t;
    })
    .join('');
}

/** Strapi blocks -> the same markdown subset, for reading a section. Unknown blocks show as [type]. */
export function blocksToMarkdown(blocks: unknown): string {
  return (Array.isArray(blocks) ? (blocks as Block[]) : [])
    .map((b) => {
      if (b.type === 'paragraph') return inlineToMd(b.children);
      if (b.type === 'heading') return `${'#'.repeat(b.level ?? 2)} ${inlineToMd(b.children)}`;
      if (b.type === 'list') return (b.children ?? []).map((li: any, i: number) => `${b.format === 'ordered' ? `${i + 1}.` : '-'} ${inlineToMd(li.children)}`).join('\n');
      if (b.type === 'quote') return `> ${inlineToMd(b.children)}`;
      if (b.type === 'code') return `\`\`\`\n${inlineToMd(b.children)}\n\`\`\``;
      return `[${b.type}]`;
    })
    .join('\n\n');
}

// --- values for set and section edits -------------------------------------------------------------------------------

/** A command-line string -> the value for attribute `a`. Objects and relations need --json-value. */
export function coerce(field: string, raw: string, a: Attr): unknown {
  switch (a.type) {
    case 'string': case 'text': case 'richtext': case 'uid': case 'email': case 'date': case 'datetime': case 'time':
      return raw;
    case 'enumeration':
      if (!a.enum?.includes(raw)) throw new UsageError(`${field} must be one of ${a.enum?.join(', ')}`);
      return raw;
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') throw new UsageError(`${field} must be true or false`);
      return raw === 'true';
    case 'integer': case 'biginteger': case 'decimal': case 'float': {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n) || ((a.type === 'integer' || a.type === 'biginteger') && !Number.isInteger(n))) throw new UsageError(`${field} must be a number`);
      return n;
    }
    case 'media':
      if (!a.multiple && /^\d+$/.test(raw)) return Number(raw);
      throw new UsageError(`${field} is a media field: give a file id${a.multiple ? ' list with --json-value' : ''}`);
    default:
      throw new UsageError(`${field} is a ${a.type} field: use --json-value ${field}='<json>'`);
  }
}

export interface SectionOpts {
  image?: string; alt?: string; caption?: string; size?: string; textFile?: string; title?: string; tone?: string;
  language?: string; model?: string; url?: string; set?: string[];
}

export function sectionOpts(flags: Cli['flags']): SectionOpts {
  const s = (k: string) => (flags[k] as string | undefined);
  return { image: s('image'), alt: s('alt'), caption: s('caption'), size: s('size'), textFile: s('text-file'), title: s('title'), tone: s('tone'), language: s('language'), model: s('model'), url: s('url'), set: listFlag(flags.set) };
}
export const hasSectionEdits = (o: SectionOpts) => Object.entries(o).some(([k, v]) => (k === 'set' ? (v as string[]).length > 0 : v !== undefined));

/** Text-like content each section kind takes from --text-file: blocks are converted from markdown, raw is kept. */
const TEXT_FIELD: Record<string, { field: string; blocks: boolean }> = {
  'sections.rich-text': { field: 'content', blocks: true },
  'sections.callout': { field: 'body', blocks: true },
  'sections.code': { field: 'code', blocks: false },
  'sections.quote': { field: 'text', blocks: false },
};

export const KINDS = ['rich-text', 'image', 'code', 'quote', 'callout', 'model-embed', 'youtube-embed'];

/**
 * Apply section options to one section (write form; a new section is just {__component}). Returns the new section,
 * the relation ids it should end with (for model-embed --model) and "field: old → new" lines.
 */
export function editSection(
  section: any,
  o: SectionOpts,
  schemas: Schemas,
  readText: (file: string) => string,
  rels: Record<string, string[]> = {},
): { section: any; rels: Record<string, string[]>; changes: string[] } {
  const uid = section.__component as string;
  const attrs = attrsOf(uid, schemas);
  const next = structuredClone(section);
  const nextRels = { ...rels };
  const changes: string[] = [];
  const not = (flag: string) => new UsageError(`--${flag} does not apply to ${shortKind(uid)} sections`);
  const setField = (obj: any, k: string, v: unknown, label = k, a?: Attr) => {
    const before = obj[k];
    obj[k] = v;
    if (stable(before ?? null) !== stable(v ?? null)) changes.push(`${label}: ${shortValue(before, a)} → ${shortValue(v, a)}`);
  };
  const scalar = (k: string, raw: string, flag = k) => {
    const a = attrs[k];
    if (!a) throw not(flag);
    setField(next, k, coerce(k, raw, a), k, a);
  };

  if (uid === 'sections.image') {
    if (o.image !== undefined || o.alt !== undefined || o.caption !== undefined) {
      const img = next.image ? { ...next.image } : {};
      if (!next.image && (o.image === undefined || o.alt === undefined)) throw new UsageError('a new image needs --image <fileId> and --alt');
      if (o.image !== undefined) {
        if (!/^\d+$/.test(o.image)) throw new UsageError('--image needs a numeric file id (from media:upload)');
        setField(img, 'file', Number(o.image), 'image.file');
      }
      if (o.alt !== undefined) {
        if (!o.alt.trim()) throw new UsageError('--alt cannot be empty');
        setField(img, 'alt', o.alt, 'image.alt');
      }
      if (o.caption !== undefined) setField(img, 'caption', o.caption || null, 'image.caption');
      next.image = img;
    }
  } else {
    if (o.image !== undefined) throw not('image');
    if (o.alt !== undefined) throw not('alt');
    if (o.caption !== undefined) scalar('caption', o.caption, 'caption');
  }
  if (o.url !== undefined) {
    if (uid !== 'sections.youtube-embed') throw not('url');
    // Same check as the site (web/src/lib/youtube.ts): a URL it would drop is refused here.
    if (!youtubeId(o.url)) throw new UsageError('--url must be a YouTube watch, youtu.be, Shorts or embed URL (https), or an 11-character video id');
    scalar('url', o.url.trim(), 'url');
  }
  if (o.size !== undefined) scalar('size', o.size, 'size');
  if (o.title !== undefined) scalar('title', o.title, 'title');
  if (o.tone !== undefined) scalar('tone', o.tone, 'tone');
  if (o.language !== undefined) scalar('language', o.language, 'language');
  if (o.textFile !== undefined) {
    const tf = TEXT_FIELD[uid];
    if (!tf) throw not('text-file');
    const text = readText(o.textFile);
    const before = next[tf.field];
    next[tf.field] = tf.blocks ? markdownToBlocks(text) : text.replace(/\s+$/, '');
    if (stable(before ?? null) !== stable(next[tf.field])) {
      changes.push(tf.blocks ? `${tf.field}: ${summarizeBlocks(before)} → ${summarizeBlocks(next[tf.field])}` : `${tf.field}: ${shortValue(before)} → ${shortValue(next[tf.field])}`);
    }
  }
  if (o.model !== undefined) {
    if (uid !== 'sections.model-embed') throw not('model');
    const was = (rels.model ?? []).join(',') || '-';
    next.model = { set: [{ documentId: o.model }] };
    nextRels.model = [o.model];
    if (was !== o.model) changes.push(`model: ${was} → ${o.model}`);
  }
  for (const kv of o.set ?? []) {
    const [k, raw] = splitAssign(kv);
    if (k === 'id' || k === '__component') throw new UsageError(`--set cannot change ${k}`);
    scalar(k, raw, `set ${k}`);
  }
  return { section: next, rels: nextRels, changes };
}

/** A new section for section-insert, with the defaults the admin would give it. */
export function newSection(kind: string, o: SectionOpts, schemas: Schemas, readText: (f: string) => string) {
  if (!KINDS.includes(kind)) throw new UsageError(`--kind must be one of ${KINDS.join(', ')}`);
  const uid = `sections.${kind}`;
  const base: any = { __component: uid };
  if (kind === 'image') base.size = 'wide';
  if (kind === 'callout') base.tone = 'note';
  if (kind === 'code') base.language = 'text';
  if (kind === 'youtube-embed') base.size = 'wide';
  const r = editSection(base, o, schemas, readText);
  if (kind === 'image' && !r.section.image) throw new UsageError('an image section needs --image <fileId> and --alt');
  if (kind in { 'rich-text': 1, quote: 1, code: 1 } && r.section[TEXT_FIELD[uid].field] === undefined) throw new UsageError(`a ${kind} section needs --text-file`);
  if (kind === 'model-embed' && !r.section.model) throw new UsageError('a model-embed section needs --model <documentId>');
  if (kind === 'callout' && r.section.body === undefined) throw new UsageError('a callout section needs --text-file');
  if (kind === 'youtube-embed' && (!r.section.url || !String(r.section.title ?? '').trim())) throw new UsageError('a youtube-embed section needs --url and --title');
  return r;
}

/** Move element `from` (1-based) to position `to` (1-based). */
export function move<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  const [x] = out.splice(from - 1, 1);
  out.splice(to - 1, 0, x);
  return out;
}

/** The status a list/get line shows: draft, published, or modified (published with newer draft changes). */
export const statusOf = (d: any) => d?.status ?? (d?.publishedAt ? 'published' : 'draft');

/** Content Manager list query for list --status/--filter/--sort/--limit. */
export function listQuery(o: { status?: string; filters: string[]; limit?: string; sort?: string }, t: TypeSchema): Record<string, string | number> {
  const query: Record<string, string | number> = { page: 1, pageSize: 10, sort: o.sort ?? 'updatedAt:desc' };
  if (o.limit !== undefined) {
    const n = Number(o.limit);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new UsageError('--limit must be 1..100');
    query.pageSize = n;
  }
  if (o.status === 'draft') Object.assign(query, { status: 'draft', publicationFilter: 'never-published' });
  else if (o.status === 'published') query.status = 'published';
  else if (o.status === 'modified') query.publicationStatusFilter = 'published-modified';
  else if (o.status !== undefined) throw new UsageError('--status must be draft, published or modified');
  o.filters.forEach((f, i) => {
    const [k, v] = splitAssign(f);
    const a = t.attributes[k];
    if (!a && !['documentId', 'id', 'createdAt', 'updatedAt', 'publishedAt'].includes(k)) throw new UsageError(`--filter: ${t.info?.singularName} has no field ${k}`);
    if (a && ['relation', 'component', 'dynamiczone', 'media', 'blocks', 'json'].includes(a.type)) throw new UsageError(`--filter works on plain fields; ${k} is a ${a.type}`);
    query[`filters[$and][${i}][${k}][$eq]`] = v;
  });
  return query;
}
