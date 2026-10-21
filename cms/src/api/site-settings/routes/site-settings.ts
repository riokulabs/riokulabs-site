import { factories } from '@strapi/strapi';

// Single type: no visibility field, but populated relations (e.g. a private featured mod) are still stripped.
const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::site-settings.site-settings', filter: false } }] };

export default factories.createCoreRouter('api::site-settings.site-settings', { only: ['find'], config: { find: guarded } });
