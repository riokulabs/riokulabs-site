import type { Core } from '@strapi/strapi';

/**
 * Rebuild trigger: when public-facing content changes, ask GitHub Actions to rebuild and redeploy the static site
 * (.github/workflows/pages.yml, `repository_dispatch` type `cms-content-changed`). Strapi's own webhooks can't do this:
 * GitHub needs a `{"event_type": ...}` body, and Strapi webhooks always send their own payload.
 *
 * - What counts: publish, unpublish and delete of any `api::` document (every API content type is rendered by the
 *   site), create/update with status=published, and media file update/delete (a replaced image changes pages).
 *   Draft saves, admin users, roles and other plugin noise are ignored.
 * - Bursts collapse: the dispatch fires `debounceMs` (60 s) after the LAST change, but never later than `maxWaitMs`
 *   (5 min) after the first, with every changed model uid in `client_payload.models`.
 * - Disabled (one info line at boot, nothing else) unless GITHUB_REPO (`owner/name`) and GITHUB_DISPATCH_TOKEN are set.
 *   The token is a fine-grained PAT scoped to that one repository with **Contents: read and write** (GitHub's
 *   requirement for POST /repos/{owner}/{repo}/dispatches). It is never logged.
 * - Failures are logged and swallowed: a GitHub outage must never break publishing (the daily scheduled build catches up).
 *   401/403/404 are logged at error level (expired token, missing permission or wrong repo will not fix themselves).
 * - Shutdown (`destroy`): anything still pending is sent right away, capped at `shutdownTimeoutMs` (5 s), so a
 *   restart inside the debounce window does not lose the rebuild until the daily build.
 */

export const DISPATCH_EVENT = 'cms-content-changed';
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** client_payload allows at most 10 top-level keys and 64 KB; the model list is capped well below that. */
const MAX_MODELS = 50;

type Log = { info: (m: string) => void; warn: (m: string) => void; error?: (m: string) => void };

/** Likely cause of a GitHub refusal that won't fix itself (never includes the token). */
export function dispatchFailureHint(status: number, repo: string): string | undefined {
  if (status === 401) return 'GitHub rejected GITHUB_DISPATCH_TOKEN: it has probably expired or been revoked; create a new one';
  if (status === 403) return `the token may not dispatch on ${repo}: it needs Contents: read and write on that repository`;
  if (status === 404) return `${repo} was not found with this token: check GITHUB_REPO and that the token is scoped to that repository`;
  return undefined;
}

export interface RebuildTriggerOptions {
  repo?: string;
  token?: string;
  debounceMs?: number;
  maxWaitMs?: number;
  /** How long `destroy` may wait for the final dispatch (default 5 s). */
  shutdownTimeoutMs?: number;
  fetch?: typeof fetch;
  log?: Log;
}

export interface RebuildTrigger {
  readonly enabled: boolean;
  /** Record a change to `uid`; schedules (or extends) the pending dispatch. No-op when disabled. */
  notify(uid: string): void;
  /** Send the pending dispatch now (tests, shutdown). Resolves once sent or failed; never rejects. */
  flush(): Promise<void>;
  /** Shutdown: cancel timers, send anything pending now (capped at shutdownTimeoutMs), then ignore new changes. Never rejects. */
  destroy(): Promise<void>;
  /** Model uids waiting for the next dispatch. */
  pending(): string[];
}

/** Content types the site renders: every API content type, plus media files (they appear on the pages). */
export function isSiteContent(uid: unknown): boolean {
  return typeof uid === 'string' && (uid.startsWith('api::') || uid === 'plugin::upload.file');
}

/** Document Service actions that change what the public build can see. */
export function isPublicChange(action: unknown, params: any): boolean {
  if (action === 'publish' || action === 'unpublish' || action === 'delete') return true;
  return (action === 'create' || action === 'update') && params?.status === 'published';
}

export function createRebuildTrigger(opts: RebuildTriggerOptions = {}): RebuildTrigger {
  const repo = (opts.repo ?? '').trim();
  const token = (opts.token ?? '').trim();
  const log: Log = opts.log ?? { info: () => undefined, warn: () => undefined };
  const debounceMs = Number.isFinite(opts.debounceMs) && opts.debounceMs! >= 0 ? opts.debounceMs! : 60_000;
  const maxWaitMs = Math.max(opts.maxWaitMs ?? 5 * 60_000, debounceMs);
  const shutdownTimeoutMs = Number.isFinite(opts.shutdownTimeoutMs) && opts.shutdownTimeoutMs! >= 0 ? opts.shutdownTimeoutMs! : 5_000;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const logError = (m: string) => (log.error ?? log.warn)(m);

  let enabled = !!repo && !!token;
  if (enabled && !REPO_RE.test(repo)) {
    log.warn(`[rebuild] GITHUB_REPO must look like owner/name; site rebuild trigger disabled`);
    enabled = false;
  } else if (!enabled) {
    log.info('[rebuild] GITHUB_REPO / GITHUB_DISPATCH_TOKEN not set; site rebuild trigger disabled');
  }

  const models = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstAt = 0;
  let destroyed = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function send(timeoutMs = 15_000): Promise<void> {
    clear();
    if (!models.size) return;
    const list = [...models].sort().slice(0, MAX_MODELS);
    models.clear();
    firstAt = 0;
    try {
      const res = await doFetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'riokulabs-cms-rebuild-trigger',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ event_type: DISPATCH_EVENT, client_payload: { models: list } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const hint = dispatchFailureHint(res.status, repo);
      if (res.status === 204 || res.ok) log.info(`[rebuild] site rebuild requested on ${repo} (${list.join(', ')})`);
      else if (hint) logError(`[rebuild] GitHub answered ${res.status} to the rebuild request: ${hint}. The site will not rebuild on publish until this is fixed.`);
      else log.warn(`[rebuild] GitHub answered ${res.status} to the rebuild request (check GITHUB_REPO and the token's Contents: write permission)`);
    } catch (e) {
      log.warn(`[rebuild] rebuild request failed: ${(e as Error)?.name ?? 'Error'}: ${(e as Error)?.message ?? e}`);
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    notify(uid: string) {
      if (!enabled || destroyed || !isSiteContent(uid)) return;
      const now = Date.now();
      if (!models.size) firstAt = now;
      models.add(uid);
      clear();
      const wait = Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now));
      timer = setTimeout(() => void send(), wait);
      (timer as any).unref?.();
    },
    flush: () => send(),
    async destroy() {
      destroyed = true;
      clear();
      if (!models.size) return;
      log.info('[rebuild] shutting down with changes pending: requesting the site rebuild now');
      let cap: ReturnType<typeof setTimeout> | undefined;
      const capped = new Promise<void>((resolve) => {
        cap = setTimeout(() => {
          log.warn(`[rebuild] rebuild request still unanswered after ${shutdownTimeoutMs} ms at shutdown; the daily build will catch up`);
          resolve();
        }, shutdownTimeoutMs);
        (cap as any).unref?.();
      });
      await Promise.race([send(shutdownTimeoutMs), capped]);
      clearTimeout(cap);
      models.clear();
    },
    pending: () => [...models].sort(),
  };
}

/**
 * Wire the trigger into Strapi. Call from `register` (Document Service middlewares must be added there); then call
 * `subscribeMediaChanges` from `bootstrap` (DB lifecycles) and `await trigger.destroy()` from `destroy`.
 */
export function registerRebuildTrigger(strapi: Core.Strapi, env: NodeJS.ProcessEnv = process.env): RebuildTrigger {
  const trigger = createRebuildTrigger({
    repo: env.GITHUB_REPO,
    token: env.GITHUB_DISPATCH_TOKEN,
    debounceMs: env.REBUILD_DEBOUNCE_MS ? Number(env.REBUILD_DEBOUNCE_MS) : undefined,
    log: { info: (m) => strapi.log.info(m), warn: (m) => strapi.log.warn(m), error: (m) => strapi.log.error(m) },
  });
  if (!trigger.enabled) return trigger;

  strapi.documents.use(async (context, next) => {
    const { uid, action, params } = context as any;
    const result = await next();
    // Only after the change succeeded (a rejected publish must not trigger a build).
    try {
      if (String(uid).startsWith('api::') && isPublicChange(action, params)) trigger.notify(String(uid));
    } catch {
      /* never break the write */
    }
    return result;
  });
  return trigger;
}

/** Media files: a replaced or deleted file changes the pages that use it (the upload plugin bypasses documents). */
export function subscribeMediaChanges(strapi: Core.Strapi, trigger: RebuildTrigger): void {
  if (!trigger.enabled) return;
  strapi.db.lifecycles.subscribe({
    models: ['plugin::upload.file'],
    afterUpdate: () => trigger.notify('plugin::upload.file'),
    afterDelete: () => trigger.notify('plugin::upload.file'),
  } as any);
}
