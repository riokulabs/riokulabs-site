# Privacy lists

The real privacy terms (private project patterns, IP deny terms, retired names, private idea entries, never-seed
paths) are never committed. They live in the CMS, in the admin-only single type **Privacy lists**
(Content Manager > Settings > Privacy lists). The committed `config/privacy.json` holds only the mechanism and
synthetic canary terms; every consumer merges the two.

## Who reads them

| Consumer | Source, in order |
| --- | --- |
| Publish guard (running CMS) | the Privacy lists entry, then `config/privacy.local.json`, then `PRIVACY_LOCAL_JSON` |
| Site build, Strapi mode (`fetch-content`, `lint-dist`) | `GET /api/privacy-lists` with `STRAPI_BUILD_TOKEN`, then the local file, then the variable |
| Site build, fixtures (CI) | the local file or variable if present, else the public canaries |
| `npm run check:public`, `npm run privacy-audit` | the local file, the variable, then the entry over the admin API (`STRAPI_ADMIN_TOKEN` in `cms/.env`); else skipped (check) or canaries only (audit) |

The entry is cached in the CMS and reloaded after every save, so a new term blocks publishing at once.

## What each list covers

IP terms are product rules, not discussion rules.

| List | Where it applies |
| --- | --- |
| `denyPatterns` (private projects) | everywhere, blog posts included |
| `retiredBrandTerms` (old studio names) | everywhere, blog posts included |
| `ipDenyTerms` (third-party IP) | everything except blog posts |

The IP list keeps names of other people's shows, films and games out of what is ours: mods (name, slug, tagline,
summary, features, specs, body), 3D block models, mod releases, timeline families and milestones, site settings,
navigation, the home, about, brand and legal pages, their SEO fields, and the media attached to them. A blog post may
name the work that inspired a mod (a nominative, fan reference), so blog posts skip the IP list in every field: title,
excerpt, body, captions, alt text and SEO. Nothing adds a disclaimer automatically.

Where the scope is set:

- CMS: `IP_EXEMPT_TYPES` in `src/utils/privacy.ts` (`api::blog-post.blog-post`), used by the publish guard, the seed
  lint and `npm run privacy-audit` (which also skips the IP list for the components inside blog posts and for media in
  `Blog/` folders, `isIpExemptFolder`).
- Media upload: `npm run media:upload -- ... --folder "Blog/..."` skips the IP list for the alt text, caption and
  name; any other folder (or none) keeps it (`scripts/README-media-upload.md`).
- Site build: `IP_EXEMPT_COLLECTIONS` in `web/src/lib/privacy.ts` (the build assertion skips the IP list for
  `blogPosts`), and in `dist/` `isIpExemptPath` (`blog.html`, `blog/**`, `og/blog/**`) plus `maskIpExempt`: post
  cards on other pages (between the markers in `PostCard.astro`), RSS items and post URLs. Everything else in
  `dist/`, including the blog index chrome from site settings and `mods/releases.xml`, is checked for IP terms.
- `npm run check:public` still scans every tracked file for IP terms. Blog drafts live in the CMS, not in the repo.

## Rules

- No public access. The Public and Authenticated roles have no permissions. `GET /api/privacy-lists` is the only
  content-API route; it needs an API token other than the preview token (`src/policies/privacy-lists-reader.ts`),
  and it answers with the three build lists only (deny, IP, retired).
- The `site-build` API token needs **find** on Privacy-lists. `npm run tokens` grants it locally; on Strapi Cloud
  tick it in Settings > API Tokens > site-build. Without it a Strapi build fails with a message saying so.
- Not available over MCP or the `npm run cms` CLI, so an AI client never copies the terms.
- Saving checks every pattern compiles; errors name the field and item number, never the text.

## Empty lists

Strapi boots without any lists. In production the publish guard then refuses to publish anything public (private
entries still publish) with "Privacy lists are empty; fill in Settings > Privacy lists first." `PRIVACY_REQUIRE_LISTS=1`
turns that rule on elsewhere, `0` off. A Strapi build of the site also fails without lists.

## Filling them in

- `npm run privacy:push` (in `cms/`) copies `config/privacy.local.json` (or `PRIVACY_LOCAL_JSON`) into the entry
  through the admin API with `STRAPI_ADMIN_TOKEN` and `STRAPI_URL` from `cms/.env`. It prints counts only.
  `--dry-run` validates and counts without contacting Strapi; `--replace` overwrites a filled-in entry.
- At startup, an empty entry is seeded once from the local file or `PRIVACY_LOCAL_JSON` when either is set.
- Or edit the JSON fields in the admin.
