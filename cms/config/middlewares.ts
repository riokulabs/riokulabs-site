import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: { formLimit: '256kb', jsonLimit: '1mb', textLimit: '256kb', formidable: { maxFileSize: 25 * 1024 * 1024 } },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
