import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::category.category' } }] };

export default factories.createCoreRouter('api::category.category', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
