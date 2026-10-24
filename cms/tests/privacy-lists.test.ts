import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildView,
  EMPTY_LISTS_MESSAGE,
  entryToLocal,
  hasPrivateLists,
  isMcpRequest,
  localToEntry,
  privacyListsRequired,
  resolvePrivateLists,
  summarize,
  validateEntry,
} from '../src/utils/privacy-lists';
import { checkPublishable, compilePatterns } from '../src/utils/privacy';
import { isPrivacyListsReader } from '../src/policies/privacy-lists-reader';
import { refreshPrivacy, resetPrivacyState, seedPrivacyListsIfEmpty } from '../src/privacy-runtime';
import { loadLocalOrRemote } from '../scripts/lib/privacy-remote';
import { runPrivacyPush } from '../scripts/lib/privacy-push';

// Synthetic terms only (this file is public). Each source gets its own, so a test can tell which one won.
const FILE_LISTS = {
  $comment: 'synthetic',
  denyPatterns: ['zz[ _-]?file[ _-]?deny'],
  ipDenyTerms: ['zz[ _-]?file[ _-]?ip'],
  retiredBrandTerms: ['zz[ _-]?file[ _-]?retired'],
  privateDraft: { ideaMods: [{ slug: 'zz-file-idea', name: 'ZZ File Idea' }] },
  neverSeed: ['zz/file/never'],
  legacyModelPrefix: 'ZZFP',
  testSamples: { deny: ['zz file deny'], ip: [], retired: [], allowed: ['Data Center'] },
};
const ENV_LISTS = { denyPatterns: ['zz[ _-]?env[ _-]?deny'], ipDenyTerms: [], retiredBrandTerms: [] };
const DB_ENTRY = { documentId: 'doc1', denyPatterns: ['zz[ _-]?db[ _-]?deny'], ipDenyTerms: ['zz[ _-]?db[ _-]?ip'], retiredBrandTerms: [], privateIdeaMods: [], neverSeed: [] };
const ALL_TERMS = ['zz[ _-]?file', 'zz-file-idea', 'ZZ File Idea', 'zz/file/never', 'ZZFP', 'zz file deny', 'zz[ _-]?env', 'zz[ _-]?db'];

const PUBLIC_CONFIG = path.resolve(__dirname, '..', 'config', 'privacy.json');
function tmpRoot(withFile: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-lists-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.copyFileSync(PUBLIC_CONFIG, path.join(root, 'config', 'privacy.json'));
  if (withFile) fs.writeFileSync(path.join(root, 'config', 'privacy.local.json'), JSON.stringify(FILE_LISTS));
  return root;
}

/** Just enough of Strapi for privacy-runtime: one single-type document store. */
function fakeStrapi(root: string, entry: Record<string, unknown> | null) {
  const store = { entry: entry ? { ...entry } : null, creates: 0, updates: 0 };
  const logs: string[] = [];
  const log = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
  const strapi: any = {
    dirs: { app: { root } },
    log,
    contentType: () => ({ kind: 'singleType' }),
    documents: () => ({
      findFirst: async () => store.entry,
      create: async ({ data }: any) => {
        store.creates++;
        store.entry = { documentId: 'new', ...data };
        return store.entry;
      },
      update: async ({ data }: any) => {
        store.updates++;
        store.entry = { ...store.entry, ...data };
        return store.entry;
      },
    }),
  };
  return { strapi, store, logs };
}

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.PRIVACY_LOCAL_JSON;
  delete process.env.PRIVACY_LOCAL_JSON;
  resetPrivacyState();
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.PRIVACY_LOCAL_JSON;
  else process.env.PRIVACY_LOCAL_JSON = savedEnv;
  resetPrivacyState();
});

const noTerms = (lines: string[]) => {
  const text = lines.join('\n');
  for (const t of ALL_TERMS) expect(text, 'a log line must never name a term').not.toContain(t);
};

describe('entry <-> privacy.local.json', () => {
  it('round-trips every field, drops $ comments', () => {
    const { data, unknownKeys } = localToEntry(FILE_LISTS);
    expect(unknownKeys).toEqual([]);
    expect(data.privateIdeaMods).toEqual(FILE_LISTS.privateDraft.ideaMods);
    const back = entryToLocal(data)!;
    const { $comment: _c, ...rest } = FILE_LISTS;
    expect(back).toEqual(rest);
  });
  it('reports keys it has no field for, by name', () => {
    expect(localToEntry({ ...FILE_LISTS, somethingElse: [1], privateDraft: { ideaMods: [], other: 1 } }).unknownKeys).toEqual(['somethingElse', 'privateDraft.other']);
  });
  it('an empty or missing entry is "no lists"', () => {
    expect(entryToLocal(null)).toBeNull();
    expect(entryToLocal({ denyPatterns: [], ipDenyTerms: null, retiredBrandTerms: [] })).toBeNull();
    expect(hasPrivateLists({ neverSeed: ['x'] })).toBe(false);
  });
  it('the build view carries the three lists only', () => {
    expect(Object.keys(buildView(localToEntry(FILE_LISTS).data)!).sort()).toEqual(['denyPatterns', 'ipDenyTerms', 'retiredBrandTerms']);
    expect(buildView({ neverSeed: ['x'] })).toBeNull();
  });
  it('summaries are counts, never terms', () => {
    const s = summarize(FILE_LISTS);
    expect(s).toBe('deny 1, IP 1, retired 1, ideas 1, neverSeed 1, model prefix set, test samples set');
    noTerms([s]);
  });
});

describe('validateEntry', () => {
  it('accepts the file shape', () => {
    expect(validateEntry(localToEntry(FILE_LISTS).data)).toEqual([]);
  });
  it('names the field and item, never the value', () => {
    const problems = validateEntry({ denyPatterns: ['ok', 'zz(file', 3], ipDenyTerms: 'zz file ip', privateIdeaMods: [{}], legacyModelPrefix: 'ZZ FP', testSamples: { nope: [] } });
    expect(problems).toEqual([
      'denyPatterns item 2 is not a valid regular expression',
      'denyPatterns item 3 must be a non-empty string',
      'ipDenyTerms must be a JSON list of strings, like ["first", "second"]',
      'privateIdeaMods item 1 needs a name or a slug',
      'legacyModelPrefix must be letters and digits only',
      'testSamples.nope is not a known key (deny, ip, retired, allowed)',
    ]);
    noTerms(problems);
  });
});

describe('loader precedence: DB > file > env', () => {
  const db = () => entryToLocal(DB_ENTRY);
  const file = () => FILE_LISTS;
  const env = () => ENV_LISTS;
  it('picks the first source that holds lists', () => {
    expect(resolvePrivateLists({ db, file, env }).source).toBe('db');
    expect(resolvePrivateLists({ db: () => null, file, env }).source).toBe('file');
    expect(resolvePrivateLists({ db: () => entryToLocal({ denyPatterns: [] }), file: () => null, env }).source).toBe('env');
    expect(resolvePrivateLists({ db: () => null, file: () => null, env: () => null })).toEqual({ source: 'none', local: null });
  });
  it('does not read a later source when an earlier one has lists', () => {
    let read = false;
    resolvePrivateLists({ db, file: () => ((read = true), FILE_LISTS) });
    expect(read).toBe(false);
  });

  it('runtime: the DB entry wins over the file and env', async () => {
    process.env.PRIVACY_LOCAL_JSON = JSON.stringify(ENV_LISTS);
    const { strapi } = fakeStrapi(tmpRoot(true), DB_ENTRY);
    const s = await refreshPrivacy(strapi);
    expect(s.source).toBe('db');
    expect(s.deny.some((r) => r.test('zz db deny'))).toBe(true);
    expect(s.deny.some((r) => r.test('zz file deny'))).toBe(false);
    expect(s.deny.some((r) => r.test('zz private canary'))).toBe(true); // public canaries stay merged in
  });
  it('runtime: the file wins over env when the entry is empty', async () => {
    process.env.PRIVACY_LOCAL_JSON = JSON.stringify(ENV_LISTS);
    const { strapi } = fakeStrapi(tmpRoot(true), { documentId: 'x', denyPatterns: [] });
    expect((await refreshPrivacy(strapi)).source).toBe('file');
  });
  it('runtime: env is the last resort', async () => {
    process.env.PRIVACY_LOCAL_JSON = JSON.stringify(ENV_LISTS);
    const { strapi } = fakeStrapi(tmpRoot(false), null);
    const s = await refreshPrivacy(strapi);
    expect(s.source).toBe('env');
    expect(s.deny.some((r) => r.test('zz env deny'))).toBe(true);
  });
  it('runtime: nothing anywhere loads the public canaries and does not throw', async () => {
    const { strapi, logs } = fakeStrapi(tmpRoot(false), null);
    const s = await refreshPrivacy(strapi);
    expect(s.source).toBe('none');
    expect(s.local).toBeNull();
    expect(s.deny.length).toBe(2);
    noTerms(logs);
  });
  it('runtime: a database error before the first load falls back to the file', async () => {
    const { strapi } = fakeStrapi(tmpRoot(true), null);
    strapi.documents = () => ({ findFirst: async () => { throw new Error('no such table'); } });
    expect((await refreshPrivacy(strapi)).source).toBe('file');
  });
});

describe('one-time seed at bootstrap', () => {
  it('copies the file into an empty entry, logging counts only', async () => {
    const { strapi, store, logs } = fakeStrapi(tmpRoot(true), null);
    expect(await seedPrivacyListsIfEmpty(strapi)).toBe('seeded');
    expect(store.creates).toBe(1);
    expect(entryToLocal(store.entry as any)).toMatchObject({ denyPatterns: FILE_LISTS.denyPatterns, privateDraft: FILE_LISTS.privateDraft });
    expect((await refreshPrivacy(strapi)).source).toBe('db');
    noTerms(logs);
  });
  it('updates an existing but empty entry', async () => {
    process.env.PRIVACY_LOCAL_JSON = JSON.stringify(ENV_LISTS);
    const { strapi, store } = fakeStrapi(tmpRoot(false), { documentId: 'd', denyPatterns: [] });
    expect(await seedPrivacyListsIfEmpty(strapi)).toBe('seeded');
    expect(store.updates).toBe(1);
  });
  it('never overwrites a filled-in entry', async () => {
    const { strapi, store } = fakeStrapi(tmpRoot(true), DB_ENTRY);
    expect(await seedPrivacyListsIfEmpty(strapi)).toBe('kept');
    expect(store.creates + store.updates).toBe(0);
  });
  it('does nothing without a file or env', async () => {
    const { strapi, store } = fakeStrapi(tmpRoot(false), null);
    expect(await seedPrivacyListsIfEmpty(strapi)).toBe('nothing-to-seed');
    expect(store.entry).toBeNull();
  });
});

describe('publish guard with empty lists', () => {
  const deny = compilePatterns(['zz[ _-]?private[ _-]?canary']);
  it('refuses a public (or single-type) publish with the admin message', () => {
    expect(checkPublishable({ name: 'Data Center', visibility: 'public' }, { hasVisibility: true, deny, ip: [], listsMissing: true })).toEqual({ ok: false, reason: EMPTY_LISTS_MESSAGE });
    expect(checkPublishable({ name: 'Data Center', visibility: 'unlisted' }, { hasVisibility: true, deny, ip: [], listsMissing: true }).ok).toBe(false);
    expect(checkPublishable({ siteName: 'Rioku Labs' }, { hasVisibility: false, deny, ip: [], listsMissing: true }).ok).toBe(false);
  });
  it('still lets a private entry be published', () => {
    expect(checkPublishable({ name: 'Data Center', visibility: 'private' }, { hasVisibility: true, deny, ip: [], listsMissing: true }).ok).toBe(true);
  });
  it('is required in production by default, switchable for tests', () => {
    expect(privacyListsRequired({ NODE_ENV: 'production' } as any)).toBe(true);
    expect(privacyListsRequired({ NODE_ENV: 'development' } as any)).toBe(false);
    expect(privacyListsRequired({ NODE_ENV: 'development', PRIVACY_REQUIRE_LISTS: '1' } as any)).toBe(true);
    expect(privacyListsRequired({ NODE_ENV: 'production', PRIVACY_REQUIRE_LISTS: '0' } as any)).toBe(false);
  });
});

describe('who may read the lists', () => {
  it('only API tokens, never the preview token, never a user session or the public', () => {
    expect(isPrivacyListsReader(undefined)).toBe(false);
    expect(isPrivacyListsReader({ strategy: { name: 'users-permissions' }, credentials: { id: 1 } })).toBe(false);
    expect(isPrivacyListsReader({ strategy: { name: 'content-api-token' }, credentials: { name: 'site-preview' } })).toBe(false);
    expect(isPrivacyListsReader({ strategy: { name: 'content-api-token' }, credentials: { name: 'site-build' } })).toBe(true);
  });
  it('never over MCP', () => {
    expect(isMcpRequest({ path: '/mcp' })).toBe(true);
    expect(isMcpRequest({ path: '/mcp/session' })).toBe(true);
    expect(isMcpRequest({ path: '/content-manager/single-types/x' })).toBe(false);
    expect(isMcpRequest(undefined)).toBe(false);
  });
});

/** A fake admin API holding one Privacy lists entry. */
function fakeAdmin(entry: Record<string, unknown> | null, status = 200) {
  const calls: { method: string; url: string; body?: any }[] = [];
  let current = entry;
  const impl = (async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined });
    if (status !== 200) return new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status });
    if (init.method === 'PUT') current = { documentId: 'd', ...JSON.parse(init.body) };
    return new Response(JSON.stringify({ data: current }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('local tools: file > env > Strapi', () => {
  it('uses the file, then env, then the admin API', async () => {
    const admin = fakeAdmin(DB_ENTRY);
    const env = { STRAPI_URL: 'http://localhost:1337', STRAPI_ADMIN_TOKEN: 't', PRIVACY_LOCAL_JSON: JSON.stringify(ENV_LISTS) } as any;
    expect((await loadLocalOrRemote(tmpRoot(true), { env, fetchImpl: admin.impl })).source).toBe('file');
    expect((await loadLocalOrRemote(tmpRoot(false), { env, fetchImpl: admin.impl })).source).toBe('env');
    expect(admin.calls).toHaveLength(0);
    const r = await loadLocalOrRemote(tmpRoot(false), { env: { ...env, PRIVACY_LOCAL_JSON: '' }, fetchImpl: admin.impl });
    expect(r.source).toBe('strapi');
    expect(admin.calls[0].url).toBe('http://localhost:1337/content-manager/single-types/api::privacy-lists.privacy-lists');
  });
  it('skips with a note: no token, an empty entry, a CMS without the type', async () => {
    expect((await loadLocalOrRemote(tmpRoot(false), { env: { STRAPI_URL: 'http://localhost:1337' } as any })).note).toMatch(/no STRAPI_ADMIN_TOKEN/);
    const env = { STRAPI_URL: 'http://localhost:1337', STRAPI_ADMIN_TOKEN: 't' } as any;
    expect((await loadLocalOrRemote(tmpRoot(false), { env, fetchImpl: fakeAdmin(null).impl })).note).toMatch(/is empty/);
    expect((await loadLocalOrRemote(tmpRoot(false), { env, fetchImpl: fakeAdmin(null, 404).impl })).source).toBe('none');
  });
});

describe('privacy:push', () => {
  const env = { STRAPI_URL: 'http://localhost:1337', STRAPI_ADMIN_TOKEN: 't' } as any;
  it('--dry-run prints counts only and sends nothing', async () => {
    const lines: string[] = [];
    const admin = fakeAdmin(null);
    await runPrivacyPush({ argv: ['--dry-run'], cmsRoot: tmpRoot(true), env, fetchImpl: admin.impl, log: (l) => lines.push(l) });
    expect(admin.calls).toHaveLength(0);
    expect(lines).toEqual([
      'privacy:push: config/privacy.local.json: deny 1, IP 1, retired 1, ideas 1, neverSeed 1, model prefix set, test samples set',
      'privacy:push: dry run, nothing sent to localhost:1337',
    ]);
    noTerms(lines);
  });
  it('fills in an empty entry and checks it back', async () => {
    const lines: string[] = [];
    const admin = fakeAdmin(null);
    await runPrivacyPush({ argv: [], cmsRoot: tmpRoot(true), env, fetchImpl: admin.impl, log: (l) => lines.push(l) });
    expect(admin.calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET']);
    expect(admin.calls[1].body).toMatchObject({ denyPatterns: FILE_LISTS.denyPatterns, privateIdeaMods: FILE_LISTS.privateDraft.ideaMods, legacyModelPrefix: 'ZZFP' });
    expect(lines.at(-1)).toMatch(/filled in the Privacy lists on localhost:1337 \(deny 1, IP 1/);
    noTerms(lines);
  });
  it('refuses to overwrite a filled-in entry without --replace', async () => {
    const admin = fakeAdmin(DB_ENTRY);
    await expect(runPrivacyPush({ argv: [], cmsRoot: tmpRoot(true), env, fetchImpl: admin.impl, log: () => {} })).rejects.toThrow(/--replace/);
    expect(admin.calls.map((c) => c.method)).toEqual(['GET']);
    await runPrivacyPush({ argv: ['--replace'], cmsRoot: tmpRoot(true), env, fetchImpl: admin.impl, log: () => {} });
  });
  it('needs something to push, and a token unless dry run', async () => {
    await expect(runPrivacyPush({ argv: ['--dry-run'], cmsRoot: tmpRoot(false), env, log: () => {} })).rejects.toThrow(/nothing to push/);
    await expect(runPrivacyPush({ argv: [], cmsRoot: tmpRoot(true), env: { STRAPI_URL: 'http://localhost:1337' } as any, log: () => {} })).rejects.toThrow(/STRAPI_ADMIN_TOKEN/);
    await expect(runPrivacyPush({ argv: ['--bogus'], cmsRoot: tmpRoot(true), env, log: () => {} })).rejects.toThrow(/unknown argument/);
  });
});
