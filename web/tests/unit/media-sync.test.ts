import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadMedia, MediaDownloadError, pruneDir } from '../../src/lib/media-sync';

function fakeFetch(steps: Array<number | Error | 'hang'>) {
  const calls: Array<RequestInit | undefined> = [];
  const impl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    if (step === 'hang') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    return new Response(step === 200 ? 'IMAGE' : 'err', { status: step });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const fast = { baseDelayMs: 1 };

describe('media download', () => {
  it('returns the body on success, with a timeout signal on the request', async () => {
    const f = fakeFetch([200]);
    const buf = await downloadMedia('https://cdn.example/x.jpg', { ...fast, fetchImpl: f.impl });
    expect(buf.toString()).toBe('IMAGE');
    expect(f.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('retries network errors and 5xx, then succeeds', async () => {
    const f = fakeFetch([new TypeError('fetch failed'), 503, 500, 200]);
    const buf = await downloadMedia('https://cdn.example/x.jpg', { ...fast, fetchImpl: f.impl });
    expect(buf.toString()).toBe('IMAGE');
    expect(f.calls).toHaveLength(4); // 1 try + 3 retries
  });
  it('gives up after 3 retries with a clear message naming the media key', async () => {
    const f = fakeFetch([502]);
    await expect(downloadMedia('https://cdn.example/x.jpg', { ...fast, fetchImpl: f.impl, label: 'strapi/x.jpg' }))
      .rejects.toThrow(/after 4 attempts \(HTTP 502\): strapi\/x\.jpg/);
    expect(f.calls).toHaveLength(4);
  });
  it('fails at once on a 4xx (not retried)', async () => {
    for (const status of [400, 401, 403, 404]) {
      const f = fakeFetch([status]);
      const err = await downloadMedia('https://cdn.example/x.jpg', { ...fast, fetchImpl: f.impl, label: 'strapi/x.jpg' }).catch((e) => e);
      expect(err).toBeInstanceOf(MediaDownloadError);
      expect(String(err.message)).toMatch(new RegExp(`HTTP ${status}, not retried`));
      expect(f.calls).toHaveLength(1);
    }
  });
  it('retries 408 and 429', async () => {
    const f = fakeFetch([408, 429, 200]);
    await expect(downloadMedia('https://cdn.example/x.jpg', { ...fast, fetchImpl: f.impl })).resolves.toBeInstanceOf(Buffer);
    expect(f.calls).toHaveLength(3);
  });
  it('times out a hanging request and retries it', async () => {
    const f = fakeFetch(['hang']);
    await expect(downloadMedia('https://cdn.example/x.jpg', { ...fast, timeoutMs: 20, retries: 1, fetchImpl: f.impl }))
      .rejects.toThrow(/after 2 attempts \(timed out after 20 ms\)/);
    expect(f.calls).toHaveLength(2);
  });
});

describe('download cache pruning', () => {
  let root: string;
  let cache: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-sync-'));
    cache = path.join(root, 'cache');
    for (const rel of ['strapi/keep.jpg', 'strapi/old.jpg', 'strapi/old.mp4', 'strapi/half.jpg.part', 'strapi/we ird.jpg']) {
      fs.mkdirSync(path.dirname(path.join(cache, rel)), { recursive: true });
      fs.writeFileSync(path.join(cache, rel), 'x');
    }
    fs.writeFileSync(path.join(root, 'outside.jpg'), 'x');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('removes files the build did not use and keeps the rest', () => {
    expect(pruneDir(cache, new Set(['strapi/keep.jpg']))).toBe(3);
    expect(fs.existsSync(path.join(cache, 'strapi/keep.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(cache, 'strapi/old.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(cache, 'strapi/old.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(cache, 'strapi/half.jpg.part'))).toBe(false);
  });
  it('never touches files outside the cache dir or with names it would never write', () => {
    pruneDir(cache, new Set());
    expect(fs.existsSync(path.join(root, 'outside.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(cache, 'strapi/we ird.jpg'))).toBe(true);
  });
  it('is a no-op when the cache does not exist yet', () => {
    expect(pruneDir(path.join(root, 'missing'), new Set())).toBe(0);
  });
});
