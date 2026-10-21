import type { Core } from '@strapi/strapi';
import { previewLink } from '../src/utils/preview-link';

/** Content type → site path (ARCHITECTURE §6). Mods live under their game (/games/<game>/mods/<mod>); single types map to
 *  fixed pages. A draft mod without a game opens /mods/<slug>, which the preview site explains. */
const PREVIEW_PATHS: Record<string, (doc?: any) => string | null> = {
  'api::game.game': (d) => (d?.slug ? `/games/${d.slug}` : '/games'),
  'api::mod.mod': (d) => (d?.slug ? (d.game?.slug ? `/games/${d.game.slug}/mods/${d.slug}` : `/mods/${d.slug}`) : null),
  'api::blog-post.blog-post': (d) => (d?.slug ? `/blog/${d.slug}` : null),
  'api::tag.tag': (d) => (d?.slug ? `/blog/tag/${d.slug}` : null),
  'api::timeline-family.timeline-family': (d) => (d?.mod?.slug && d.mod.game?.slug ? `/games/${d.mod.game.slug}/mods/${d.mod.slug}/history` : '/roadmap'),
  'api::milestone.milestone': () => '/roadmap',
  'api::home-page.home-page': () => '/',
  'api::about-page.about-page': () => '/about',
  'api::brand-page.brand-page': () => '/brand',
  'api::legal-page.legal-page': () => '/legal',
};

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Admin => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET')!,
  },
  apiToken: {
    salt: env('API_TOKEN_SALT')!,
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT')!,
    },
  },
  secrets: {
    // Set so API tokens stay viewable in the admin (ARCHITECTURE §8).
    encryptionKey: env('ENCRYPTION_KEY')!,
  },
  flags: {
    nps: env.bool('FLAG_NPS', false),
    promoteEE: env.bool('FLAG_PROMOTE_EE', false),
    docLinks: env.bool('FLAG_DOC_LINKS', true),
  },
  // Basic Preview (free licence): "Open preview" in the edit view opens the preview site for this entry.
  // PREVIEW_URL and PREVIEW_SECRET (32+ characters, the same value as on the preview Worker) are Cloud variables.
  preview: {
    enabled: !!env('PREVIEW_URL'),
    config: {
      allowedOrigins: [env('PREVIEW_URL', 'http://localhost:4321')],
      async handler(uid, { documentId, status = 'draft' }) {
        const toPath = PREVIEW_PATHS[uid];
        if (!toPath) return null;
        let doc: any;
        if (documentId) {
          const populate = uid === 'api::mod.mod' ? { game: { fields: ['slug'] } } : undefined;
          doc = await strapi.documents(uid as any).findOne({ documentId, status: status as any, ...(populate ? { populate } : {}) } as any);
        }
        const path = toPath(doc);
        if (!path) return null;
        // A signed link that expires in 10 minutes; the secret itself never goes into the URL (src/utils/preview-link.ts).
        return previewLink(env('PREVIEW_URL'), env('PREVIEW_SECRET'), path);
      },
    },
  },
});

export default config;
