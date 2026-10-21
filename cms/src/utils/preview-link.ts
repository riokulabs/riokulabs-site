/**
 * Signed, expiring preview links (ARCHITECTURE §6). Strapi's "Open preview" gets
 *   <PREVIEW_URL>/preview?path=<path>&exp=<unix seconds>&sig=<HMAC-SHA256(PREVIEW_SECRET, path + '.' + exp), base64url>
 * so the long-lived secret never appears in a URL, browser history or a log. The preview Worker
 * (web/src/lib/preview.ts, verifyPreviewLink) checks the same signature and the expiry, then sets its session cookie.
 * Both sides are tested against the same fixed vector, so they can't drift apart.
 */
import crypto from 'node:crypto';

/** How long a link from "Open preview" stays usable. */
export const PREVIEW_LINK_TTL_S = 10 * 60;

/** A preview secret must be long enough to be worth signing with (ARCHITECTURE §8: 32+ random bytes). */
export const usablePreviewSecret = (s: unknown): s is string => typeof s === 'string' && s.length >= 32;

export function signPreviewPath(secret: string, path: string, exp: number): string {
  return crypto.createHmac('sha256', secret).update(`${path}.${exp}`).digest('base64url');
}

/** The full preview URL for a site path, or null when preview isn't configured (no URL or a too-short secret). */
export function previewLink(
  baseUrl: string | undefined,
  secret: string | undefined,
  path: string,
  nowS = Math.floor(Date.now() / 1000),
): string | null {
  if (!baseUrl || !usablePreviewSecret(secret)) return null;
  const exp = nowS + PREVIEW_LINK_TTL_S;
  const params = new URLSearchParams({ path, exp: String(exp), sig: signPreviewPath(secret, path, exp) });
  return `${baseUrl.replace(/\/+$/, '')}/preview?${params}`;
}
