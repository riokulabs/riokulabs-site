import { factories } from '@strapi/strapi';
import { buildView, PRIVACY_LISTS_UID } from '../../../utils/privacy-lists';

/**
 * The one content-API read: the three lists the site build checks against (deny, IP, retired), nothing else. The
 * route allows only API tokens other than the preview token (src/policies/privacy-lists-reader.ts), and the token
 * needs the Privacy-lists find permission. `data` is null while the entry is empty.
 */
export default factories.createCoreController('api::privacy-lists.privacy-lists', ({ strapi }) => ({
  async find(ctx) {
    const doc = await strapi.documents(PRIVACY_LISTS_UID as any).findFirst({} as any);
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: buildView(doc as any), meta: {} };
  },
}));
