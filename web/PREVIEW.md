# Draft preview: setup

**Open preview** on a draft in the Strapi admin shows that entry rendered by the real site, at
`https://preview.rioku.dev`. Drafts never go into the public build: a small Cloudflare Worker renders them on request,
only for someone who came from the CMS.

How it works, in short:

1. The CMS makes a link `https://preview.rioku.dev/preview?path=/blog/my-post&exp=…&sig=…`. It works for 10 minutes and
   is signed with `PREVIEW_SECRET`. The secret itself is never in the link.
2. The Worker checks the signature and the time, sets a 1-hour session cookie and opens the page.
3. Every other request without that cookie gets a 401. Every response says `noindex` and `no-store`, and only the
   Strapi admin may show it in a frame.

Code: `src/middleware.ts`, `src/lib/preview.ts`, `wrangler.preview.jsonc`, and `cms/config/admin.ts` with
`cms/src/utils/preview-link.ts`.

## You need

- The Cloudflare account that holds the `rioku.dev` DNS zone. The free Workers plan is enough to start.
- Admin access to the Strapi Cloud project.
- A random secret: `openssl rand -hex 32`. Keep it in your password manager. It never goes in the repo.

## 1. Create the Worker

Pick one.

**From the repo (Workers Builds).** Cloudflare dashboard → Workers & Pages → Create → Import a repository →
`riokulabs/riokulabs-site`.

| Setting | Value |
|---|---|
| Worker name | `riokulabs-preview` (must match `wrangler.preview.jsonc`) |
| Root directory | `web` |
| Build command | `npm ci && npm run build:preview` |
| Deploy command | `npx wrangler deploy --config dist-preview/server/wrangler.json` |
| Build variable | `NODE_VERSION=24` |
| Non-production branch builds | off |

The build needs no secrets. It contains no content: the Worker reads drafts from Strapi on each request.

**From your machine.**

```bash
cd web
npm ci
npm run build:preview
npx wrangler login
npx wrangler deploy --config dist-preview/server/wrangler.json
```

Use the built config (`dist-preview/server/wrangler.json`), not `wrangler.preview.jsonc` directly: the source config has
no Worker script in it, so `wrangler deploy -c wrangler.preview.jsonc` fails.

On the first deploy, Cloudflare:

- adds the custom domain `preview.rioku.dev` (DNS record and certificate) from the `routes` entry;
- creates a small KV namespace for the `SESSION` binding that Astro adds. That's expected.

The Worker has no `*.workers.dev` address and no per-version preview URLs, so the custom domain is the only way in.

## 2. Worker settings

Worker → Settings → Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| `STRAPI_URL` | Text | The CMS address, for example `https://cms.rioku.dev` |
| `STRAPI_ADMIN_ORIGIN` | Text | The admin's origin (scheme and host only), for example `https://cms.rioku.dev`. Only this page may frame the preview. If it is missing or not a bare origin, framing is blocked completely |
| `STRAPI_PREVIEW_TOKEN` | Secret | The token from step 3 |
| `PREVIEW_SECRET` | Secret | Your random secret (at least 32 characters) |

The two secrets can also be set from the command line:

```bash
npx wrangler secret put STRAPI_PREVIEW_TOKEN --name riokulabs-preview
npx wrangler secret put PREVIEW_SECRET --name riokulabs-preview
```

The config has `keep_vars: true`, so a later deploy doesn't remove the text variables you set in the dashboard.

## 3. Strapi Cloud: the read token

Strapi admin → Settings → API Tokens → Create new API token:

- Name: exactly **`site-preview`**. The CMS visibility guard (`cms/src/middlewares/visibility-guard.ts`) lets only a
  token with this name read drafts and private entries. Any other name gets published, public content only.
- Type: Custom, with `find` and `findOne` on the site's content types. Nothing else.
- Duration: unlimited, or set a reminder to rotate it.

Copy it once and put it into the Worker as `STRAPI_PREVIEW_TOKEN`.

## 4. Strapi Cloud: turn the button on

Strapi Cloud → the project → Settings → Variables:

- `PREVIEW_URL=https://preview.rioku.dev`
- `PREVIEW_SECRET=` the same value as on the Worker.

Redeploy the CMS. Without `PREVIEW_URL` the button is hidden. With a secret shorter than 32 characters it gives no link.

## 5. Optional: Cloudflare Access

Access adds a login (for example a one-time PIN to your email) in front of the whole preview host.

1. Zero Trust → Access → Applications → Add → Self-hosted. Domain `preview.rioku.dev`. Policy: Allow, your email.
   Session: 24 hours.
2. Log in once in a normal browser tab before you use the admin. The Access login page can't load inside the admin's
   frame.
3. If the preview still won't load in the admin, add a second application for `preview.rioku.dev/preview` with a
   **Bypass** policy. Only the signed-link path skips Access, and that path still needs a valid, unexpired signature.

## 6. Check it

1. In Strapi, save a draft blog post (the button is greyed out while there are unsaved changes) → **Open preview**.
   The post shows with a blue PREVIEW banner, or a red one if it isn't public.
2. In a private window, open `https://preview.rioku.dev/blog/<that-slug>` directly. You get a 401 (or the Access
   login).
3. Open a preview link you copied more than 10 minutes ago. You get "Preview link expired".
4. From a terminal:

   ```bash
   curl -sI https://preview.rioku.dev/ | grep -iE 'x-robots-tag|cache-control|content-security-policy'
   ```

   You should see `x-robots-tag: noindex, nofollow`, `cache-control: no-store` and
   `content-security-policy: frame-ancestors https://cms.rioku.dev`.
5. Watch the CPU time for a minute: `npx wrangler tail riokulabs-preview`, then open the home page, a long post and a
   mod page. If you see error 1102 (CPU limit) on the free plan, move the Worker to Workers Paid.

## If something leaks

- Secret: make a new one and set it in both places (Worker and Strapi Cloud), then redeploy the CMS. Old links and
  cookies stop working at once.
- Token: delete `site-preview` in Strapi, create a new one with the same name, and update the Worker secret.

## Local test

`cd cms && npm run test:drafts` runs the whole flow against a throwaway copy of the local database and `wrangler dev`.
For manual testing, put `STRAPI_URL`, `STRAPI_PREVIEW_TOKEN`, `PREVIEW_SECRET` and `STRAPI_ADMIN_ORIGIN` in
`web/.dev.vars` (gitignored), then `npm run build:preview && npm run preview:drafts`.
