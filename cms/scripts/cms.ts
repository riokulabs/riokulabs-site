/**
 * Compact Content Manager CLI: read and edit Strapi entries with short output instead of full JSON payloads.
 *
 *   npm run cms -- list blog-post --fields title,date --status draft
 *   npm run cms -- get blog-post <documentId> --outline
 *   npm run cms -- set blog-post <documentId> title="New title"
 *   npm run cms -- section blog-post <documentId> 3 --alt "Server racks in the cold aisle"
 *   npm run cms -- publish blog-post <documentId> --yes
 *
 * Talks to the admin Content Manager routes with STRAPI_ADMIN_TOKEN (also read from cms/.env). Writes change the draft
 * only and are checked by re-reading the entry. No delete command. See scripts/README-cms-cli.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AdminClient, checkUrl, readEnv, UsageError } from './lib/admin-http';
import { CM_FORBIDDEN, parseCli, USAGE, VerifyError } from './lib/cms-cli';
import { runCommand } from './lib/cms-commands';

const CMS = path.resolve(__dirname, '..');

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const env = readEnv(CMS);
  const base = checkUrl(env.url);
  if (cli.cmd !== 'help' && !env.adminToken) throw new Error('STRAPI_ADMIN_TOKEN is not set (environment or cms/.env); see scripts/README-cms-cli.md');
  const client = new AdminClient(base, env.adminToken ?? '', fetch, CM_FORBIDDEN);
  return runCommand(cli, {
    client,
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    // npm run starts in cms/; resolve relative paths from where the command was typed.
    readText: (f) => fs.readFileSync(f === '-' ? 0 : path.resolve(process.env.INIT_CWD ?? process.cwd(), f), 'utf8'),
  });
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`cms: ${(e as Error).message}`);
    if (e instanceof UsageError) console.error(`\n${USAGE}`);
    process.exit(e instanceof UsageError ? 2 : e instanceof VerifyError ? 3 : 1);
  },
);
