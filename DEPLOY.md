# DEPLOY: putting rioku.dev live (M9 checklist)

> **Deploy workflow exception (2026-10-20).** AGENTS.md says "Never add deploy steps to CI". The maintainer decided on
> 2026-10-20 that production is the static site on **GitHub Pages**, built and deployed by GitHub Actions
> (`.github/workflows/pages.yml`) and rebuilt automatically when content changes in Strapi. That workflow is the
> approved exception; `ci.yml` stays deploy-free. AGENTS.md is generated from the org templates in
> `riokulabs/.github` (`templates/`), so the rule must be updated there, not in this repo.

This is the user's checklist. Every step that creates an account, costs money or handles a secret is **yours**: the
build session never logs in, buys or pastes tokens. Where a command is given, run it yourself in this repo.
Prices and limits were checked on 2026-10-19/20; re-check them on the vendor pages before paying.

Studio identity: **Rioku Labs**, primary domain **rioku.dev**, GitHub organisation **`riokulabs`**. You already own
rioku.dev, rioku.ai, rioku.cloud and rioku.io: nothing here buys a domain. rioku.dev serves the site; the other three
forward to it (step 6). The name and domain are one value each in `web/src/config/identity.json`.

**Architecture:** Strapi 5 on **Strapi Cloud** (content, admin) → GitHub Actions builds the Astro **static** site from
the Strapi API with a read-only token → **GitHub Pages** serves it on rioku.dev. Publishing, unpublishing or deleting
content in Strapi sends a `repository_dispatch` to GitHub, which rebuilds and redeploys (≈ 1 min debounce + build).

Order: **0** before deploying → **1** GitHub repository (+ the plan decision) → **2** Strapi Cloud → **3** move the
content → **4** GitHub Pages → **5** rebuild on publish → **6** domain and DNS → **7** go-live checks → **8** backups and
token care. The Cloudflare draft preview is deferred (appendix).

---

## 0. Before deploying (build session, no accounts needed)

- [x] Static build works on GitHub Pages: `npm run build` in `web/` runs `scripts/pages-compat.ts` after Astro, which
      turns every `_redirects` rule into a redirect page, writes `CNAME` + `.nojekyll`, and checks `404.html` exists.
- [x] CMS rebuild trigger: `cms/src/rebuild-trigger.ts` (tests in `cms/tests/rebuild-trigger.test.ts`).
- [ ] Your approvals, given in chat: which items go public at launch (`npm run seed -- --approve=games,data-center,history,author,site-copy`
      or flip them in the admin), the author byline, the not-affiliated wording, mod licences, and the logo pick
      (`web/src/config/brand.ts`).

## 1. GitHub repository (yours)

### Decision: private repo on a paid plan, or a public repo

**GitHub Pages from a private repository needs a paid plan.** On GitHub Free, Pages works only for **public**
repositories; for an organisation that means **GitHub Team** (GitHub Pro is the personal-account equivalent). Source:
<https://docs.github.com/en/get-started/learning-about-github/githubs-plans>. Either way the published site itself is
public (private Pages sites need Enterprise Cloud).

| Option | Cost | Consequence |
|---|---|---|
| A. Keep `riokulabs-site` **private**, upgrade `riokulabs` to **GitHub Team** | per-user monthly (check the pricing page) | source stays private as AGENTS.md assumes |
| B. Make `riokulabs-site` **public** on the Free plan | $0 | the repo is GPL-3.0 already. Private names and ideas are kept out of the tree (below); `web/fixtures/` still shows unapproved drafts of the public mod and posts. The git history holds everything ever committed, so wipe or squash it before the first push. |

Pick one before step 4. The rest of this file works for both.

**Decision (2026-10-20): B, public.** Before the first push:

1. **Wipe the history**: push a single fresh root commit of the current tree (older commits contain the private lists
   and idea entries that the tree no longer has).
2. Run `cd cms && npm run check:public` locally: it greps every tracked (and untracked, not ignored) file for every
   term in the private lists and must say OK.
3. Add the `PRIVACY_LOCAL_JSON` Actions secret (step 4) and the same value as a Strapi Cloud variable (step 2).

### The private lists (`PRIVACY_LOCAL_JSON`)

The real privacy deny patterns, IP terms, retired names, private idea entries and never-seed paths are **not in the
repo**. They live in `cms/config/privacy.local.json` (gitignored; the private half of the workspace's
`docs/website/seed-allowlist.json`), and private seed entries in `cms/seed/private.ts` (gitignored). The committed
`cms/config/privacy.json` holds the mechanism plus synthetic canary terms (`zz-private-canary` …), which the fixtures
and tests plant so a fork or a CI run without the secret still proves every gate fails closed.

Every consumer merges the two: the Strapi publish guard, the seed lint, `prepare-media`, `privacy-audit`, the web
build assertion and `lint-dist`. Where the file can't exist, the same JSON comes from the environment variable
`PRIVACY_LOCAL_JSON`:

- **GitHub Actions**: repository secret `PRIVACY_LOCAL_JSON` = the full contents of `cms/config/privacy.local.json`
  (`gh secret set PRIVACY_LOCAL_JSON -R riokulabs/riokulabs-site < cms/config/privacy.local.json`). `ci.yml` and
  `pages.yml` write it to that path before the build and tests; when it is empty (forks, pull requests from forks)
  that step does nothing and the checks run on the canaries only.
- **Strapi Cloud**: variable `PRIVACY_LOCAL_JSON` = only the three lists the publish guard uses (about 0.5 KB, one line):
  `jq -c '{denyPatterns, ipDenyTerms, retiredBrandTerms}' cms/config/privacy.local.json`. The rest of the file is for
  seeding and tests and isn't needed there.
- **Fail closed:** Strapi refuses to boot with `NODE_ENV=production` without it, and a `SITE_DATA=strapi` web build
  (the Pages deploy) stops in `fetch-content` without it. Fixture builds don't need it.
- **Changing a list:** edit `docs/website/seed-allowlist.json` first, then the local file (`npm run check:privacy-sync`
  compares them), then update the secret and the Strapi variable.

### Create it

The `riokulabs` organisation exists; treat it as empty (old repos are being archived). Suggested names:

| Repository | Visibility | What |
|---|---|---|
| `riokulabs/riokulabs-site` | your decision above | this repo (site + CMS + GLB exporter) |
| `riokulabs/se2-data-center` | public when you release it | the Data Center mod; set the mod's `githubUrl` in Strapi then |
| `riokulabs/se2-<mod>` | public at release | later SE2 mods; other games get their own prefix |

1. Create **`riokulabs/riokulabs-site`**, empty (no README/licence: the repo has them).
2. In this folder:
   ```bash
   git remote add origin git@github.com:riokulabs/riokulabs-site.git
   git push -u origin main
   ```
3. Check: the Actions tab runs `ci.yml` (guard, data, cms, web) and it goes green. `pages.yml` also runs on that
   first push: without Strapi secrets it builds from fixtures and **skips the deploy job** (expected).
4. Never commit `.env` files (they're gitignored). `git ls-files | grep -E '\.env$'` must print nothing.
5. Org profile (optional): the avatar is `brand/riokulabs/<pick>/<pick>-github-avatar-500.png`.

## 2. Strapi Cloud project (yours, ≈ $35/month on Starter)

1. strapi.io → Cloud → **Create project** → import the GitHub repo.
   - **Plan:** Starter (it sleeps when idle and has **no backups**: step 8 covers that).
   - **Base directory:** `cms`
   - **Node version:** the newest LTS Strapi Cloud offers (the app supports 20–26; local dev uses 24).
   - **Region:** the one nearest you.
2. **Environment variables** (Strapi Cloud → project → Settings → Variables). Generate each secret locally with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste it in the dashboard (not in git):

   | Variable | Value |
   |---|---|
   | `APP_KEYS` | four secrets, comma-separated |
   | `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY` | one secret each |
   | `STRAPI_TELEMETRY_DISABLED` | `true` |
   | `PRIVACY_LOCAL_JSON` | the three guard lists: `jq -c '{denyPatterns, ipDenyTerms, retiredBrandTerms}' cms/config/privacy.local.json` (step 1). **Required**: without it Strapi refuses to boot in production |
   | `GITHUB_REPO`, `GITHUB_DISPATCH_TOKEN` | step 5 (add them later; the CMS runs fine without) |

   Strapi Cloud supplies the database variables itself; don't set `DATABASE_*`. Leave `PREVIEW_URL` and
   `PREVIEW_SECRET` **unset** while the draft preview is deferred (unset = the admin's "Open preview" button is off).
3. Deploy. Open `https://<project>.strapiapp.com/admin` and create **your** Super Admin (the only admin in v1).
4. Check the lock-down: `curl -i https://<project>.strapiapp.com/api/mods` must answer **401** (or 403). The Public and
   Authenticated roles have no permissions (`cms/src/index.ts` enforces this on every boot).

## 3. Move the content (yours)

**Transfer the local database (keeps everything, media included)**
1. Approve what goes public first (step 0), locally.
2. In the Cloud admin: Settings → Transfer Tokens → create one, type **Push**, duration **7 days**. Copy it.
3. Locally, with the local Strapi stopped:
   ```bash
   cd cms
   npx strapi transfer --to https://<project>.strapiapp.com/admin --to-token <paste>
   ```
4. Revoke the transfer token afterwards.

Seeding the Cloud directly isn't possible from here (the seed boots Strapi against the database `cms/.env` points at).

Then in the Cloud admin, Settings → API Tokens:
- **`site-build`**: type *Custom*, duration *Unlimited*, permissions: **find** and **findOne** on every content type
  (and **find** on the single types). Nothing else. Copy the key once. This is the only token GitHub gets.
- (`site-preview` is only needed for the deferred draft preview; don't create it yet.)

## 4. GitHub Pages production site (yours, $0 beyond the plan decision in step 1)

1. Repo → Settings → **Pages** → Build and deployment → **Source: GitHub Actions**.
2. Repo → Settings → Environments → `github-pages` (created on the first deploy, or create it now) → Deployment
   branches: **main only** (the default from the Pages setup).
3. Repo → Settings → Secrets and variables → **Actions**:

   | Name | Kind | Value |
   |---|---|---|
   | `STRAPI_URL` | secret (or variable) | `https://<project>.strapiapp.com` |
   | `STRAPI_BUILD_TOKEN` | **secret** | the `site-build` key |
   | `PRIVACY_LOCAL_JSON` | **secret** | the contents of `cms/config/privacy.local.json` (the private lists; see step 1). Required for a Strapi build |
   | `SITE_URL` | variable | `https://rioku.dev` (until DNS is live, `https://riokulabs.github.io/riokulabs-site` works for a look; unset = `https://rioku.dev`) |
   | `SITE_NOINDEX` | variable | `1` **until launch** (robots.txt `Disallow: /`; see "What Pages can't do") |
   | `CF_WEB_ANALYTICS_TOKEN` | variable, optional | only if you keep Cloudflare Web Analytics (works on any host) |
   | `ALLOW_FIXTURE_DEPLOY` | variable | **don't set it.** It exists only to let a fixtures build deploy; fixtures show unapproved drafts. |

   With `STRAPI_URL` + `STRAPI_BUILD_TOKEN` present the workflow builds with `SITE_DATA=strapi`; without them it builds
   from fixtures and does not deploy.
4. Actions → **pages** → *Run workflow* (branch `main`). The log must show `fetch-content [strapi]`,
   `pages-compat: OK`, `lint-dist: OK` and `validate-feeds: OK`, then the `deploy` job prints the Pages URL. If the
   build assertion or the dist lint fails, nothing is uploaded or deployed; the error names the offending entry: fix
   the entry, don't change the check.

**How it rebuilds** (`.github/workflows/pages.yml`): push to `main` touching `web/**` or the workflow;
`repository_dispatch` type `cms-content-changed` (step 5); manual *Run workflow*; and a **daily** run at 04:17 UTC as a
fallback. Runs share one concurrency group: a running deploy is never cancelled; at most one newer run waits, and
the newest wins.

**Fire a rebuild by hand:** Actions → pages → *Run workflow*, or with the GitHub CLI `gh workflow run pages.yml -R
riokulabs/riokulabs-site`, or the same call Strapi makes:
```bash
curl -X POST -H "Authorization: Bearer <token with Contents: write>" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/riokulabs/riokulabs-site/dispatches -d '{"event_type":"cms-content-changed"}'
```

### What Pages can't do (compared with the Cloudflare plan)

GitHub Pages serves files only. It **ignores `_headers` and `_redirects`** (both are still generated, for any future
Cloudflare host) and sets no custom response headers. Lost:
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Frame-Options: DENY` (the site can be framed by others). There was no CSP header yet; a CSP or referrer policy
  could still be added as `<meta>` tags in the layout, but `frame-ancestors`/`X-Frame-Options` cannot be set by meta.
- `X-Robots-Tag: noindex` before launch: only `robots.txt` (`Disallow: /`) remains, which stops crawling but a linked
  URL can still be listed.
- Long immutable caching for `/_astro/*` (Pages uses a short cache for everything).
- Real 301s: `scripts/pages-compat.ts` writes a redirect page per `_redirects` rule (meta refresh + canonical +
  `location.replace`, noindex), e.g. `/history` → `/roadmap`, `/mods/<slug>` → `/games/<game>/mods/<slug>`, and every
  CMS Redirect entry. Search engines treat these as soft redirects. A rule replaces a page at the same path.
- Clean-URL edge case: where `X.html` and a directory `X/` both exist, `pages-compat` also writes `X/index.html` (same
  page, canonical `/X`) in case Pages answers `/X` with `/X/`. Verify after go-live (step 7).
- HTTPS is fine: rioku.dev is HSTS-preloaded (`.dev`) and Pages issues the certificate.

## 5. Rebuild on publish (yours)

Strapi webhooks can't call GitHub's dispatch API (GitHub needs `{"event_type": ...}` in the body), so the CMS does it
itself: `cms/src/rebuild-trigger.ts`. On **publish, unpublish or delete** of any `api::` content type (and when a media
file is replaced or deleted) it waits for a quiet minute (bursts collapse into one call; at most 5 minutes after the
first change), then POSTs `repository_dispatch` `cms-content-changed` with the changed model uids. Draft saves do
nothing. Failures are logged and never block publishing; the daily build catches up.

1. GitHub → your account → Settings → Developer settings → **Fine-grained personal access tokens** → Generate:
   - **Resource owner:** `riokulabs` (the org may need to allow fine-grained tokens: org Settings → Personal access
     tokens).
   - **Repository access:** *Only select repositories* → `riokulabs-site`.
   - **Permissions:** Repository → **Contents: Read and write** (GitHub's requirement for
     `POST /repos/{owner}/{repo}/dispatches`; Metadata: read is added automatically). Nothing else.
     Source: <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>.
   - **Expiration:** up to a year; put the date in your calendar.
2. Strapi Cloud → Settings → Variables: `GITHUB_REPO` = `riokulabs/riokulabs-site`, `GITHUB_DISPATCH_TOKEN` = the PAT.
   Optional `REBUILD_DEBOUNCE_MS` (default `60000`). Redeploy the CMS.
3. Test: publish a test post (visibility *public*) → about a minute later the CMS log shows
   `[rebuild] site rebuild requested on riokulabs/riokulabs-site (api::blog-post.blog-post)` and Actions shows a
   `pages` run triggered by `repository_dispatch` → the post is live a few minutes later → unpublish it → it
   disappears after the next run. Delete the test post. A `[rebuild] GitHub answered 401/403/404` line means the token
   or `GITHUB_REPO` is wrong.

No Strapi webhook is needed (don't create the old "Rebuild site" webhook).

## 6. Domains and DNS (yours; the domains are already yours)

GitHub's reference: <https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site>
(IPs checked 2026-10-20; re-check there).

**rioku.dev (the site):**
1. **Verify the domain first** (prevents takeovers): org `riokulabs` → Settings → Pages → *Add a domain* → `rioku.dev`
   → add the `TXT` record GitHub shows (`_github-pages-challenge-riokulabs.rioku.dev`) → Verify.
2. Repo → Settings → Pages → **Custom domain** `rioku.dev` → Save. (With an Actions deploy this setting is what
   counts; the `CNAME` file in the build is informational.)
3. At your DNS host for rioku.dev:

   | Type | Name | Value |
   |---|---|---|
   | `A` | `@` | `185.199.108.153` |
   | `A` | `@` | `185.199.109.153` |
   | `A` | `@` | `185.199.110.153` |
   | `A` | `@` | `185.199.111.153` |
   | `AAAA` | `@` | `2606:50c0:8000::153` |
   | `AAAA` | `@` | `2606:50c0:8001::153` |
   | `AAAA` | `@` | `2606:50c0:8002::153` |
   | `AAAA` | `@` | `2606:50c0:8003::153` |
   | `CNAME` | `www` | `riokulabs.github.io` (no repo name) |

   No wildcard records. If the DNS host is Cloudflare, set these records to **DNS only** (grey cloud) so GitHub can
   issue the certificate. GitHub redirects `www.rioku.dev` to `rioku.dev` itself once both resolve.
4. Wait for the DNS check to pass, then tick **Enforce HTTPS** (it can take up to 24 h to become available).

**rioku.ai, rioku.cloud, rioku.io:** one Pages site serves one custom domain, so these can't be extra Pages domains.
Simplest: **URL forwarding at the registrar** (most registrars offer it free): forward each apex and `www` to
`https://rioku.dev` as a **301 / permanent** redirect, with path forwarding if offered. Check each with
`curl -sI https://rioku.io/` (some registrar forwarders are HTTP-only for `.io`/`.ai`; if HTTPS fails there, a free
Cloudflare zone with a Redirect Rule is the fallback).

**Launch:** set `SITE_URL=https://rioku.dev` (or delete it: that is the default), **delete `SITE_NOINDEX`**, run the
workflow. Optionally submit `https://rioku.dev/sitemap-index.xml` in Google Search Console / Bing Webmaster Tools.

## 7. Go-live checks (both of us, before deleting `SITE_NOINDEX`)

- [ ] Workflow log: `fetch-content [strapi]` counts match what you approved (a mod only appears if its game is public
      too); `pages-compat: OK`; `lint-dist: OK` (also rejects any leftover of a retired studio name);
      `validate-feeds: OK`.
- [ ] `curl -sI https://rioku.dev/about` → 200; `curl -sI https://rioku.dev/does-not-exist` → **404** with the themed
      page; `curl -s https://rioku.dev/history` contains `url=/roadmap`; a mod page and its `/history` page both load
      at their clean URLs (`/games/space-engineers-2/mods/data-center`, `…/data-center/history`) without a trailing slash
      redirect. If `/X` answers 301 → `/X/`, tell the build session (the directory shim covers it, but the canonical
      URL behaviour should be checked).
- [ ] `curl -sI http://rioku.dev` → redirect to https; `https://www.rioku.dev` → `https://rioku.dev`.
- [ ] `curl -s https://rioku.dev/sitemap-index.xml` and `/rss.xml`: only approved pages and posts.
- [ ] `curl -i https://<project>.strapiapp.com/api/mods` → 401/403 (no public API).
- [ ] With the `site-build` token, `GET /api/mods?status=draft` returns only published entries, and
      `GET /api/mods?filters[posts][title][$eq]=x` → 400 (the visibility guard).
- [ ] The Media Library holds nothing from the never-seed list (`cd cms && npm run privacy-audit` against a pulled
      copy, step 8).
- [ ] Spot-check pages, OG cards (opengraph.xyz, Discord, Steam chat), favicons, RSS in the W3C feed validator,
      Lighthouse on the live URL (≥ 95 / 100 / 100 / 100; best-practices may dip without the security headers).
- [ ] Planted-leak drill (once): make a test mod named after a real private project (any term from the private deny
      list), visibility *private*, publish it, let the rebuild run → absent. Try to set it *public* → Strapi refuses.
      Delete it.
- [ ] Repo secrets: only `STRAPI_URL`/`STRAPI_BUILD_TOKEN`/`PRIVACY_LOCAL_JSON`; `ALLOW_FIXTURE_DEPLOY` is not set.

## 8. Backups and token care (yours, ongoing)

**Weekly backup** (Starter has none). From `cms/` on your machine, with the local Strapi stopped:
```bash
# 1. pull the Cloud content into the local SQLite (Transfer token, type Pull, short duration)
npx strapi transfer --from https://<project>.strapiapp.com/admin --from-token <pull token> --force
# 2. write an encrypted archive OUTSIDE the repo
npx strapi export --encrypt --key "<your backup passphrase>" -f ~/Backups/riokulabs/riokulabs-$(date +%F)
```
Keep the passphrase in your password manager. Restore with `npx strapi import -f <file>.tar.gz.enc --key ...` then
transfer back. Delete pull tokens after use.

**Rotating tokens** (yearly, or at once if one leaks):
- `site-build`: Strapi → API Tokens → *Regenerate* → GitHub repo secret `STRAPI_BUILD_TOKEN` → run the workflow.
- `GITHUB_DISPATCH_TOKEN` (fine-grained PAT, expires): regenerate in GitHub → Strapi Cloud variable → redeploy the
  CMS. When it expires, rebuilds stop being triggered by publishing (the CMS log shows 401) but the daily build continues.

**Making a private project public later:** README → "How privacy works": edit the deny patterns (source file first),
upload only that project's approved media, set visibility, publish.

---

## Appendix: draft preview on Cloudflare (deferred)

The draft-preview Worker (ARCHITECTURE §6) is built and tested (`npm run build:preview` in `web/`,
`cd cms && npm run test:drafts`) but **not part of the GitHub Pages launch**: Pages can't run server code. The code
stays in the repo (`web/wrangler.preview.jsonc`, `src/middleware.ts`, `@astrojs/cloudflare`). If you want it later:

1. Cloudflare (free) → Workers & Pages → Create → Import repository → name `riokulabs-preview`, root `web`,
   build `npm ci && npm run build:preview`, deploy `npx wrangler deploy --config dist-preview/server/wrangler.json`,
   build variable `NODE_VERSION=24`.
2. Worker runtime variables: `STRAPI_URL`, `STRAPI_ADMIN_ORIGIN` (= the Strapi Cloud origin), secret
   `STRAPI_PREVIEW_TOKEN` (a separate `site-preview` API token, same read permissions as `site-build`), secret
   `PREVIEW_SECRET` (≥ 32 random characters).
3. Strapi Cloud: `PREVIEW_URL` = the Worker URL (or `https://preview.rioku.dev` with a DNS record to the Worker),
   `PREVIEW_SECRET` = the same value.
4. Zero Trust → Access → self-hosted application on the preview host, allow only your email (one-time PIN). If the
   admin's preview iframe can't pass Access, bypass `/preview` only (it still needs the secret and sets a signed cookie).
5. Test: Strapi → a draft → **Open preview** → the page renders with the "PREVIEW · drafts" banner; the same URL in a
   private window answers 401.

The earlier Cloudflare **production** plan (Workers static assets + deploy hook + Strapi webhook) is replaced by
steps 4–5 above; `web/wrangler.jsonc` and the generated `_headers`/`_redirects` remain so the site could move back.
