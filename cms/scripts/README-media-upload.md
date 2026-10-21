# Uploading media from the command line

`npm run media:upload` sends images and videos to the Strapi media library. Strapi's MCP server can list, edit and move
media but cannot upload, so this fills that gap. It prints the new file's id, which you then use to attach the file to
an entry.

## What it checks before sending

- Images and videos only (png, jpg, webp, gif, avif, mp4, webm, mov). The content must match the extension.
- 20 MB per file. `--force` allows more; the server stops at 25 MB.
- Alt text is required. Use `--decorative` only for images that add nothing to the text.
- The public file name comes from `--name` or the alt text: lowercase words and hyphens. Names that look like work
  items (`plan-3`, `task-2`, `t12c`, `wip`, `audit`, `ruling`) are refused unless you pick one with `--name`.
- The privacy deny lists (`config/privacy.json` plus `config/privacy.local.json`) run on the file name, alt text and
  caption. A hit stops the upload and prints only the kind and a tag, never the term.
- JPEG and PNG metadata (EXIF, GPS, XMP, text chunks) is removed without re-encoding. A JPEG that relies on an EXIF
  rotation is re-encoded once so it still shows the right way up. Video and WebP metadata is left as is (a note says so).

If any file in a batch is refused, nothing is uploaded.

## One-time setup: the token

1. In the admin (https://cms.rioku.dev/admin): Settings → API Tokens → Create new API token.
2. Name: `media-upload`. Token duration: 30 days. Token type: Custom.
3. Permissions: Upload → `upload` and `find`. Nothing else.
4. Save, copy the token, and add it to `cms/.env` (gitignored, never committed):

   ```
   STRAPI_UPLOAD_TOKEN=paste-the-token-here
   ```

`STRAPI_URL` defaults to `https://cms.rioku.dev`. Set `STRAPI_URL=http://localhost:1337` to try it on a local Strapi.
Plain http is refused for anything but localhost. When the token expires, regenerate it in the same screen.

## Examples

```bash
cd cms
# check first: prints the planned name and type, sends nothing
npm run media:upload -- ~/shots/IMG_0042.jpg --alt "Server racks along the cold aisle" --dry-run
# upload one file with a caption
npm run media:upload -- ~/shots/IMG_0042.jpg --alt "Server racks along the cold aisle" --caption "The first full row."
# several files with one alt text: names get -1, -2, ...
npm run media:upload -- ~/shots/hall-*.png --alt "Data hall from above" --name data-hall
```

Output, one line per file:

```json
{"id":42,"documentId":"abc123...","url":"https://.../data_hall_1_b4a2e9a977.png","name":"data-hall-1.png","mime":"image/png","size":120.5}
```

## Folders

The Content API in Strapi 5.58 always puts uploads in the "API Uploads" folder; it has no folder option, so
`--folder` is refused with a pointer here. To file an upload elsewhere, move it afterwards with the MCP tools
(`media_list_folders`, `media_create_folder`, `media_move_assets`) or in the admin.
