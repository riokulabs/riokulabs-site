/**
 * Draft preview (ARCHITECTURE §6): pure helpers for the preview Worker. Web Crypto only, so they run in workerd and
 * in Node (unit tests).
 *
 * Flow: Strapi's "Open preview" → GET /preview?path=/blog/x&exp=<unix s>&sig=<HMAC-SHA256(secret, path + "." + exp),
 * base64url> (signed by cms/src/utils/preview-link.ts; valid for 10 minutes; the secret is never in a URL) → the
 * signature (constant-time) and the expiry are checked → a short-lived signed cookie is set (HttpOnly; Secure;
 * SameSite=None; Partitioned, so it works inside the admin iframe even where third-party cookies are blocked) → 302 to
 * the path. Every other request needs that cookie. The secret itself is never stored in the cookie: the cookie is
 * `<expiry>.<HMAC-SHA256(secret, "site-preview:" + expiry)>`.
 */
export const COOKIE = 'site_preview';
export const COOKIE_TTL_S = 60 * 60;   // one hour
/** Lifetime of a link from "Open preview" (the same as PREVIEW_LINK_TTL_S in cms/src/utils/preview-link.ts). */
export const LINK_TTL_S = 10 * 60;
/** Allowed clock difference between the CMS and the Worker. */
const CLOCK_SKEW_S = 60;

const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const base64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Constant-time string equality (compares HMACs of both under a random key, so timing reveals nothing). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const k = hex(crypto.getRandomValues(new Uint8Array(16)));
  const [x, y] = await Promise.all([hmac(k, a), hmac(k, b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/** A preview secret must be long enough to be worth checking (ARCHITECTURE §8: 32+ random bytes). */
export const usableSecret = (s: unknown): s is string => typeof s === 'string' && s.length >= 32;

export async function makeCookieValue(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const exp = nowS + COOKIE_TTL_S;
  return `${exp}.${hex(await hmac(secret, `site-preview:${exp}`))}`;
}

export async function verifyCookieValue(secret: string, value: string | undefined, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!value || !/^\d{9,12}\.[0-9a-f]{64}$/.test(value)) return false;
  const [expStr, mac] = value.split('.');
  const exp = Number(expStr);
  if (!(exp > nowS) || exp > nowS + COOKIE_TTL_S + 60) return false;
  return safeEqual(mac, hex(await hmac(secret, `site-preview:${exp}`)));
}

/** The Set-Cookie header for a preview session. Partitioned (CHIPS): it lives in the admin iframe's partition. */
export async function previewCookie(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  return `${COOKIE}=${await makeCookieValue(secret, nowS)}; Path=/; Max-Age=${COOKIE_TTL_S}; HttpOnly; Secure; SameSite=None; Partitioned`;
}

/** sig of a preview link: HMAC-SHA256(secret, path + "." + exp), base64url without padding. */
export async function signPreviewLink(secret: string, path: string, exp: number): Promise<string> {
  return base64url(await hmac(secret, `${path}.${exp}`));
}

/** Checks a /preview link: a well-formed expiry no further out than a fresh link's, a matching signature, not expired. */
export async function verifyPreviewLink(
  secret: string,
  link: { path: string | null; exp: string | null; sig: string | null },
  nowS = Math.floor(Date.now() / 1000),
): Promise<'ok' | 'expired' | 'invalid'> {
  const { path, exp, sig } = link;
  if (!path || !exp || !sig || !/^\d{9,12}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return 'invalid';
  const expS = Number(exp);
  if (expS > nowS + LINK_TTL_S + CLOCK_SKEW_S) return 'invalid';
  // The signature first: a forged link only ever learns "not valid".
  if (!(await safeEqual(sig, await signPreviewLink(secret, path, expS)))) return 'invalid';
  return expS > nowS ? 'ok' : 'expired';
}

/** Only same-site, plain paths may be previewed (no scheme, no //host, no query, no traversal). */
export function safePreviewPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  if (!/^\/(?!\/)[a-z0-9/_.-]*$/.test(p) || p.split('/').some((seg) => seg === '..')) return null;
  return p;
}

/**
 * GET /preview: a valid signed link sets the session cookie and redirects to its path. Anything else gets a 401
 * (a 400 for a signed but unsafe path) and never a cookie. `headers` are the preview headers (noindex, no-store, CSP).
 */
export async function handlePreviewLink(
  url: URL,
  secret: string,
  headers: Record<string, string>,
  nowS = Math.floor(Date.now() / 1000),
): Promise<Response> {
  const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
  const q = url.searchParams;
  const result = await verifyPreviewLink(secret, { path: q.get('path'), exp: q.get('exp'), sig: q.get('sig') }, nowS);
  if (result === 'expired') return text('Preview link expired. Open preview again from the CMS.', 401);
  if (result !== 'ok') return text('Preview link not valid.', 401);
  const path = safePreviewPath(q.get('path'));
  if (!path) return text('Preview path not allowed.', 400);
  return new Response(null, { status: 302, headers: { ...headers, Location: path, 'Set-Cookie': await previewCookie(secret, nowS) } });
}

/**
 * Headers on every preview response (ARCHITECTURE §6.3). Only the Strapi admin (STRAPI_ADMIN_ORIGIN, a bare origin)
 * may frame the preview; without a valid origin, nothing may.
 */
export function previewHeaders(adminOrigin?: string): Record<string, string> {
  const origin = adminOrigin && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(adminOrigin) ? adminOrigin : "'none'";
  return {
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `frame-ancestors ${origin}`,
    'Referrer-Policy': 'no-referrer',
  };
}
