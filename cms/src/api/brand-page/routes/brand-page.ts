import { factories } from '@strapi/strapi';

// Single type: no visibility field, but populated relations (e.g. a private featured mod) are still stripped.
const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::brand-page.brand-page', filter: false } }] };

export default factories.createCoreRouter('api::brand-page.brand-page', { only: ['find'], config: { find: guarded } });
