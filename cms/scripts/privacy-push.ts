/**
 * Upload the local private lists into the Strapi "Privacy lists" entry (see lib/privacy-push.ts). Counts only.
 *
 *   npm run privacy:push [-- --dry-run] [--replace]
 */
import path from 'node:path';
import { UsageError } from './lib/admin-http';
import { runPrivacyPush } from './lib/privacy-push';

runPrivacyPush({ argv: process.argv.slice(2), cmsRoot: path.resolve(__dirname, '..') }).then(
  () => process.exit(0),
  (e) => {
    console.error(`privacy:push: ${(e as Error).message}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  },
);
