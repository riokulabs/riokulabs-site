import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::game.game' } }] };

export default factories.createCoreRouter('api::game.game', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
