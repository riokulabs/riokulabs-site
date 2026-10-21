# Rioku Labs website

The source for [rioku.dev](https://rioku.dev), the site of Rioku Labs, a small team making game mods (starting with
Space Engineers 2).

- `cms/` is a [Strapi 5](https://strapi.io) CMS: mods, games, dev-log posts, the roadmap and site copy.
- `web/` is an [Astro](https://astro.build) static site built from that content and deployed to GitHub Pages.

The site is fully static. Content, images and videos are pulled from Strapi at build time, and a publish in Strapi
triggers a rebuild. Visitors never talk to the CMS.

## Run it

You need Node 24 and npm.

```bash
npm run install:all
cp cms/.env.example cms/.env    # fill in the secrets it lists
npm run dev                     # CMS on http://127.0.0.1:1337/admin, site on http://localhost:4321
```

The site builds from `web/fixtures/content.json` by default, so you can work on it without the CMS. To build from your
local Strapi instead, run `npm run tokens` in `cms/`, then `SITE_DATA=strapi npm run build` in `web/`.

## Check your change

```bash
( cd cms && npm run check && npm run test:acceptance )
( cd web && npm test && npx astro check && npm run build && npm run test:e2e )
```

CI runs the same commands on every pull request.

## Layout

| Path | What's there |
|---|---|
| `cms/` | Strapi: content types (`src/api`), the visibility guard, seed data and scripts |
| `web/` | Astro: pages, components, the 3D block explorer, unit and browser tests |
| `brand/` | Logo sources |
| `tools/export-glb/` | Exports mod blocks from Blender to the web models the explorer uses (README inside) |

## Privacy

Every entry is private until it's made public, and the build fails if anything private or blocklisted reaches the
site. The real blocklists aren't in this repo. Tests and CI use stand-in canary terms (`zz-private-canary` and similar),
so the checks still work on a fork.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: Conventional Commits, sign off with `git commit -s`, and keep text
plain and short.

## Licence

The code is under the GNU General Public License v3.0 (see `LICENSE`). Content such as posts, images, renders and logos
isn't covered by the code licence unless a page says otherwise.
