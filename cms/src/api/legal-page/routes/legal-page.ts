import { factories } from '@strapi/strapi';

// Single type: no visibility field, but populated relations (e.g. a private featured mod) are still stripped.
const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::legal-page.legal-page', filter: false } }] };

export default factories.createCoreRouter('api::legal-page.legal-page', { only: ['find'], config: { find: guarded } });
