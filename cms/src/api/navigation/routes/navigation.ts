import { factories } from '@strapi/strapi';

// Single type: no visibility field, but populated relations (e.g. a private featured mod) are still stripped.
const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::navigation.navigation', filter: false } }] };

export default factories.createCoreRouter('api::navigation.navigation', { only: ['find'], config: { find: guarded } });
