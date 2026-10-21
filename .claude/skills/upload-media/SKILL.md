---
name: upload-media
description: Upload an image or video to the Rioku Labs Strapi media library and attach it to a post or other entry. Use when a dev-log post, mod page or other CMS entry needs a picture or clip that is not in the media library yet.
---

# Upload media to Strapi

The Strapi MCP tools (`mcp__rioku-cms__*`) can list, edit and move media but cannot upload. Upload with the script, then
attach by id with the MCP tools. Full details: `cms/scripts/README-media-upload.md`.

## Before uploading

- Only upload what the maintainer chose to publish. Renders and previews stay local unless the maintainer picked them
  for the site. Ask if unsure.
- Never upload anything from a private or unannounced project, even into a draft. Uploaded files are public URLs.
- Check the file: no internal names, paths, desktop or chat windows, or private projects in the frame.
- Write real alt text: what the picture shows, in plain words. `--decorative` only for pure decoration.
- Pick a neutral `--name` (for example `data-hall-cold-aisle`), never a work-item name like `plan-3-task-2`.

## Commands

Run from `cms/`. The token is `STRAPI_UPLOAD_TOKEN` in `cms/.env`; if it is missing or expired, ask the maintainer to
create one (README "One-time setup"). Never print or paste the token.

```bash
cd cms
npm run media:upload -- <file> --alt "<what it shows>" [--caption "<text>"] [--name <slug>] --dry-run
npm run media:upload -- <file> --alt "<what it shows>" [--caption "<text>"] [--name <slug>]
```

Always do the `--dry-run` first and read the planned name. Each upload prints one JSON line:
`{"id":42,"documentId":"...","url":"...","name":"..."}`. Keep the `id`.

A refusal (type, size, name, privacy) uploads nothing. Fix the cause; do not work around a privacy refusal by
rewording, and tell the maintainer about it. `--force` (over 20 MB) only with the maintainer's OK.

## Attach to an entry

Media fields take the numeric file `id`. Files land in "API Uploads"; move them with `media_move_assets` if needed.

- Post cover (`media.image`): `mcp__rioku-cms__update_blog-post` with
  `cover: { file: <id>, alt: "<same alt text>", caption: "<optional>" }`.
- Image in the body: add a `sections.image` block, `{ "__component": "sections.image", "image": { "file": <id>, "alt": "..." }, "size": "wide" }`.
  A dynamic zone update replaces the whole `body`: read the post with `get_blog-post` first and send every existing block
  back with the new one in place.
- Gallery: `sections.gallery` with `items`. Loop video: `sections.loop-video` with `video: { mp4: <id>, poster: <image id> }`.

Then check the entry with `get_blog-post` and leave publishing to the maintainer unless asked.
