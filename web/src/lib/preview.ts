/**
 * Draft preview (ARCHITECTURE §6): pure helpers for the preview Worker. Web Crypto only, so they run in workerd and
 * in Node (unit tests).
 *
 * Flow: Strapi's "Open preview" → GET /preview?secret=…&path=/blog/x&status=draft → the secret is checked
 * (constant-time, via HMAC) → a short-lived signed cookie is set (HttpOnly; Secure; SameSite=None, so it works inside
 * the admin iframe) → 302 to the path. Every other request needs that cookie. The secret itself is never stored in
 * the cookie: the cookie is `<expiry>.<HMAC-SHA256(secret, "site-preview:" + expiry)>`.
 */
export const COOKIE = 'site_preview';
export const COOKIE_TTL_S = 60 * 60;   // one hour

const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

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

/** Only same-site, plain paths may be previewed (no scheme, no //host, no query, no traversal). */
export function safePreviewPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  if (!/^\/(?!\/)[a-z0-9/_.-]*$/.test(p) || p.split('/').some((seg) => seg === '..')) return null;
  return p;
}

/** Headers on every preview response (ARCHITECTURE §6.3). */
export function previewHeaders(adminOrigin?: string): Record<string, string> {
  const origin = adminOrigin && /^https?:\/\/[a-z0-9.:-]+$/i.test(adminOrigin) ? adminOrigin : "'self'";
  return {
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `frame-ancestors ${origin}`,
    'Referrer-Policy': 'no-referrer',
  };
}
