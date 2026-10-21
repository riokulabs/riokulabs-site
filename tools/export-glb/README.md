# tools/export-glb/

Blender → GLB exporter for the 3D block viewer (docs/website/BLOCK-VIEWER.md, milestone M7).

```bash
cd tools/export-glb
npm install                      # gltf-transform + meshoptimizer (once)
npm run assets                   # (re)generate OUR textures: glyph atlas (Barlow Condensed, OFL) + perforation tile
node build.mjs                   # the four hero blocks; or: node build.mjs DC_Rack42_SplitFront ...
node validate.mjs                # re-check every GLB in web/public/models/ (and models/<mod>/) + the mod manifests
```

What `build.mjs` does:
1. **Stages a scratch copy** of `mods/DataCenter/Source/Model` and `tools/se2model` (plus the two KVM trajectory CSVs
   and the one vanilla FBX the CRAC builder imports as a kit part) into `.work/ws` (gitignored). Blender only ever
   runs against that copy; nothing under `mods/` is opened for writing. `export_glb.py` refuses to run if pointed at
   the real `mods/`.
2. **Blender** (`export_glb.py`, Route A): calls the same builders as the game export, takes LOD0 + subparts at their
   dummies, **removes Keen kit parts** (tagged at build time, plus name markers) and replaces each with our own
   chamfered port frame, maps every material slot to the web set (`WEB_*`), remaps stencil glyph quads to **our**
   atlas, drops other Keen decal quads (counted), and authors clips as NLA tracks: `DoorsOpen/DoorsClose` (85°,
   linear 1 s like the game), `KvmOpen/KvmClose` (sampled at 30 fps from the CoreTests trajectories),
   `FansSpinUp/FansRun` (2 s soft start, then a seamless loop).
3. **finish.mjs**: final flat PBR values (painted metal ≈ metalness 0.55 / roughness 0.44, measured averages, no
   Keen pixels), our two textures, rest pose = doors shut / KVM stowed, dedup + prune + **meshopt**; writes
   `web/public/models/<slug>.<hash>.glb`, `web/src/data/models.json` and `provenance/<slug>.provenance.json`.
4. **validate.mjs** (the gate): no Keen markers in names, only web materials, only allow-listed image hashes
   (`assets/allowed-images.json`), ≤ 2 MB, ≤ 60k triangles, ≤ 12 materials, ≤ 8 animated nodes, meshopt present.
   Passing marks the provenance `clean`; the site only loads `clean` models.

Then `cd ../../cms && npm run build:fixtures` (and `npm run seed -- --update` for the local CMS) to pick up new paths.

## Every block, plus variants, published into the site

```bash
node build.mjs --all --variants                       # all 73 Data Center blocks -> web/public/models/data-center/
node build.mjs --all --variants 'DC_Rack*' DC_CRAC    # a subset (names or globs); the other blocks' entries are kept
node build.mjs --all --variants --mod data-center     # --mod: the mod's folder and manifest name (this is the default)
node build.mjs --all --variants --review [--out <dir>]  # the unhashed review copy (default <workspace>/resources/previews/site-redesign/_assets/models/all)
```

Never touches the hero files, `web/src/data/models.json` or the hero provenance. Stages `mods/DataCenter/Source/Model`
from **git HEAD** (`git archive`, read-only; `--from-worktree` to use the working tree instead), runs N parallel Blender
jobs (`--jobs`, default 6; refuses to start while `Modern.bin` runs), and writes per block:

- `web/public/models/<mod>/<slug>.<hash8>.glb` (intact; the racks' tray fans also get FansSpinUp/FansRun, the containment
  doors DoorsOpen/DoorsClose), with `--variants` also `<slug>.damaged.<hash8>.glb` (the Damaged LOD0),
  `<slug>.fracture.<hash8>.glb` (one node per zone, `Frac_NN`, origin at the zone centre) and `<slug>.stages.<hash8>.glb`
  (nodes `Stage_1..N`). `<hash8>` is the first 8 hex of the file's SHA-256, so the site can cache them forever; the
  output is deterministic (same HEAD, same hashes, whether a block is built alone or in the full batch).
- `web/src/data/models/<mod>.json`: one entry per block (id, slug, displayName, family, subfamily, sizeLabel, dims_m,
  tris, bytes, clips, files, paintable, materials, variants, missing); `files.<kind>` is the site URL
  (`/models/data-center/dc-rack42-open.7f15238c.glb`).
- `provenance/<mod>/<slug>.provenance.json`: per file path, sha256, validation and status, plus the block's kit-part,
  decal, glyph and material-source report; `status: clean` when every file is.

Every file is gated by the validator as it is written (intact: the site budget; variants: same cleanliness gates,
budget `VARIANT_BUDGET`). A failing file is deleted and left out of the manifest (`missing.<kind>` says why; a failing
intact model drops the block), so the manifest only ever lists clean files. Hashed files in the mod folder that no
manifest entry references are removed (only names matching `validate.mjs` `OWNED`). `node validate.mjs` re-checks the
hero files, every `web/public/models/<mod>/` file and that each `web/src/data/models/<mod>.json` references only files
that exist and are clean in provenance. The variants come from the mod's own `dc/export_models.export_block`, run on the
scratch copy with its FBX writers swapped for in-memory captures (kit parts replaced by our port frame first).

## Publishing the block-explorer models (GLBs stay out of git)

The per-mod GLBs in `web/public/models/<mod>/` are ignored by git (about 36 MB per Data Center export). The catalogue
`web/src/data/models/<mod>.json` is tracked, and so is `<mod>.release.json`, which names a GitHub Release tarball.

1. Export: `node build.mjs --all --variants` (writes the GLBs and the catalogue).
2. Pack: `node pack.mjs [--mod data-center]` writes `.work/release/models-<mod>-<hash>.tar.gz` and
   `web/src/data/models/<mod>.release.json`. The tag is a hash of the catalogue, so each export gets its own release.
3. Publish (maintainer, once per export): run the `gh release create …` command `pack.mjs` prints. Public repo, so the
   build downloads it without a token.
4. Commit the catalogue and the release JSON.

At build time `web/scripts/fetch-models.ts` (part of `prebuild`/`predev`) skips the download when the files are already
there (local exports), otherwise downloads the tarball, checks its SHA-256 and unpacks it. Visitors only ever fetch the
GLBs from the static site; nothing here touches git, LFS or Strapi at page-view time.
