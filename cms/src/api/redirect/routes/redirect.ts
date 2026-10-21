import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::redirect.redirect' } }] };

export default factories.createCoreRouter('api::redirect.redirect', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
