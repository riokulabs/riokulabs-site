# Uploading media from the command line

`npm run media:upload` sends images and videos to the Strapi media library. Strapi's MCP server can list, edit and move
media but cannot upload, so this fills that gap. It prints the new file's id, which you then use to attach the file to
an entry. With an admin token it can also put the file straight into a Media Library folder.

## What it checks before sending

- Images and videos only (png, jpg, webp, gif, avif, mp4, webm, mov). The content must match the extension.
- 20 MB per file. `--force` allows more; the server stops at 25 MB.
- Alt text is required. Use `--decorative` only for images that add nothing to the text.
- The public file name comes from `--name` or the alt text: lowercase words and hyphens. Names that look like work
  items (`plan-3`, `task-2`, `t12c`, `wip`, `audit`, `ruling`) are refused unless you pick one with `--name`.
- The privacy deny lists (`config/privacy.json` plus `config/privacy.local.json`) run on the file name, alt text,
  caption and folder. A hit stops the upload and prints only the kind and a tag, never the term.
- JPEG and PNG metadata (EXIF, GPS, XMP, text chunks) is removed without re-encoding. Bytes after the end of a JPEG are
  dropped. A JPEG that relies on an EXIF rotation is re-encoded once so it still shows the right way up. Video and
  WebP metadata is left as is (a note says so).

If any file in a batch is refused, nothing is uploaded.

## One-time setup: the admin token

The script prefers an admin token (`STRAPI_ADMIN_TOKEN`). It uploads through the Media Library's own admin route
(`POST /upload`), the same one the admin UI uses, and that route accepts a folder.

1. In the admin (https://cms.rioku.dev/admin): Settings → Admin Tokens → Create new Admin Token.
2. Name: `media-upload`. Token duration: 30 days.
3. Permissions: Plugins → Media Library, tick only:
   - **Access the Media Library** (lists folders and files)
   - **Create (upload)** (uploads files and creates folders)

   Nothing else: no settings, no content types, no other plugins. Leave **Update (crop, details, replace) + delete**
   unticked: in Strapi 5.58 that one permission also allows deleting files, and the script never needs it. Download,
   Copy link, Configure view and the settings page are not needed either.
4. Save, copy the token, and add it to `cms/.env` (gitignored, never committed):

   ```
   STRAPI_ADMIN_TOKEN=paste-the-token-here
   ```

An admin token acts as the admin who created it, limited to the permissions ticked above. It stops working when it
expires, is revoked, or that admin is deactivated. When it expires, regenerate it in the same screen.

### Fallback: a Content API token

Without `STRAPI_ADMIN_TOKEN` the script uses `STRAPI_UPLOAD_TOKEN`, a Content API token (Settings → API Tokens → Custom,
permissions Upload → `upload` and `find`, 30 days). It uploads through `POST /api/upload`, which in Strapi 5.58 always
puts files in the "API Uploads" folder, so `--folder` is refused on this path. If both tokens are set, the admin token
wins. The script never prints either token.

`STRAPI_URL` defaults to `https://cms.rioku.dev`. Set `STRAPI_URL=http://localhost:1337` to try it on a local Strapi.
Plain http is refused for anything but localhost.

## Examples

```bash
cd cms
# check first: prints the planned name, type and folder, sends nothing
npm run media:upload -- ~/shots/IMG_0042.jpg --alt "Server racks along the cold aisle" --folder "Blog/Server rack post" --dry-run
# upload one file with a caption into an existing folder
npm run media:upload -- ~/shots/IMG_0042.jpg --alt "Server racks along the cold aisle" --caption "The first full row." \
  --folder "Blog/Server rack post"
# several files with one alt text: names get -1, -2, ...; create the folder if it is missing
npm run media:upload -- ~/shots/hall-*.png --alt "Data hall from above" --name data-hall --folder "Blog/Data hall" --create-folder
```

Output, one line per file:

```json
{"id":42,"documentId":"abc123...","url":"https://.../data_hall_1_b4a2e9a977.png","name":"data-hall-1.png","mime":"image/png","size":120.5,"folder":"Blog/Data hall","folderId":7}
```

## Folders

`--folder "Blog/Server rack post"` is a path of folder names from the Media Library root, separated by `/`. The script
reads the folder tree (`GET /upload/folder-structure`) and matches each level by name: exact first, then a single
case-insensitive match. The output shows the names as stored in Strapi.

- If the folder exists, the files go into it.
- If part of the path is missing, the script refuses before uploading anything and lists the folders that do exist at
  that level. Check the spelling, or pass `--create-folder` to create the missing levels (`POST /upload/folders`).
- `--dry-run` looks the folder up but never creates one; it says which folders it would create.
- `--folder` needs `STRAPI_ADMIN_TOKEN`. With only the Content API token, move files afterwards with the MCP tools
  (`media_list_folders`, `media_create_folder`, `media_move_assets`) or in the admin.
