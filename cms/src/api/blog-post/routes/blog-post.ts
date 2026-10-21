import { factories } from '@strapi/strapi';

const guarded = { middlewares: [{ name: 'global::visibility-guard', config: { uid: 'api::blog-post.blog-post' } }] };

export default factories.createCoreRouter('api::blog-post.blog-post', {
  only: ['find', 'findOne'],
  config: { find: guarded, findOne: guarded },
});
