/**
 * Fail-closed validators for data that comes from the CMS and ends up in file paths or control files
 * (security review round 3, 2026-10-19).
 */
import path from 'node:path';
import identity from '../config/identity.json';

export class UnsafeContentError extends Error {}

/** Media keys are relative paths under the media dirs: no '..' segments, no leading '/', no backslash, no NUL. */
export function assertSafeMediaKey(key: string): string {
  if (typeof key !== 'string' || !key) throw new UnsafeContentError('empty media key');
  if (key.includes('\0') || key.includes('\\') || key.startsWith('/') || /^[a-z]:/i.test(key)) throw new UnsafeContentError(`unsafe media key: ${JSON.stringify(key)}`);
  if (key.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) throw new UnsafeContentError(`unsafe media key: ${JSON.stringify(key)}`);
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) throw new UnsafeContentError(`unsafe media key characters: ${JSON.stringify(key)}`);
  return key;
}

/** Resolve rel under base and prove it stays inside (path.relative must not climb out or be absolute). */
export function resolveInside(base: string, rel: string): string {
  assertSafeMediaKey(rel);
  const root = path.resolve(base);
  const full = path.resolve(root, rel);
  const r = path.relative(root, full);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new UnsafeContentError(`path escapes ${root}: ${rel}`);
  return full;
}

/** External hosts a CMS redirect may point to (https only). Keep in sync with cms redirect schema `to` regex. */
export const REDIRECT_HOSTS = [identity.domain, 'steamcommunity.com', 'mod.io', 'github.com'];

const FROM_RE = /^\/[a-z0-9/_-]*$/;
const TO_LOCAL_RE = /^\/(?!\/)[a-z0-9/_.#?=&-]*$/;
const TO_URL_PATH_RE = /^[A-Za-z0-9/_.#?=&%~+-]*$/;

/** Validate a Redirect entry for the Workers _redirects file. Throws on anything else (fails the build). */
export function assertSafeRedirect(r: { from: unknown; to: unknown }, hosts = REDIRECT_HOSTS): { from: string; to: string } {
  const { from, to } = r;
  if (typeof from !== 'string' || typeof to !== 'string') throw new UnsafeContentError('redirect from/to must be strings');
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(from) || /[\s\x00-\x1f\x7f]/.test(to)) throw new UnsafeContentError(`redirect contains whitespace/control characters: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  if (!FROM_RE.test(from)) throw new UnsafeContentError(`redirect from must match ${FROM_RE}: ${JSON.stringify(from)}`);
  if (TO_LOCAL_RE.test(to) && !to.startsWith('//')) return { from, to };
  let u: URL;
  try {
    u = new URL(to);
  } catch {
    throw new UnsafeContentError(`redirect to is neither site-relative nor a URL: ${JSON.stringify(to)}`);
  }
  const rest = to.slice(`https://${u.host}`.length);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.includes(u.hostname) || !to.startsWith(`https://${u.hostname}`) || !TO_URL_PATH_RE.test(rest)) {
    throw new UnsafeContentError(`redirect to must be site-relative or https on ${hosts.join(', ')}: ${JSON.stringify(to)}`);
  }
  return { from, to };
}
