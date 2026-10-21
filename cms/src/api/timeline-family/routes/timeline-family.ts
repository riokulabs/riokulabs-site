import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::timeline-family.timeline-family' } }] };

export default factories.createCoreRouter('api::timeline-family.timeline-family', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
