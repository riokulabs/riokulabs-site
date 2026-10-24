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
