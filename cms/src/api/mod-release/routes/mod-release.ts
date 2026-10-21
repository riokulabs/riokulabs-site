import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::mod-release.mod-release' } }] };

export default factories.createCoreRouter('api::mod-release.mod-release', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
