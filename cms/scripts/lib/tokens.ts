import type { Core } from '@strapi/strapi';

/** find/findOne on every api:: type (collection + single). Nothing else. */
export function readPermissions(app: Core.Strapi): string[] {
  const perms: string[] = [];
  for (const [uid, ct] of Object.entries(app.contentTypes)) {
    if (!uid.startsWith('api::')) continue;
    perms.push(`${uid}.find`);
    if ((ct as any).kind === 'collectionType') perms.push(`${uid}.findOne`);
  }
  return perms;
}

/** Create the named custom read-only token, or regenerate its key if it exists. Returns the access key. */
export async function ensureReadToken(app: Core.Strapi, name: string, description: string): Promise<string> {
  const svc: any = app.service('admin::api-token');
  const existing = await svc.getByName(name);
  if (existing) {
    await svc.update(existing.id, { permissions: readPermissions(app), type: 'custom' });
    const regenerated = await svc.regenerate(existing.id);
    return regenerated.accessKey;
  }
  const created = await svc.create({ name, description, type: 'custom', lifespan: null, permissions: readPermissions(app) });
  return created.accessKey;
}
