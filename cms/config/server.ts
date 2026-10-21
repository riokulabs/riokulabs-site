import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  // Strapi's MCP server at /mcp, for editing content from an AI client. Off unless MCP_ENABLED=true; every call needs
  // an admin token and goes through the document service, so the privacy guard and the rebuild trigger still apply.
  mcp: {
    enabled: env.bool('MCP_ENABLED', false),
  },
});

export default config;
