/**
 * privacy:push: copy the local private lists (config/privacy.local.json, else PRIVACY_LOCAL_JSON) into the Strapi
 * "Privacy lists" entry through the admin Content Manager API (STRAPI_URL + STRAPI_ADMIN_TOKEN, environment or
 * cms/.env). Prints counts only, never a term. `--dry-run` validates and counts without contacting Strapi.
 * A filled-in entry is only overwritten with `--replace`.
 */
import { AdminClient, checkUrl, readEnv, UsageError } from './admin-http';
import { CM_PATH, fetchPrivacyListsAdmin } from './privacy-remote';
import { readPrivacyLocalEnv, readPrivacyLocalFile } from '../../src/utils/privacy';
import { entryToLocal, hasPrivateLists, localToEntry, summarize, validateEntry } from '../../src/utils/privacy-lists';

export const USAGE = 'usage: npm run privacy:push [-- --dry-run] [--replace]';

export async function runPrivacyPush(opts: {
  argv: string[];
  cmsRoot: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}): Promise<void> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  const known = new Set(['--dry-run', '--replace', '--help', '-h']);
  const bad = opts.argv.filter((a) => !known.has(a));
  if (bad.length) throw new UsageError(`unknown argument ${bad[0]}\n${USAGE}`);
  if (opts.argv.includes('--help') || opts.argv.includes('-h')) return log(USAGE);
  const dryRun = opts.argv.includes('--dry-run');

  const file = readPrivacyLocalFile(opts.cmsRoot);
  const local = file ?? readPrivacyLocalEnv(env);
  const from = file ? 'config/privacy.local.json' : 'PRIVACY_LOCAL_JSON';
  if (!local || !hasPrivateLists(local)) throw new UsageError('nothing to push: config/privacy.local.json and PRIVACY_LOCAL_JSON hold no private lists');
  const { data, unknownKeys } = localToEntry(local);
  const problems = validateEntry(data);
  if (problems.length) throw new UsageError(`${from} is not valid: ${problems.join('; ')}`);
  const local2 = entryToLocal(data);
  log(`privacy:push: ${from}: ${summarize(local2)}`);
  if (unknownKeys.length) log(`privacy:push: not copied (no field for them): ${unknownKeys.join(', ')}`);

  const e = readEnv(opts.cmsRoot, env);
  const base = checkUrl(e.url);
  if (dryRun) return log(`privacy:push: dry run, nothing sent to ${new URL(base).host}`);
  if (!e.adminToken) throw new UsageError('STRAPI_ADMIN_TOKEN is not set (environment or cms/.env)');
  const client = new AdminClient(base, e.adminToken, opts.fetchImpl ?? fetch, 'the admin token needs create and update on Privacy lists');

  let current;
  try {
    current = await fetchPrivacyListsAdmin(client);
  } catch (err) {
    throw new Error(`could not read the Privacy lists on ${new URL(base).host}: ${(err as Error).message}`);
  }
  if (current) {
    log(`privacy:push: ${new URL(base).host} already has: ${summarize(current)}`);
    if (!opts.argv.includes('--replace')) throw new UsageError('the Privacy lists entry is already filled in; pass --replace to overwrite it');
  }
  await client.put(CM_PATH, data);
  const after = await fetchPrivacyListsAdmin(client);
  if (summarize(after) !== summarize(local2)) throw new Error(`pushed, but ${new URL(base).host} now reports: ${summarize(after)}`);
  log(`privacy:push: ${current ? 'replaced' : 'filled in'} the Privacy lists on ${new URL(base).host} (${summarize(after)})`);
}
