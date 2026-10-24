import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { checkPublishable } from './utils/privacy';
import { EMPTY_LISTS_MESSAGE, isMcpRequest, PRIVACY_LISTS_UID, privacyListsRequired, validateEntry } from './utils/privacy-lists';
import { getPrivacy, refreshPrivacy, seedPrivacyListsIfEmpty } from './privacy-runtime';
import { registerRebuildTrigger, subscribeMediaChanges, type RebuildTrigger } from './rebuild-trigger';
import { applyAdminViews } from './admin-views';

let rebuild: RebuildTrigger | null = null;

/** Document Service actions that write the Privacy lists entry (refresh the cached lists afterwards). */
const WRITES = new Set(['create', 'update', 'delete', 'publish', 'unpublish', 'discardDraft']);

/**
 * register: the publish guard (CONTENT-MODEL §6.1), a Document Service middleware. Its private lists come from the
 * Privacy lists entry (privacy-runtime.ts); writes to that entry are validated here and refresh the cache.
 * bootstrap: seed an empty Privacy lists entry from the local file/env (one-time migration), load the lists.
 * bootstrap: lock the Public and Authenticated roles down to nothing (CONTENT-MODEL §6.2).
 * bootstrap also applies the Content Manager view settings kept in code (admin-views.ts).
 * Both: the site rebuild trigger (rebuild-trigger.ts; disabled unless GITHUB_REPO + GITHUB_DISPATCH_TOKEN are set).
 */
export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Boot never fails for missing lists: the guard below fails closed instead (EMPTY_LISTS_MESSAGE).
    strapi.documents.use(async (context, next) => {
      const { uid, action } = context as any;
      if (!String(uid).startsWith('api::')) return next();
      const params: any = (context as any).params ?? {};
      if (uid === PRIVACY_LISTS_UID) {
        // Never over Strapi's MCP server (/mcp): an AI client would copy the terms into its transcript.
        if (isMcpRequest(strapi.requestContext.get())) throw new errors.ForbiddenError('Privacy lists are not available over MCP; use the admin.');
        // Admin-only settings, never published content: validate the lists, then reload them.
        if ((action === 'create' || action === 'update') && params.data) {
          const problems = validateEntry(params.data);
          if (problems.length) throw new errors.ValidationError(`Privacy lists: ${problems.slice(0, 10).join('; ')}`);
        }
        const result = await next();
        if (WRITES.has(action)) await refreshPrivacy(strapi);
        return result;
      }
      const publishing =
        action === 'publish' || ((action === 'create' || action === 'update') && params.status === 'published');
      if (!publishing) return next();

      const ct = strapi.contentType(uid as any);
      const hasVisibility = !!ct?.attributes && 'visibility' in ct.attributes;
      let entry: Record<string, unknown> = { ...(params.data ?? {}) };
      if (params.documentId) {
        const draft = await strapi.documents(uid as any).findOne({ documentId: params.documentId, status: 'draft' } as any);
        entry = { ...(draft ?? {}), ...entry };
      }
      if (hasVisibility && entry.visibility === undefined) entry.visibility = 'private';

      const privacy = await getPrivacy(strapi);
      const listsMissing = privacy.source === 'none' && privacyListsRequired();
      const verdict = checkPublishable(entry, { hasVisibility, deny: privacy.deny, ip: privacy.ip, listsMissing });
      if (!verdict.ok) throw new errors.ValidationError(verdict.reason!);
      return next();
    });

    // Registered after the publish guard, so it only sees writes the guard let through.
    rebuild = registerRebuildTrigger(strapi);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    if (rebuild) subscribeMediaChanges(strapi, rebuild);
    // Private lists: one-time copy of the local file / PRIVACY_LOCAL_JSON into an empty entry, then load them.
    try {
      await seedPrivacyListsIfEmpty(strapi);
    } catch (e) {
      strapi.log.error(`[privacy] could not seed the Privacy lists entry: ${(e as Error).message}`);
    }
    const privacy = await refreshPrivacy(strapi);
    if (privacy.source === 'none' && privacyListsRequired()) strapi.log.warn(`[privacy] ${EMPTY_LISTS_MESSAGE} Until then, publishing public content is refused.`);
    // Public and Authenticated roles: no permissions at all. The site is static; only API tokens read the API.
    const roles = await strapi.db.query('plugin::users-permissions.role').findMany({
      where: { type: { $in: ['public', 'authenticated'] } },
    });
    for (const role of roles) {
      const removed = await strapi.db
        .query('plugin::users-permissions.permission')
        .deleteMany({ where: { role: role.id } });
      if (removed?.count) strapi.log.info(`[privacy] removed ${removed.count} permission(s) from the ${role.type} role`);
    }
    // No end-user accounts in v1.
    const store = strapi.store({ type: 'plugin', name: 'users-permissions', key: 'advanced' });
    const advanced = ((await store.get()) as Record<string, unknown>) ?? {};
    if (advanced.allow_register !== false) await store.set({ value: { ...advanced, allow_register: false } });
    // Content Manager list/edit views (labels, columns, layouts) from admin-views-data.ts.
    await applyAdminViews(strapi);
  },
  async destroy() {
    // Sends any pending rebuild request now (capped at 5 s) instead of dropping it.
    const t = rebuild;
    rebuild = null;
    await t?.destroy();
  },
};
