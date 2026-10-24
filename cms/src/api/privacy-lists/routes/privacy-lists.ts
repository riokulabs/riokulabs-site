import { factories } from '@strapi/strapi';

// Admin-only type. Only `find`, and only for API tokens (never the Public or Authenticated role, never the preview
// token): src/policies/privacy-lists-reader.ts. The controller returns the build lists only.
export default factories.createCoreRouter('api::privacy-lists.privacy-lists', {
  only: ['find'],
  config: { find: { policies: ['global::privacy-lists-reader'] } },
});
