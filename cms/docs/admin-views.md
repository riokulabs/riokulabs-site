# Admin organisation

How the Strapi admin is organised, and where each part is kept.

## Folders (Content Manager and Content-Type Builder sidebars)

- Kept in `src/content-structure/groups.json` (Strapi 5.55+). It is a code file: it deploys with the app and is the
  same in every environment.
- Folders: Mods, Blog, Games and Site for collection types; Pages and Site for single types.
- Changing folders in the Content-Type Builder (local `npm run develop` only) rewrites this file; commit it.
- `npm run check:schema` fails if a content type is in no folder or in two.

## List and edit views ("Configure the view")

- Strapi keeps these in the database, not in the schema files. `src/admin-views-data.ts` holds the settings we
  want; `src/admin-views.ts` writes them at startup.
- What it sets: entry title, default sort, list columns, edit-view rows and widths, and field labels, descriptions
  and placeholders, for every content type and component. Component layouts stay Strapi's default.
- It only writes a type when its entry in `admin-views-data.ts` changed since the last start (a fingerprint per type
  is stored under the core-store key `core_admin_views_fingerprints`). A change made with "Configure the view" in the
  admin stays until the code entry for that type changes, then the code wins for the keys it sets.
- A field missing from the code layout is added at the end of the edit view; it is never hidden.
- `ADMIN_VIEWS=off` skips it. `ADMIN_VIEWS=force` re-applies every type on the next start.
- To change a view: edit `admin-views-data.ts`, run `npm test` (it checks every field is placed, labelled and a valid
  width), deploy.

## Renaming a field

Strapi 5.57+ keeps the data when a field is renamed in the Content-Type Builder or with `npx strapi rename:field`.
It writes a migration into `database/migrations/`; commit it with the schema change, and the migration runs on
Strapi Cloud at the next start. Never rename a field and change its type in the same save. Also update the site
(`web/src/lib/strapi.ts`, `web/src/lib/load.ts`), the fixtures and the seed in the same pull request.
