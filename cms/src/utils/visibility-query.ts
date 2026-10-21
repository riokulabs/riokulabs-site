/**
 * Schema-aware query hardening and response stripping for the visibility guard (CONTENT-MODEL §6.2).
 *
 * Pure functions: the schema is passed in as a lookup (uid → attributes), so tests can use a fake schema.
 *
 * Policy for non-bypassed callers (security review 2026-10-19):
 * 1. populate: every populated relation into a visibility-bearing type gets `visibility $in allowed` ANDed into its
 *    filters and `visibility` forced into its `fields` (recursively, including `*`, `true`, dotted strings and DZ
 *    `on` fragments). After the query, any populated object of such a type whose visibility is missing or not allowed
 *    is removed (fail closed).
 * 2. status: forced to `published` (no draft reads).
 * 3. filters and sort: REJECTED (400) when they traverse a relation into a visibility-bearing type, at the root or
 *    inside populate. We chose rejection over ANDing visibility into nested filters because it is simpler to reason
 *    about and the site build never needs relational filters (it filters related data client-side).
 */
import type { Visibility } from './privacy';

export type Attr = { type: string; target?: string; component?: string; components?: string[]; relation?: string };
export type SchemaLookup = (uid: string) => Record<string, Attr> | undefined;

export class GuardRejection extends Error {}

const LOGICAL = new Set(['$and', '$or', '$not']);

export function hasVisibility(schema: SchemaLookup, uid: string | undefined): boolean {
  return !!uid && !!schema(uid)?.visibility;
}

/** Throws GuardRejection when a filter object traverses a relation into a visibility-bearing type. */
export function assertFiltersSafe(filters: unknown, uid: string, schema: SchemaLookup, at = 'filters'): void {
  if (!filters || typeof filters !== 'object') return;
  if (Array.isArray(filters)) {
    filters.forEach((f, i) => assertFiltersSafe(f, uid, schema, `${at}[${i}]`));
    return;
  }
  const attrs = schema(uid) ?? {};
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (LOGICAL.has(key)) {
      assertFiltersSafe(value, uid, schema, `${at}.${key}`);
      continue;
    }
    if (key.startsWith('$')) continue; // operator on the current field
    const attr = attrs[key];
    if (!attr) continue; // scalar ids etc.; Strapi's strict params reject unknown keys
    if (attr.type === 'relation') {
      if (hasVisibility(schema, attr.target)) {
        throw new GuardRejection(`Filtering through the relation "${at}.${key}" is not allowed for this token.`);
      }
      assertFiltersSafe(value, attr.target!, schema, `${at}.${key}`);
    } else if (attr.type === 'component' && attr.component) {
      assertFiltersSafe(value, attr.component, schema, `${at}.${key}`);
    }
  }
}

/** Throws GuardRejection when a sort key walks a relation into a visibility-bearing type. */
export function assertSortSafe(sort: unknown, uid: string, schema: SchemaLookup): void {
  if (!sort) return;
  const keys: string[] = [];
  const collect = (s: unknown) => {
    if (typeof s === 'string') s.split(',').forEach((k) => keys.push(k.split(':')[0].trim()));
    else if (Array.isArray(s)) s.forEach(collect);
    else if (s && typeof s === 'object') {
      const walk = (o: any, prefix: string) => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === 'object') walk(v, `${prefix}${k}.`);
          else keys.push(`${prefix}${k}`);
        }
      };
      walk(s, '');
    }
  };
  collect(sort);
  for (const key of keys) {
    let cur = uid;
    for (const seg of key.split('.').slice(0, -1)) {
      const attr = schema(cur)?.[seg];
      if (!attr) break;
      if (attr.type === 'relation') {
        if (hasVisibility(schema, attr.target)) throw new GuardRejection(`Sorting through the relation "${key}" is not allowed for this token.`);
        cur = attr.target!;
      } else if (attr.type === 'component' && attr.component) cur = attr.component;
      else break;
    }
  }
}

function populatableKeys(attrs: Record<string, Attr>): string[] {
  return Object.entries(attrs)
    .filter(([, a]) => ['relation', 'component', 'dynamiczone', 'media'].includes(a.type))
    .map(([k]) => k);
}

/** Normalise any populate form (string, array, `*`, true, object) to an object keyed by attribute. */
export function normalizePopulate(populate: unknown, uid: string, schema: SchemaLookup): Record<string, any> {
  const attrs = schema(uid) ?? {};
  if (populate === undefined || populate === null || populate === false || populate === 'false') return {};
  if (populate === '*' || populate === true || populate === 'true') {
    return Object.fromEntries(populatableKeys(attrs).map((k) => [k, true]));
  }
  const out: Record<string, any> = {};
  const addPath = (p: string) => {
    const [head, ...rest] = p.split('.');
    if (!head) return;
    if (head === '*') {
      Object.assign(out, normalizePopulate('*', uid, schema));
      return;
    }
    if (!rest.length) {
      out[head] = out[head] ?? true;
      return;
    }
    const cur = out[head] === true || out[head] === undefined ? {} : { ...out[head] };
    const tail = rest.join('.');
    if (cur.populate && typeof cur.populate === 'object' && !Array.isArray(cur.populate)) cur.populate = { ...cur.populate, [tail]: true };
    else {
      const nested: unknown[] = Array.isArray(cur.populate) ? cur.populate : cur.populate === undefined ? [] : [cur.populate];
      cur.populate = [...nested, tail];
    }
    out[head] = cur;
  };
  if (typeof populate === 'string') populate.split(',').map((s) => s.trim()).forEach(addPath);
  else if (Array.isArray(populate)) populate.forEach((p) => typeof p === 'string' && addPath(p));
  else if (typeof populate === 'object') {
    for (const [k, v] of Object.entries(populate as Record<string, unknown>)) {
      if (k.includes('.')) addPath(k);
      else out[k] = v;
    }
  }
  return out;
}

const andFilter = (existing: unknown, guard: object) =>
  existing && typeof existing === 'object' && Object.keys(existing as object).length ? { $and: [existing, guard] } : guard;

/**
 * Rewrite a populate tree so every relation into a visibility-bearing type is filtered and selects `visibility`.
 * Also rejects caller filters/sorts inside populate that traverse into visibility-bearing types.
 */
export function hardenPopulate(populate: unknown, uid: string, schema: SchemaLookup, allowed: Visibility[], depth = 0): Record<string, any> {
  if (depth > 8) throw new GuardRejection('populate is nested too deeply');
  const norm = normalizePopulate(populate, uid, schema);
  const attrs = schema(uid) ?? {};
  const out: Record<string, any> = {};
  for (const [key, raw] of Object.entries(norm)) {
    if (raw === false || raw === 'false') continue;
    const attr = attrs[key];
    // Fail closed: anything not in the schema is rejected here, not left to Strapi's strict params.
    if (!attr) throw new GuardRejection(`Unknown populate key "${key}".`);
    const isAll = raw === true || raw === 'true' || raw === '*';
    if (attr.type === 'media') {
      if (isAll) out[key] = true;
      else if (isPlainObject(raw) && Object.keys(raw).every((k) => k === 'fields')) out[key] = { fields: raw.fields };
      else throw new GuardRejection(`Media "${key}" may only be populated with true or fields.`);
      continue;
    }
    if (attr.type === 'dynamiczone') {
      if (isAll) {
        out[key] = true; // populates component scalars only (no relations)
        continue;
      }
      if (!isPlainObject(raw) || !isPlainObject(raw.on) || Object.keys(raw).some((k) => k !== 'on')) {
        throw new GuardRejection('use on-fragments to populate dynamic zones');
      }
      const on: Record<string, any> = {};
      for (const [comp, frag] of Object.entries<any>(raw.on)) {
        if (!(attr.components ?? []).includes(comp) || !schema(comp)) throw new GuardRejection(`Unknown dynamic-zone component "${comp}".`);
        on[comp] = hardenNode(frag, comp, schema, allowed, depth, false);
      }
      out[key] = { on };
      continue;
    }
    if (attr.type === 'component') {
      out[key] = hardenNode(raw, attr.component!, schema, allowed, depth, false);
      continue;
    }
    if (attr.type === 'relation') {
      out[key] = hardenNode(raw, attr.target!, schema, allowed, depth, hasVisibility(schema, attr.target));
      continue;
    }
    throw new GuardRejection(`"${key}" is not populatable.`);
  }
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const NODE_KEYS = new Set(['fields', 'populate', 'filters', 'sort']);

function hardenNode(raw: any, uid: string, schema: SchemaLookup, allowed: Visibility[], depth: number, guarded: boolean) {
  if (raw !== true && raw !== 'true' && raw !== '*' && raw !== undefined && !isPlainObject(raw)) {
    throw new GuardRejection('populate values must be true, "*" or an object');
  }
  const node: Record<string, any> = {};
  if (isPlainObject(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!NODE_KEYS.has(k)) throw new GuardRejection(`populate option "${k}" is not allowed for this token.`);
      node[k] = v;
    }
  }
  if (node.filters) assertFiltersSafe(node.filters, uid, schema, 'populate.filters');
  if (node.sort) assertSortSafe(node.sort, uid, schema);
  if (node.populate !== undefined) node.populate = hardenPopulate(node.populate, uid, schema, allowed, depth + 1);
  if (guarded) {
    node.filters = andFilter(node.filters, { visibility: { $in: allowed } });
    if (node.fields !== undefined) {
      const fields = Array.isArray(node.fields) ? node.fields : String(node.fields).split(',');
      node.fields = Array.from(new Set([...fields.map((f: string) => f.trim()), 'visibility']));
    }
  }
  if (!Object.keys(node).length) return true;
  return node;
}

/** Root `fields`: make sure visibility is selected so the post-check can fail closed. */
export function withVisibilityField(fields: unknown): unknown {
  if (fields === undefined) return undefined;
  const list = Array.isArray(fields) ? fields : String(fields).split(',');
  return Array.from(new Set([...list.map((f: any) => String(f).trim()), 'visibility']));
}

const isHiddenEntry = (v: any, allowed: Visibility[]) =>
  !v || typeof v !== 'object' || v.visibility === undefined || !allowed.includes(v.visibility);

/**
 * Schema-aware strip of a response entry (fail closed): any populated relation of a visibility-bearing type is
 * removed when its visibility is missing or not allowed. Returns the number removed.
 */
export function stripEntry(entry: any, uid: string, schema: SchemaLookup, allowed: Visibility[]): number {
  if (!entry || typeof entry !== 'object') return 0;
  const attrs = schema(uid) ?? {};
  let removed = 0;
  for (const [key, attr] of Object.entries(attrs)) {
    const v = entry[key];
    if (v === undefined || v === null) continue;
    if (attr.type === 'relation' && attr.target) {
      const guarded = hasVisibility(schema, attr.target);
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) {
          if (guarded && isHiddenEntry(v[i], allowed)) {
            v.splice(i, 1);
            removed++;
          } else removed += stripEntry(v[i], attr.target, schema, allowed);
        }
      } else if (typeof v === 'object') {
        if (guarded && isHiddenEntry(v, allowed)) {
          entry[key] = null;
          removed++;
        } else removed += stripEntry(v, attr.target, schema, allowed);
      }
    } else if (attr.type === 'component' && attr.component) {
      for (const item of Array.isArray(v) ? v : [v]) removed += stripEntry(item, attr.component, schema, allowed);
    } else if (attr.type === 'dynamiczone' && Array.isArray(v)) {
      for (const item of v) if (item?.__component) removed += stripEntry(item, item.__component, schema, allowed);
    }
  }
  return removed;
}
