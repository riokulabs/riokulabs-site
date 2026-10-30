---
name: editing-cms-content
description: Read or change Rioku Labs Strapi content (blog posts, mods, pages) with the compact cms CLI instead of the MCP tools. Use when listing entries, reading fields or a post's section outline, changing a few fields, editing, inserting or moving one body section, or publishing.
---

# Editing CMS content

Prefer `npm run cms` over the `mcp__rioku-cms__*` tools for reads and small edits. Its output is a few short lines
instead of whole entries as JSON, so it costs far fewer tokens. It also re-reads every write and stops if anything
changed that was not asked for. Full reference: `cms/scripts/README-cms-cli.md`.

Run from `cms/`. It uses `STRAPI_ADMIN_TOKEN` from `cms/.env`. If that is missing, expired (HTTP 401) or lacks a
permission (HTTP 403), ask the maintainer. Never print or paste the token.

When a mod's state changes (a release, a patch, testing, a delay), use the `updating-mod-status` skill instead.

## Reading

```bash
npm run cms -- list blog-post --fields title,date --status draft
npm run cms -- get blog-post <documentId> --fields title,excerpt,tags --outline
npm run cms -- section blog-post <documentId> 3        # one section in full; rich text as markdown
```

Read with `--outline` before any section edit; sections are numbered from 1. Use `--json` only when the compact output
is not enough.

## Editing (drafts only)

```bash
npm run cms -- set blog-post <documentId> title="..." spoiler=false
npm run cms -- set blog-post <documentId> --json-value 'tags={"set":[{"documentId":"..."}]}'
npm run cms -- section blog-post <documentId> 3 --alt "what the picture shows" --size wide
npm run cms -- section blog-post <documentId> 2 --text-file /path/to/section.md
npm run cms -- section-insert blog-post <documentId> 4 --kind image --image <fileId> --alt "..."
npm run cms -- section-move blog-post <documentId> 5 2
```

- New pictures: upload with the `upload-media` skill first (it prints the file id), then `section-insert --kind image`
  or `section ... --image <id>`.
- Rich text comes from a small markdown file: paragraphs, `##` headings, lists, `**bold**`, `` `code` ``, links.
- Read the `old → new` lines it prints. If it says `VERIFY FAILED`, stop, tell the maintainer what it listed, and point
  them to the backup file it names. Do not retry blindly.
- The same rules as the site apply: real alt text, no private or unannounced projects, no internal work-item names.

## Where the site wording lives

Page headings, intros and search text are CMS fields, not code. Change them there:
- Site settings: footer pitch, help-build box, title templates (`{studio}`, `{game}`, `{mod}`, `{a}`), the dev log,
  mods, games, roadmap and not-found pages (Listing page fields), the spoiler notice, and Social links (footer
  "Follow" column; https profile links also become the home page's Organization `sameAs`).
- Home page: section headings, the placeholder tile, the hero corner labels. About, Brand and Legal pages: headings and
  intros.

An empty field falls back to the built-in text in `web/src/config/default-copy.json`. Intros and empty-state text take
`[label](/path)` links. Keep site-level wording general: name a game or mod only on that game's or mod's own entries.

## Publishing

`publish` and `unpublish` need `--yes` and change the live site. Publish only when the maintainer asked for it in this
session. The privacy guard can refuse a publish: report the refusal, and do not reword content to get around it.

## When to use the MCP tools instead

The CLI has no create and no delete. Use the MCP tools (or ask the maintainer) for:
- creating entries
- deleting anything
- editing gallery, loop-video, compare, stat-grid, mod-card or timeline-embed sections
- media library housekeeping (`media_move_assets`, folders)
- anything else the CLI refuses
