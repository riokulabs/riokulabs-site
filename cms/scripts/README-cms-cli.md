# Editing content from the command line

`npm run cms` reads and edits Strapi entries with short, line-based output. It covers reading entries, changing
fields, editing body sections, and publishing. The Strapi MCP tools return whole entries as JSON, which is slow to read
and easy to get wrong when sending a whole body back. This CLI fetches the entry itself, changes only what you asked
for, saves the draft, and then checks that nothing else changed.

It talks to the same admin Content Manager routes the admin UI uses (`/content-manager/collection-types/:uid` and
`/content-manager/single-types/:uid`), so the CMS privacy guard and the site rebuild trigger still apply.

## Setup: the admin token

The CLI uses the same `STRAPI_ADMIN_TOKEN` in `cms/.env` as `media:upload` (see `README-media-upload.md`). In the admin,
Settings → Admin Tokens, open that token and add these Content Manager permissions:

- **Read** on every collection and single type (needed to list, get and resolve relations).
- **Update** on the types you edit with the CLI (for example Blog post).
- **Publish** on those types, only if you want `publish`/`unpublish` from the CLI.

Leave **Create** and **Delete** off: the CLI has no create or delete command. Keep the 30-day expiry. An admin token
acts as the admin who created it, so that admin needs these permissions too. `STRAPI_URL` defaults to
`https://cms.rioku.dev`; plain http is refused except on localhost. The token is never printed.

## Commands

`<type>` is a short name (`blog-post`), a plural (`blog-posts`) or a uid (`api::blog-post.blog-post`); `npm run cms --
types` lists them. `<id>` is the entry's documentId, or `single` for a single type. Body sections are numbered from 1.
`--json` prints the full JSON on `list`, `get` and `section` when you need everything.

```bash
cd cms
npm run cms -- types
npm run cms -- list blog-post --fields title,date --status draft --limit 5
npm run cms -- list blog-post --filter visibility=public --sort date:desc
npm run cms -- get blog-post <documentId>                    # every field, one short line each
npm run cms -- get blog-post <documentId> --fields title,tags --outline
npm run cms -- get about-page single
```

`list` prints `documentId  status  visibility  field=value ...` per entry. `status` is draft, published or modified
(published, with newer draft changes). `get --outline` prints the body as numbered lines:

```
body:
  1 rich-text 3 paragraphs, 2 headings "Why we built it The rack holds…"
  2 image file=17 alt="Server racks along the cold aisle" size=wide
  3 model-embed model=k2l9…
```

Relation fields show as counts (`tags: (2)`), or as documentIds when you ask for them with `--fields`.

### Changing fields

```bash
npm run cms -- set blog-post <documentId> title="Server racks, part 2" spoiler=false
npm run cms -- set blog-post <documentId> --json-value 'tags={"set":[{"documentId":"abc"},{"documentId":"def"}]}'
npm run cms -- set blog-post <documentId> --json-value 'cover={"file":17,"alt":"Server racks along the cold aisle"}'
```

Plain values are typed by the field: text, enumerations (checked against the allowed values), `true`/`false` and
numbers. Objects, components and relations go through `--json-value` (relations take `set`, `connect` or `disconnect`
with documentIds). The body cannot be set this way; use the section commands. It prints `field: old → new` for each
changed field and skips values that are already set.

### Editing body sections

```bash
npm run cms -- section blog-post <documentId> 2                       # show section 2 (rich text as markdown)
npm run cms -- section blog-post <documentId> 2 --alt "Server racks along the cold aisle" --size wide
npm run cms -- section blog-post <documentId> 2 --image 21           # swap the picture (file id from media:upload)
npm run cms -- section blog-post <documentId> 1 --text-file intro.md # replace rich text
npm run cms -- section-insert blog-post <documentId> 3 --kind image --image 21 --alt "..." --caption "..."
npm run cms -- section-insert blog-post <documentId> end --kind rich-text --text-file part2.md
npm run cms -- section-move blog-post <documentId> 4 2
```

| Section | Options |
| --- | --- |
| image | `--image <fileId>`, `--alt`, `--caption`, `--size inline\|wide\|full` |
| rich-text | `--text-file` |
| callout | `--text-file`, `--title`, `--tone note\|tip\|caution` |
| code | `--text-file` (raw code), `--language`, `--caption` |
| quote | `--text-file` (raw text), `--set attribution=...` |
| model-embed | `--model <documentId>`, `--caption` |
| any | `--set field=value` for a plain field of that section |

`section-insert --kind` takes rich-text, image, code, quote, callout or model-embed. Other kinds (gallery, loop-video,
compare, stat-grid, mod-card, timeline-embed) can be read and moved but are edited in the admin or with the MCP tools.

The CLI fetches the draft, changes the one section, and sends the whole body back. Every other section keeps its id,
its media ids and its relations.

`--text-file` takes a small markdown subset: paragraphs (separated by a blank line), `#` to `######` headings, `- ` and
`1. ` lists, `**bold**`, `` `code` `` and `[links](https://...)`. Fenced code, quotes, tables and images are refused:
use a code, quote or image section instead. Links must be http(s), mailto, `/` or `#`. Relative paths are read from
the directory you ran the command in; `-` reads stdin.

### Publishing

```bash
npm run cms -- publish blog-post <documentId> --yes
npm run cms -- unpublish blog-post <documentId> --yes
```

Both refuse to run without `--yes`. Publishing still goes through the CMS privacy guard. An entry whose visibility is
not `public` stays off the site even when published, and the CLI says so. There is no delete command.

## Safety

- **Drafts only.** `set` and the section commands change the draft; nothing goes live until `publish --yes`.
- **Verify after every write.** The CLI reads the entry before and after the save. It compares:
  - every field it was not asked to change
  - every relation, by documentId
  - every media id
  - the section count, and each untouched section exactly

  The edited section must come back with the values sent. If anything else differs, the CLI stops with
  `VERIFY FAILED` (exit code 3), names what changed, and leaves a copy of the draft from before the write in a temp
  file so it can be put right in the admin.
- Exit codes: 0 done, 1 error, 2 usage (bad arguments, refused option), 3 verify failed.
