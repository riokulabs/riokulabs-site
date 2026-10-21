/**
 * visibility-guard (CONTENT-MODEL §6.2): defence in depth on every content-API read route.
 *
 * Attached per route (src/api/<type>/routes/<type>.ts) with `config: { uid, filter }`, so it runs after
 * authentication and knows the content type. For every caller except the `site-preview` token it:
 * 1. forces `status=published` (no draft reads);
 * 2. rejects (400) filters and sorts that traverse a relation into a visibility-bearing type (no probing oracle);
 * 3. ANDs `visibility $in allowed` into the root filters (collection types) and into every populated relation of a
 *    visibility-bearing type, forcing `visibility` into any `fields` selection;
 * 4. after the query, removes every populated entry of a visibility-bearing type whose visibility is missing or not
 *    allowed (fail closed), and answers 404 for a hidden root entry.
 * Unlisted entries are allowed only with `X-Site-Include-Unlisted: 1`. Pure logic: src/utils/visibility-query.ts.
 * The Public and Authenticated roles have no permissions at all (src/index.ts).
 */
import type { Core } from '@strapi/strapi';
import { allowedVisibilities, stripNonVisible, withVisibilityFilter } from '../utils/privacy';
import {
  assertFiltersSafe,
  assertSortSafe,
  GuardRejection,
  hardenPopulate,
  stripEntry,
  withVisibilityField,
  type SchemaLookup,
} from '../utils/visibility-query';

/** API token names that may read drafts and private entries (the preview site shows them with a banner). */
const BYPASS_TOKEN_NAMES = (process.env.VISIBILITY_GUARD_BYPASS_TOKENS ?? 'site-preview')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Strapi 5.58 names the content-API token strategy 'content-api-token' (earlier 5.x: 'api-token'). */
const TOKEN_STRATEGIES = ['content-api-token', 'api-token'];

export function shouldBypass(auth: any): boolean {
  return TOKEN_STRATEGIES.includes(auth?.strategy?.name) && BYPASS_TOKEN_NAMES.includes(auth?.credentials?.name);
}

export function schemaLookup(strapi: Core.Strapi): SchemaLookup {
  return (uid: string) =>
    ((strapi.contentTypes as any)[uid]?.attributes ?? (strapi.components as any)[uid]?.attributes) as any;
}

export default (config: { uid?: string; filter?: boolean } | undefined, { strapi }: { strapi: Core.Strapi }) => {
  const uid = config?.uid;
  // Single types have no visibility field: no root filter, but relations are still guarded (filter: false).
  const filterRoot = config?.filter !== false;
  const schema = schemaLookup(strapi);

  return async (ctx: any, next: () => Promise<void>) => {
    if (shouldBypass(ctx.state.auth)) return next();
    if (!uid) {
      ctx.status = 500;
      ctx.body = { data: null, error: { status: 500, name: 'GuardMisconfigured', message: 'visibility-guard needs a uid' } };
      return;
    }

    const includeUnlisted = String(ctx.get?.('x-site-include-unlisted') ?? '') === '1';
    const allowed = allowedVisibilities(includeUnlisted);
    const q: Record<string, any> = { ...(ctx.query ?? {}) };

    try {
      q.status = 'published';
      if (q.filters) assertFiltersSafe(q.filters, uid, schema);
      if (q.sort) assertSortSafe(q.sort, uid, schema);
      if (q.populate !== undefined) q.populate = hardenPopulate(q.populate, uid, schema, allowed);
      if (filterRoot && q.fields !== undefined) q.fields = withVisibilityField(q.fields);
    } catch (e) {
      if (e instanceof GuardRejection) {
        ctx.status = 400;
        ctx.body = { data: null, error: { status: 400, name: 'ValidationError', message: e.message, details: {} } };
        return;
      }
      throw e;
    }
    ctx.query = filterRoot ? withVisibilityFilter(q, allowed) : q;

    await next();

    const data = ctx.body?.data;
    if (!data) return;
    if (filterRoot && !Array.isArray(data) && (data.visibility === undefined || !allowed.includes(data.visibility))) {
      // findOne on a hidden entry (or one whose visibility we can't see): answer exactly like a missing one.
      ctx.status = 404;
      ctx.body = { data: null, error: { status: 404, name: 'NotFoundError', message: 'Not Found', details: {} } };
      return;
    }
    let removed = 0;
    for (const entry of Array.isArray(data) ? data : [data]) {
      if (filterRoot && (entry?.visibility === undefined || !allowed.includes(entry.visibility))) continue;
      removed += stripEntry(entry, uid, schema, allowed);
    }
    if (Array.isArray(data) && filterRoot) {
      const before = data.length;
      ctx.body.data = data.filter((e: any) => e?.visibility !== undefined && allowed.includes(e.visibility));
      removed += before - ctx.body.data.length;
    }
    removed += stripNonVisible(ctx.body, allowed); // belt and braces for anything the schema walk can't see
    if (removed > 0) strapi.log.debug(`[visibility-guard] removed ${removed} non-visible entr(ies) from ${ctx.path}`);
  };
};
