/**
 * Studio identity and the logo switch. The identity values live in identity.json (one line each) so plain-Node
 * tools (astro.config.mjs, the CMS seed) can read them too.
 */
import identity from './identity.json';

/** Display name ("Rioku Labs"). */
export const STUDIO_NAME: string = identity.name;
/** Primary domain; the canonical origin is https://<domain> unless SITE_URL overrides it (pre-launch workers.dev). */
export const STUDIO_DOMAIN: string = identity.domain;
/** GitHub organisation that owns the mod and site repositories. */
export const GITHUB_ORG: string = identity.githubOrg;
/** Domains that 301 to the primary one (configured in Cloudflare, DEPLOY.md step 7). */
export const REDIRECT_DOMAINS: string[] = identity.redirectDomains;
export const githubRepoUrl = (repo: string) => `https://github.com/${GITHUB_ORG}/${repo}`;

/**
 * THE logo switch. A concept id from brand/riokulabs/ ('R1'…'R5') installs that concept's family; 'text' renders the
 * plain Barlow Condensed text wordmark (the fallback; no image files needed). R4 (Lab flask) picked by the user on 2026-10-20
 * (2026-10-20). scripts/brand.ts reads this too.
 */
export const LOGO_FAMILY: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'text' = 'R4';
