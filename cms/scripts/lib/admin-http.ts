/**
 * Shared helpers for CLI scripts that talk to Strapi's admin API with an admin token (media-upload, cms): env reading,
 * the URL check, error formatting and a small JSON client. No Strapi imports; `fetch` is injectable for tests.
 * Tokens are only ever sent in the Authorization header, never printed or put in a URL.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_URL = 'https://cms.rioku.dev';

export class UsageError extends Error {}

export interface Env { url: string; token?: string; adminToken?: string }

/**
 * STRAPI_URL, STRAPI_ADMIN_TOKEN and STRAPI_UPLOAD_TOKEN from the environment, else from cms/.env (only those three
 * keys are read).
 */
export function readEnv(cmsRoot: string, env = process.env): Env {
  const fileVars: Record<string, string> = {};
  const envFile = path.join(cmsRoot, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*(STRAPI_URL|STRAPI_UPLOAD_TOKEN|STRAPI_ADMIN_TOKEN)\s*=\s*(.*?)\s*$/);
      if (m) fileVars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return {
    url: env.STRAPI_URL || fileVars.STRAPI_URL || DEFAULT_URL,
    token: env.STRAPI_UPLOAD_TOKEN || fileVars.STRAPI_UPLOAD_TOKEN || undefined,
    adminToken: env.STRAPI_ADMIN_TOKEN || fileVars.STRAPI_ADMIN_TOKEN || undefined,
  };
}

/** Allow plain http only for a local Strapi: the token must not cross the network unencrypted. */
export function checkUrl(url: string): string {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new UsageError(`STRAPI_URL must be https (or http on localhost): ${url}`);
  return u.origin;
}

/**
 * "HTTP 403 Forbidden" plus Strapi's validation details and, on the admin API, a hint for 401/403. Built from the
 * response only, so it never holds the token.
 */
export function httpError(status: number, text: string, opts: { admin: boolean; forbiddenHint?: string }): string {
  let msg = text.slice(0, 300);
  try {
    const err = JSON.parse(text)?.error;
    if (err?.message) {
      msg = err.message;
      const details = (err.details?.errors ?? []) as { path?: string[]; message?: string }[];
      if (details.length) msg += `: ${details.slice(0, 5).map((d) => `${(d.path ?? []).join('.')} ${d.message ?? ''}`.trim()).join('; ')}`;
    }
  } catch {
    /* not JSON */
  }
  let hint = '';
  if (opts.admin && status === 401) hint = ' (admin token rejected: expired, revoked, or its owner is deactivated)';
  if (opts.admin && status === 403 && opts.forbiddenHint) hint = ` (${opts.forbiddenHint})`;
  return `HTTP ${status} ${msg}${hint}`;
}

export type Query = Record<string, string | number | boolean | undefined>;

/** A JSON client for the admin API. */
export class AdminClient {
  constructor(
    readonly base: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly forbiddenHint?: string,
  ) {}

  async request<T = any>(method: 'GET' | 'POST' | 'PUT', route: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) qs.append(k, String(v));
    const url = `${this.base}${route}${qs.size ? `?${qs}` : ''}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${route} failed: ${httpError(res.status, text, { admin: true, forbiddenHint: this.forbiddenHint })}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T = any>(route: string, query?: Query) {
    return this.request<T>('GET', route, { query });
  }
  post<T = any>(route: string, body?: unknown) {
    return this.request<T>('POST', route, { body });
  }
  put<T = any>(route: string, body?: unknown) {
    return this.request<T>('PUT', route, { body });
  }
}
