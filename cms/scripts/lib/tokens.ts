import type { Core } from '@strapi/strapi';

const PRIVACY_LISTS_UID = 'api::privacy-lists.privacy-lists';
/** The one token that may read the Privacy lists: the static build checks its output against them. */
export const PRIVACY_LISTS_READER = 'site-build';

/**
 * find/findOne on every api:: type (collection + single). Nothing else. The Privacy lists only with
 * `privacyLists` (the site-build token); never for the preview token.
 */
export function readPermissions(app: Core.Strapi, opts: { privacyLists?: boolean } = {}): string[] {
  const perms: string[] = [];
  for (const [uid, ct] of Object.entries(app.contentTypes)) {
    if (!uid.startsWith('api::')) continue;
    if (uid === PRIVACY_LISTS_UID && !opts.privacyLists) continue;
    perms.push(`${uid}.find`);
    if ((ct as any).kind === 'collectionType') perms.push(`${uid}.findOne`);
  }
  return perms;
}

/** Create the named custom read-only token, or regenerate its key if it exists. Returns the access key. */
export async function ensureReadToken(app: Core.Strapi, name: string, description: string): Promise<string> {
  const svc: any = app.service('admin::api-token');
  const permissions = readPermissions(app, { privacyLists: name === PRIVACY_LISTS_READER });
  const existing = await svc.getByName(name);
  if (existing) {
    await svc.update(existing.id, { permissions, type: 'custom' });
    const regenerated = await svc.regenerate(existing.id);
    return regenerated.accessKey;
  }
  const created = await svc.create({ name, description, type: 'custom', lifespan: null, permissions });
  return created.accessKey;
}
