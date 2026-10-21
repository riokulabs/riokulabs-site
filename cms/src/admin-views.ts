/**
 * Content Manager view settings ("Configure the view") kept in code.
 *
 * Strapi stores these in the database (core store, key `plugin_content_manager_configuration_content_types::<uid>`
 * and `..._components::<uid>`), not in the schema files. At startup, after the Content Manager has synced its own
 * defaults, this writes the settings from admin-views-data.ts into that store:
 * - only the keys it owns: entry title (mainField), default sort, list columns, edit-view rows, and field
 *   labels/descriptions/placeholders. Everything else (page size, filters, an editor's other choices) is kept.
 * - only when the spec for that type changed since it was last applied (a fingerprint per type is kept in the core
 *   store), so a change made in the admin survives restarts until the spec here changes.
 * - fields that exist in the schema but not in the spec are appended to the edit view, never hidden.
 * ADMIN_VIEWS=off skips it; ADMIN_VIEWS=force re-applies every type.
 */
import crypto from 'node:crypto';
import type { Core } from '@strapi/strapi';
import { COMPONENT_VIEWS, CONTENT_TYPE_VIEWS, SYSTEM_FIELDS } from './admin-views-data';

export type FieldMeta = { label?: string; description?: string; placeholder?: string };
export type EditRow = Array<[field: string, size: number]>;
export interface ViewSpec {
  /** The field used as the entry title in lists, relations and collapsed components. */
  mainField?: string;
  sort?: [field: string, order: 'ASC' | 'DESC'];
  list?: string[];
  edit?: EditRow[];
  fields?: Record<string, FieldMeta>;
}

type Attr = { type: string; relation?: string; relationType?: string; target?: string; targetModel?: string };
export type Model = { uid: string; attributes: Record<string, Attr> };
type Meta = { edit: Record<string, unknown>; list: Record<string, unknown> };
export interface CmConfiguration {
  settings: Record<string, unknown>;
  metadatas: Record<string, Meta>;
  layouts: { list: string[]; edit: Array<Array<{ name: string; size: number }>> };
}

const STORE = { type: 'core', name: 'admin_views', key: 'fingerprints' } as const;
/** Bump when the merge logic changes in a way that should re-apply every type. */
const LOGIC_VERSION = 1;

// Mirrors @strapi/content-manager (services/utils/configuration/attributes.js and services/field-sizes.js, 5.58).
const SYSTEM = new Set(['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'locale', 'localizations']);
const NON_LISTABLE = new Set(['json', 'password', 'richtext', 'dynamiczone', 'blocks']);
const NON_SORTABLE = new Set(['component', 'json', 'media', 'richtext', 'dynamiczone', 'blocks']);
const FULL_WIDTH = new Set(['dynamiczone', 'component', 'json', 'richtext', 'blocks']);
const SMALL = new Set(['checkbox', 'boolean', 'date', 'time', 'biginteger', 'decimal', 'float', 'integer', 'number']);
const relationKind = (a: Attr) => a.relationType ?? a.relation ?? '';

export const isEditable = (m: Model, name: string) => name in m.attributes && !SYSTEM.has(name);
export const isListable = (m: Model, name: string) => {
  const a = m.attributes[name];
  if (!a || NON_LISTABLE.has(a.type)) return false;
  if (a.type === 'relation' && relationKind(a).toLowerCase().includes('morph')) return false;
  return true;
};
export const isSortable = (m: Model, name: string) => {
  const a = m.attributes[name];
  if (!a || NON_SORTABLE.has(a.type)) return false;
  if (a.type === 'relation') return ['oneToOne', 'manyToOne'].includes(relationKind(a));
  return true;
};
export const defaultSize = (a: Attr) => (FULL_WIDTH.has(a.type) ? 12 : SMALL.has(a.type) ? 4 : 6);
export const sizeAllowed = (a: Attr, size: number) =>
  Number.isInteger(size) && size > 0 && size <= 12 && (!FULL_WIDTH.has(a.type) || size === 12);

/** Problems with a spec against a model; empty when the spec is fully valid. Used by the unit test and at startup. */
export function specProblems(spec: ViewSpec, m: Model, opts: { component?: boolean } = {}): string[] {
  const p: string[] = [];
  if (spec.mainField && !(isListable(m, spec.mainField) && isSortable(m, spec.mainField))) p.push(`mainField ${spec.mainField} is not a sortable field`);
  if (spec.sort && !(isSortable(m, spec.sort[0]) || spec.sort[0] === 'updatedAt' || spec.sort[0] === 'createdAt')) p.push(`sort ${spec.sort[0]} is not sortable`);
  for (const f of spec.list ?? []) if (!isListable(m, f) && !(f in SYSTEM_FIELDS)) p.push(`list column ${f} is not listable`);
  const seen = new Set<string>();
  for (const row of spec.edit ?? []) {
    const total = row.reduce((s, [, n]) => s + n, 0);
    if (total > 12) p.push(`edit row ${row.map(([f]) => f).join(', ')} is wider than 12`);
    for (const [f, n] of row) {
      if (!isEditable(m, f)) p.push(`edit field ${f} is not an editable field`);
      else if (!sizeAllowed(m.attributes[f], n)) p.push(`edit field ${f} cannot be ${n} wide`);
      if (seen.has(f)) p.push(`edit field ${f} appears twice`);
      seen.add(f);
    }
  }
  if (spec.edit && !opts.component) {
    for (const f of Object.keys(m.attributes)) if (isEditable(m, f) && !seen.has(f)) p.push(`edit view is missing ${f}`);
  }
  for (const f of Object.keys(spec.fields ?? {})) if (!(f in m.attributes)) p.push(`field ${f} does not exist`);
  return p;
}

export const fingerprint = (spec: ViewSpec) =>
  crypto.createHash('sha256').update(JSON.stringify({ v: LOGIC_VERSION, spec, system: SYSTEM_FIELDS })).digest('hex').slice(0, 16);

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x ?? null)) ?? ({} as T);

/**
 * Pure: the configuration to store, given what is stored now. Only the owned keys change; anything invalid in the
 * spec is skipped rather than written.
 */
export function mergeConfiguration(
  current: Partial<CmConfiguration>,
  spec: ViewSpec,
  m: Model,
  mainFieldOf: (targetUid: string) => string | undefined = () => undefined,
): CmConfiguration {
  const settings = { ...clone(current.settings ?? {}) };
  if (spec.mainField && isListable(m, spec.mainField) && isSortable(m, spec.mainField)) settings.mainField = spec.mainField;
  if (spec.sort && (isSortable(m, spec.sort[0]) || spec.sort[0] in m.attributes)) {
    settings.defaultSortBy = spec.sort[0];
    settings.defaultSortOrder = spec.sort[1];
  }

  const metadatas: Record<string, Meta> = clone(current.metadatas ?? {});
  const meta = (f: string): Meta => {
    const x = (metadatas[f] ??= { edit: {}, list: {} });
    x.edit ??= {};
    x.list ??= {};
    return x;
  };
  const labels: Record<string, FieldMeta> = { ...SYSTEM_FIELDS, ...(spec.fields ?? {}) };
  for (const [f, fm] of Object.entries(labels)) {
    if (!(f in m.attributes)) continue;
    const x = meta(f);
    if (fm.label) {
      x.edit.label = fm.label;
      x.list.label = fm.label;
    }
    if (!isEditable(m, f)) continue;
    if (fm.description !== undefined) x.edit.description = fm.description;
    if (fm.placeholder !== undefined) x.edit.placeholder = fm.placeholder;
  }
  // Relation pickers show the target's entry title.
  for (const [f, a] of Object.entries(m.attributes)) {
    if (a.type !== 'relation' || !isEditable(m, f)) continue;
    const target = a.targetModel ?? a.target;
    const mf = target ? mainFieldOf(target) : undefined;
    if (mf) meta(f).edit.mainField = mf;
  }

  const layouts = clone(current.layouts ?? { list: [], edit: [] });
  layouts.list ??= [];
  layouts.edit ??= [];
  if (spec.list) {
    const list = spec.list.filter((f) => isListable(m, f));
    if (list.length) layouts.list = list;
  }
  if (spec.edit) {
    const placed = new Set<string>();
    const edit: CmConfiguration['layouts']['edit'] = [];
    for (const row of spec.edit) {
      const r = row
        .filter(([f, n]) => isEditable(m, f) && !placed.has(f) && sizeAllowed(m.attributes[f], n))
        .map(([name, size]) => (placed.add(name), { name, size }));
      if (r.length && r.reduce((s, e) => s + e.size, 0) <= 12) edit.push(r);
      else r.forEach((e) => placed.delete(e.name));
    }
    // Never hide a field: anything not placed goes at the end, at its default width.
    let tail: Array<{ name: string; size: number }> = [];
    for (const f of Object.keys(m.attributes)) {
      if (!isEditable(m, f) || placed.has(f)) continue;
      const size = defaultSize(m.attributes[f]);
      if (tail.reduce((s, e) => s + e.size, 0) + size > 12) {
        edit.push(tail);
        tail = [];
      }
      tail.push({ name: f, size });
    }
    if (tail.length) edit.push(tail);
    if (edit.length) layouts.edit = edit;
  }
  return { settings, metadatas, layouts };
}

type CmService = {
  findConfiguration(model: { uid: string }): Promise<CmConfiguration & { uid: string }>;
  updateConfiguration(model: { uid: string }, conf: CmConfiguration): Promise<unknown>;
};

/** Apply the specs. Safe to run on every start. Never throws: a problem is logged and the type is skipped. */
export async function applyAdminViews(strapi: Core.Strapi): Promise<void> {
  const mode = (process.env.ADMIN_VIEWS ?? '').toLowerCase();
  if (mode === 'off') return;
  const cm = strapi.plugin('content-manager');
  if (!cm) return;
  const store = strapi.store({ ...STORE });
  const applied: Record<string, string> = ((await store.get()) as Record<string, string>) ?? {};
  const next = { ...applied };
  const mainFieldOf = (uid: string) => CONTENT_TYPE_VIEWS[uid]?.mainField;
  let changed = 0;

  const run = async (kind: 'content-types' | 'components', uid: string, spec: ViewSpec) => {
    const key = `${kind}::${uid}`;
    const fp = fingerprint(spec);
    if (mode !== 'force' && applied[key] === fp) return;
    try {
      const service = cm.service(kind) as unknown as CmService;
      const registry = (kind === 'components' ? strapi.components : strapi.contentTypes) as unknown as Record<string, Model>;
      const model = registry[uid];
      if (!model) return void strapi.log.warn(`[admin-views] ${uid} does not exist; skipped`);
      const cmModel = ((cm.service('data-mapper') as any).toContentManagerModel(model) as Model) ?? model;
      const problems = specProblems(spec, cmModel, { component: kind === 'components' });
      if (problems.length) strapi.log.warn(`[admin-views] ${uid}: ${problems.join('; ')} (skipped those parts)`);
      const current = await service.findConfiguration({ uid });
      const merged = mergeConfiguration(current, spec, cmModel, mainFieldOf);
      await service.updateConfiguration({ uid }, merged);
      next[key] = fp;
      changed++;
    } catch (e) {
      strapi.log.warn(`[admin-views] could not apply the view settings for ${uid}: ${(e as Error).message}`);
    }
  };

  for (const [uid, spec] of Object.entries(CONTENT_TYPE_VIEWS)) await run('content-types', uid, spec);
  for (const [uid, spec] of Object.entries(COMPONENT_VIEWS)) await run('components', uid, spec);
  if (changed) {
    await store.set({ value: next });
    strapi.log.info(`[admin-views] applied the view settings for ${changed} type(s)`);
  }
}
