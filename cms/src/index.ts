import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { checkPublishable, compilePatterns, loadPrivacyConfig, loadPrivacyLocal } from './utils/privacy';
import { registerRebuildTrigger, subscribeMediaChanges, type RebuildTrigger } from './rebuild-trigger';
import { applyAdminViews } from './admin-views';

let rebuild: RebuildTrigger | null = null;

/**
 * register: the publish guard (CONTENT-MODEL §6.1), a Document Service middleware.
 * bootstrap: lock the Public and Authenticated roles down to nothing (CONTENT-MODEL §6.2).
 * bootstrap also applies the Content Manager view settings kept in code (admin-views.ts).
 * Both: the site rebuild trigger (rebuild-trigger.ts; disabled unless GITHUB_REPO + GITHUB_DISPATCH_TOKEN are set).
 */
export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Fail closed: in production the publish guard needs the private deny lists, not only the public canaries.
    if (process.env.NODE_ENV === 'production' && !loadPrivacyLocal(strapi.dirs.app.root)) {
      throw new Error('[privacy] the private deny lists are missing: set PRIVACY_LOCAL_JSON (or add config/privacy.local.json).');
    }
    const cfg = loadPrivacyConfig(strapi.dirs.app.root);
    const deny = compilePatterns(cfg.denyPatterns, cfg.patternFlags ?? 'i');
    const ip = compilePatterns(cfg.ipDenyTerms, cfg.patternFlags ?? 'i');

    strapi.documents.use(async (context, next) => {
      const { uid, action } = context as any;
      if (!String(uid).startsWith('api::')) return next();
      const params: any = (context as any).params ?? {};
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

      const verdict = checkPublishable(entry, { hasVisibility, deny, ip });
      if (!verdict.ok) throw new errors.ValidationError(verdict.reason!);
      return next();
    });

    // Registered after the publish guard, so it only sees writes the guard let through.
    rebuild = registerRebuildTrigger(strapi);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    if (rebuild) subscribeMediaChanges(strapi, rebuild);
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
