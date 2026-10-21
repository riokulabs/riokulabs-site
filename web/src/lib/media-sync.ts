/**
 * Node-only helpers for scripts/fetch-content.ts: download one CMS media file with a timeout and retries, and prune
 * the download cache to the files the current build uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveInside, UnsafeContentError } from './safety';

export class MediaDownloadError extends Error {}

export interface DownloadOptions {
  /** Extra attempts after the first (default 3). */
  retries?: number;
  /** Per attempt, including reading the body (default 30 s). */
  timeoutMs?: number;
  /** Backoff before retry n is baseDelayMs * 2^n (default 1 s). */
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  /** What to name in errors (the media key; defaults to the URL path). */
  label?: string;
}

/**
 * GET a media file. Network errors, timeouts, 408, 429 and 5xx are retried with exponential backoff; any other 4xx
 * fails at once (a missing or forbidden file will not appear on retry).
 */
export async function downloadMedia(url: string, opts: DownloadOptions = {}): Promise<Buffer> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const baseDelayMs = opts.baseDelayMs ?? 1_000;
  const fetchImpl = opts.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  const label = opts.label ?? url.split('?')[0];
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new MediaDownloadError(`media download failed (HTTP ${res.status}, not retried): ${label}`);
      }
      last = `HTTP ${res.status}`;
    } catch (e) {
      if (e instanceof MediaDownloadError) throw e;
      const err = e as Error;
      last = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : `${err?.name ?? 'Error'}: ${err?.message ?? e}`;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
  }
  throw new MediaDownloadError(`media download failed after ${retries + 1} attempts (${last}): ${label}`);
}

/**
 * Delete every file under `dir` whose relative path is not in `keep`. Only files with a safe media key are touched,
 * each resolved with resolveInside(dir, …), so nothing outside `dir` can ever be removed. Returns the count removed.
 */
export function pruneDir(dir: string, keep: ReadonlySet<string>): number {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const d of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const rel = path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/');
    if (keep.has(rel)) continue;
    let full: string;
    try {
      full = resolveInside(dir, rel);
    } catch (e) {
      if (e instanceof UnsafeContentError) continue; // not a name we ever write: leave it alone
      throw e;
    }
    fs.unlinkSync(full);
    removed++;
  }
  return removed;
}
