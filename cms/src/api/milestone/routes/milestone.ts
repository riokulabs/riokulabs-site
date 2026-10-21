import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::milestone.milestone' } }] };

export default factories.createCoreRouter('api::milestone.milestone', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
