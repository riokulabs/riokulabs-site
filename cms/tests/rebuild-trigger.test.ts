import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRebuildTrigger,
  DISPATCH_EVENT,
  isPublicChange,
  isSiteContent,
  registerRebuildTrigger,
  subscribeMediaChanges,
} from '../src/rebuild-trigger';

const TOKEN = 'github_pat_test_value_not_real';
const ok = () => Promise.resolve(new Response(null, { status: 204 }));
function setup(extra: Record<string, unknown> = {}) {
  const fetch = vi.fn(ok);
  const log = { info: vi.fn(), warn: vi.fn() };
  const t = createRebuildTrigger({ repo: 'riokulabs/riokulabs-site', token: TOKEN, debounceMs: 60_000, fetch: fetch as any, log, ...extra });
  return { t, fetch, log };
}
const logged = (log: { info: any; warn: any }) => [...log.info.mock.calls, ...log.warn.mock.calls].flat().join('\n');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('rebuild trigger: what counts', () => {
  it('only site content types', () => {
    expect(isSiteContent('api::mod.mod')).toBe(true);
    expect(isSiteContent('plugin::upload.file')).toBe(true);
    for (const uid of ['admin::user', 'plugin::users-permissions.user', 'plugin::users-permissions.role', 'plugin::i18n.locale', undefined]) {
      expect(isSiteContent(uid), String(uid)).toBe(false);
    }
  });
  it('only publish, unpublish, delete and published writes', () => {
    for (const a of ['publish', 'unpublish', 'delete']) expect(isPublicChange(a, {})).toBe(true);
    expect(isPublicChange('update', { status: 'published' })).toBe(true);
    expect(isPublicChange('create', { status: 'published' })).toBe(true);
    for (const a of ['update', 'create', 'discardDraft', 'findMany', 'findOne', 'count']) expect(isPublicChange(a, {}), a).toBe(false);
  });
});

describe('rebuild trigger: dispatch', () => {
  it('collapses a burst into one dispatch after the debounce', async () => {
    const { t, fetch } = setup();
    t.notify('api::mod.mod');
    await vi.advanceTimersByTimeAsync(30_000);
    t.notify('api::blog-post.blog-post');
    t.notify('api::mod.mod');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetch).not.toHaveBeenCalled(); // debounce restarts on each change
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(t.pending()).toEqual([]);
  });

  it('never waits longer than maxWait under constant activity', async () => {
    const { t, fetch } = setup({ maxWaitMs: 120_000 });
    for (let i = 0; i < 6; i++) {
      t.notify('api::mod.mod');
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends the GitHub repository_dispatch payload', async () => {
    const { t, fetch, log } = setup();
    t.notify('api::mod.mod');
    t.notify('plugin::upload.file');
    t.notify('admin::user'); // ignored
    await t.flush();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/riokulabs/riokulabs-site/dispatches');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((init.headers as Record<string, string>).Accept).toBe('application/vnd.github+json');
    expect(JSON.parse(String(init.body))).toEqual({ event_type: DISPATCH_EVENT, client_payload: { models: ['api::mod.mod', 'plugin::upload.file'] } });
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(logged(log)).not.toContain(TOKEN);
  });

  it('does nothing when the env vars are missing or malformed', async () => {
    for (const opts of [{ repo: '', token: TOKEN }, { repo: 'riokulabs/riokulabs-site', token: '' }, { repo: 'not a repo', token: TOKEN }]) {
      const fetch = vi.fn(ok);
      const log = { info: vi.fn(), warn: vi.fn() };
      const t = createRebuildTrigger({ ...opts, fetch: fetch as any, log });
      expect(t.enabled).toBe(false);
      t.notify('api::mod.mod');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await t.flush();
      expect(fetch).not.toHaveBeenCalled();
      expect(log.info.mock.calls.length + log.warn.mock.calls.length).toBe(1); // one line at boot
    }
  });

  it('swallows network errors and non-2xx answers (logged, token not logged)', async () => {
    const { t, fetch, log } = setup();
    fetch.mockImplementationOnce(() => Promise.reject(new TypeError('fetch failed')));
    t.notify('api::mod.mod');
    await expect(t.flush()).resolves.toBeUndefined();
    fetch.mockImplementationOnce(() => Promise.resolve(new Response('{"message":"Bad credentials"}', { status: 401 })));
    t.notify('api::mod.mod');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(logged(log)).toMatch(/401/);
    expect(logged(log)).not.toContain(TOKEN);
  });

  it('destroy cancels a pending dispatch', async () => {
    const { t, fetch } = setup();
    t.notify('api::mod.mod');
    t.destroy();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('rebuild trigger: Strapi wiring', () => {
  function fakeStrapi() {
    const mws: any[] = [];
    const subs: any[] = [];
    const strapi: any = {
      log: { info: vi.fn(), warn: vi.fn() },
      documents: { use: (mw: any) => mws.push(mw) },
      db: { lifecycles: { subscribe: (s: any) => subs.push(s) } },
    };
    return { strapi, mws, subs };
  }

  it('registers nothing when disabled', () => {
    const { strapi, mws, subs } = fakeStrapi();
    const t = registerRebuildTrigger(strapi, {});
    subscribeMediaChanges(strapi, t);
    expect(t.enabled).toBe(false);
    expect(mws).toHaveLength(0);
    expect(subs).toHaveLength(0);
  });

  it('notifies after a successful publish only, and never breaks the write', async () => {
    const { strapi, mws, subs } = fakeStrapi();
    const t = registerRebuildTrigger(strapi, { GITHUB_REPO: 'riokulabs/riokulabs-site', GITHUB_DISPATCH_TOKEN: TOKEN });
    subscribeMediaChanges(strapi, t);
    const [mw] = mws;
    await expect(mw({ uid: 'api::mod.mod', action: 'update', params: {} }, async () => 'draft')).resolves.toBe('draft');
    expect(t.pending()).toEqual([]);
    await expect(mw({ uid: 'api::mod.mod', action: 'publish', params: {} }, async () => { throw new Error('guard'); })).rejects.toThrow('guard');
    expect(t.pending()).toEqual([]);
    await expect(mw({ uid: 'api::mod.mod', action: 'publish', params: {} }, async () => 'ok')).resolves.toBe('ok');
    await mw({ uid: 'admin::user', action: 'delete', params: {} }, async () => 'ok');
    subs[0].afterUpdate();
    expect(subs[0].models).toEqual(['plugin::upload.file']);
    expect(t.pending()).toEqual(['api::mod.mod', 'plugin::upload.file']);
    t.destroy();
  });
});
