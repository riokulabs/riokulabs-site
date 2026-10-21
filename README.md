# riokulabs-site

The **Rioku Labs** website (**rioku.dev**): a game-mod studio site, structured by game (Space Engineers 2 first).
**Strapi 5** CMS in `cms/`, **Astro 7** static site in `web/`.
The spec lives in the workspace at `docs/website/` (HANDOFF, SPEC, ARCHITECTURE, CONTENT-MODEL). Progress and
deviations are logged in `docs/website/BUILD-LEDGER.md`.

Status: milestones M0–M8 built and tested **locally**. Nothing is deployed, no accounts exist, no remote is set.
M7 (3D viewer) and M8 (logo) are built; M9 (deploy) is blocked on the user's accounts: see `DEPLOY.md`.
**2026-10-20 rebrand:** the studio became **Rioku Labs** (rioku.dev, GitHub org `riokulabs`),
and the site became game-structured (`/games`, `/games/<game>`, mods at `/games/<game>/mods/<mod>`; the old
`/mods/<slug>` URLs 301 there). Logo: **R4 Lab flask**, picked by the user on 2026-10-20 from five concepts (see `brand/README.md`).

## Identity, in one place

`web/src/config/identity.json` holds the studio **name** ("Rioku Labs"), the primary **domain** (`rioku.dev`), the
GitHub **org** (`riokulabs`) and the domains that redirect to it. Change a line there and the site (titles, canonical
URLs, feeds, OG cards, footer, JSON-LD, manifest) and the CMS seed follow. `SITE_URL` (env) still overrides the
canonical origin, e.g. a `*.workers.dev` URL before launch. The logo is the separate `LOGO_FAMILY` switch.

## Games, mods and URLs

- A **Game** (CMS collection `game`: name, slug, short name, tagline, summary, art, links, platform notes, trademark
  notice) owns its mods: `Mod.game` (required in practice) and `BlogPost.games`.
- Pages: `/games` (index), `/games/<game>` (its mods by status, install notes, posts, trademark line),
  `/games/<game>/mods/<mod>` and `/games/<game>/mods/<mod>/history`. `/mods` stays as the all-games index.
- **Old URLs keep working:** the build writes a 301 for every built mod from `/mods/<slug>` (and `/mods/<slug>/history`
  where a history page exists) to its game URL into `dist/_redirects` (after any CMS Redirect entries, which win).
- **Privacy:** a game is a visibility-gated collection like the rest. A mod whose game is private or missing is not
  built at all (no page, card, redirect, feed item), so hiding a game hides everything under it.
- Game art must be our own renders or captures, never a publisher's key art.

## Run it locally

Needs Node 24 (Strapi 5.58 supports 20–26; Astro 7 needs ≥ 22.22), npm, and `ffmpeg` only for `prepare-media`.

```bash
npm run install:all              # root + cms + web dependencies
cp cms/.env.example cms/.env     # then generate the secrets it lists (once)

npm run dev                      # Strapi on http://127.0.0.1:1337/admin  +  site on http://localhost:4321
# or separately:
npm run dev:cms                  # Strapi only (SQLite at cms/.tmp/data.db)
npm run dev:web                  # site only
```

The first time you open http://127.0.0.1:1337/admin, Strapi asks you to create the local admin user (local only).
If the dev command is run by an AI agent, Astro 7 starts its dev server in the background (`cd web && npx astro dev stop`
to stop it); from a normal terminal both servers stay in the foreground and Ctrl+C stops them.

**Where the site gets its content** (`web/.env`, `SITE_DATA`):

| `SITE_DATA` | Source | Use |
|---|---|---|
| `fixtures` (default) | `web/fixtures/content.json` | Offline work and CI. Shows the **proposed launch state** for review (Data Center, history, idea cards and the four drafted posts all visible) plus private canaries that must never render |
| `strapi` | the CMS at `STRAPI_URL` with `STRAPI_BUILD_TOKEN` | What production will do: only **published + public** content (plus unlisted pages by URL) |

```bash
cd cms && npm run tokens         # creates/rotates the local site-build + site-preview tokens, writes them to web/.env
cd web && SITE_DATA=strapi npm run build
```

With the seed as it stands (everything private until the user approves it) a Strapi build has no mods, posts or
history: that is the privacy gate working.

## Seeding the CMS

```bash
cd cms
npm run prepare-media            # copies ONLY allow-listed media from WS/resources into cms/seed/media (+ MANIFEST)
npm run seed                     # idempotent; creates what's missing; confirm-items stay PRIVATE
npm run seed -- --update         # also overwrite existing entries with the seed text (loses admin edits)
npm run seed -- --approve=games,data-center,history,author,site-copy   # the user's approvals: confirm-items public, site copy published
                                 # (a mod only reaches the site when its game is public too: approve `games` with `data-center`)
npm run privacy-audit            # lists non-public entries, published rows, and any deny/IP hit (exit 1 on a hit)
npm run build:fixtures           # regenerate web/fixtures/content.json from cms/seed/content.ts
```

Seed text lives in `cms/seed/content.ts` (one source for the seed and the fixtures). Blog posts and idea mods are
always created as **private drafts**; publish them yourself in the admin when you're happy.

## Checks

| Command | What it proves |
|---|---|
| `cd cms && npm run check` | schema lint (Draft & Publish everywhere, `visibility` default private, guard on every route), privacy lists in sync with the allowlist, no private term in any tracked file (`check:public`), unit tests |
| `cd cms && npm run test:acceptance` | M1 + security acceptance against a throwaway DB: default private, a canary-named mod ("ZZ private canary test") can't be published, unauthenticated reads denied, private entries invisible to the build token through lists, ids, populate, `status=draft`, relational filters, sorts and dynamic zones |
| `cd web && npm test` | client filter + build assertion, Strapi client (retries, pagination), dist lint, path and redirect safety |
| `cd web && npm run build` | fetch → filter → **build assertion** → Astro build → **privacy canary + IP lint** over `dist/` → RSS checks |
| `cd web && npm run test:e2e` | Playwright: axe (WCAG 2.2 AA) on 11 pages, keyboard paths, reduced motion, filters with JS on/off, lightbox, history, every blog section type |
| `cd web && npm run lighthouse -- --ci` | Lighthouse mobile with the SPEC §6 budgets as assertions (`-- --desktop` for desktop) |
| `cd web && npm run preview` | serves `dist/` on http://127.0.0.1:4321 with clean URLs, `_redirects` and compression |

`.github/workflows/ci.yml` runs the same commands once a GitHub repo exists.

## How privacy works (read before making anything public)

1. Every collection entry has `visibility` (`private` by default, `unlisted`, `public`). Only **published and
   public** entries are built; `unlisted` pages are built but never listed, fed or put in the sitemap (and are noindex).
2. Strapi refuses to publish a public/unlisted entry whose name, slug, title etc. match a **deny pattern** or an
   **IP term** (the privacy lists, see below).
3. The `visibility-guard` middleware filters every API read for the build token (relations, dynamic zones, drafts,
   relational filters) and the Public role has no permissions at all.
4. The site build re-filters, then **fails** if any non-public entry or any deny/IP term is anywhere in the content,
   and `lint:dist` greps every file and file name in `dist/` again.

**The privacy lists are split, because this repo is public.** `cms/config/privacy.json` (committed) holds the
mechanism and **synthetic canary terms** (`zz-private-canary`, `zz-ip-canary`, `zz-retired-brand` …); the fixtures,
tests and acceptance checks plant those, so a fork or CI without secrets still proves every gate fails closed. The
**real** terms, the private idea entries and the never-seed paths live in the gitignored
`cms/config/privacy.local.json` (the private half of `docs/website/seed-allowlist.json`); private seed entries live in
the gitignored `cms/seed/private.ts`, which `cms/seed/content.ts` loads only when present (the fixtures never contain
them). Every consumer merges public + private. In CI the private file is written from the `PRIVACY_LOCAL_JSON` secret;
on Strapi Cloud it is the `PRIVACY_LOCAL_JSON` variable (DEPLOY.md). `npm run check:public` (part of `npm run check`)
fails if any private term shows up in a tracked file; it skips when the private file is absent.

**To make a private project public** (only after the user says so, naming the project):
1. Remove its pattern from `docs/website/seed-allowlist.json` `denyPatterns`, then from
   `cms/config/privacy.local.json` (`npm run check:privacy-sync` verifies they match), update the `PRIVACY_LOCAL_JSON`
   secret and Strapi variable, restart Strapi.
2. Upload only that project's approved media; set the entry's visibility to `public`; publish.
3. Rebuild. The canary no longer blocks the now-allowed term; everything else stays guarded.

## Swap points for later milestones

- **Logo (R4 Lab flask, picked 2026-10-20):** one value, `web/src/config/brand.ts` → `LOGO_FAMILY` (`'R1'` … `'R5'`, or
  `'text'` for the plain wordmark). `web/scripts/brand.ts` installs that family's lockup, mark, favicons, app icons,
  default OG card, /brand downloads and the concept gallery from `brand/riokulabs/` on every dev/build.
- **3D viewer (M7):** `tools/export-glb/` builds `clean` GLBs from the generators (README there);
  `web/src/components/ModelViewer.astro` loads them on demand. Only `provenance: clean` models with a
  `/models/*.glb` path ever load.

## Deploy, tokens, backups (M9, not done)

Production (decided 2026-10-20): Strapi on Strapi Cloud, the static site on **GitHub Pages** via
`.github/workflows/pages.yml`, rebuilt when content is published (`cms/src/rebuild-trigger.ts` sends a
`repository_dispatch`). Step-by-step in `DEPLOY.md`. Notes:
- Production build: `SITE_DATA=strapi npm run build` with `STRAPI_URL`/`STRAPI_BUILD_TOKEN` as GitHub repo secrets.
  **Never deploy a fixtures build** (it shows unapproved drafts): the workflow skips the deploy without the secrets.
- `npm run build` ends with `scripts/pages-compat.ts` (redirect pages for `_redirects`, `CNAME`, `.nojekyll`), then
  the privacy lint. Pages ignores `_headers`, so security headers are not sent (DEPLOY.md lists what is lost).
- Tokens: `site-build` (read-only, production) in Strapi Settings → API Tokens; `GITHUB_DISPATCH_TOKEN` (fine-grained
  PAT, Contents: write on this repo) in Strapi Cloud. The Cloudflare draft preview (`site-preview` token) is deferred.
- Backups (Strapi Cloud Starter has none): weekly `npx strapi export --encrypt --key <passphrase> -f riokulabs-backup`
  from `cms/`, stored outside git.

## Layout

```
cms/      Strapi 5 (schema in src/api + src/components, guard in src/middlewares, publish guard in src/index.ts,
          seed + scripts in scripts/, seed source + media in seed/)
web/      Astro (pages, components, lib/{strapi,load,privacy,safety}.ts, scripts/, tests/unit, tests/e2e, fixtures/)
brand/    logo families: riokulabs/R1…R5 concepts + text/ fallback (README there)
tools/    export-glb (M7): Blender → clean GLB pipeline
```

## Licence

Copyright (C) 2026 Rioku Labs. The site code is free software under the GNU General Public License v3.0 (see `LICENSE`). Content (posts, images, renders, logos) is not covered by the code licence unless a page says otherwise.
