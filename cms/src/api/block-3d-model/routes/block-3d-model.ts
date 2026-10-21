import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::block-3d-model.block-3d-model' } }] };

export default factories.createCoreRouter('api::block-3d-model.block-3d-model', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
