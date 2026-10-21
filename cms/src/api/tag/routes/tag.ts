import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::tag.tag' } }] };

export default factories.createCoreRouter('api::tag.tag', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
