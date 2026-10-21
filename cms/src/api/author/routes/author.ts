import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::author.author' } }] };

export default factories.createCoreRouter('api::author.author', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
