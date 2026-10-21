import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::mod.mod' } }] };

export default factories.createCoreRouter('api::mod.mod', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
