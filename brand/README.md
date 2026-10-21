# brand/

The Rioku Labs logo families (round 1, 2026-10-20), copied from the workspace's `resources/brand/riokulabs/`, where
`tools/build.py` generates every file from geometry and outlined OFL Barlow / Barlow Condensed glyphs (licence:
`riokulabs/OFL.txt`). No third-party artwork; nothing drawn by hand.

- `riokulabs/R1` … `R5`: five concept families. Each has the horizontal lockup (dark, light, mono white, mono black),
  stacked lockup, mark (same four colourways), 16-unit favicon tile, one-colour watermark, and PNG/JPG exports: mark
  1024, lockup 2048, GitHub avatar 500×500, Steam description header 1270×360, default social card 1200×630.
  | ID | Name | Idea |
  |---|---|---|
  | R1 | Orbit R | an R with a moon on an orbit passing behind and in front of it |
  | R2 | Mod block | a building block with one piece lifted out and hovering |
  | R3 | Placed pixel | a pixel-built R with the last pixel still moving into place |
  | **R4** | **Lab flask** | a lab flask holding a ringed planet (**the user's pick, 2026-10-20**; its 16 px favicon is a pixel-grid redraw: outline, liquid, one ember bubble) |
  | R5 | Selection reticle | game-UI selection brackets around an RL monogram |
- `riokulabs/text/`: the plain-text fallback (RIOKU LABS wordmark + an RL favicon tile).
- `riokulabs/concepts.json`: ids, names and one-line ideas (the /brand page shows them).

**Swapping the logo is one value:** `web/src/config/brand.ts` → `LOGO_FAMILY` (`'R1'` … `'R5'`, or `'text'`).
`web/scripts/brand.ts` (runs before dev/build) installs that family: header/footer lockup, favicon.svg + favicon.ico,
apple-touch and manifest icons (rendered from the micro mark), the corner mark on every generated OG card, the default
OG card, the /brand downloads and the concept gallery. The user picked R4 on 2026-10-20; the studio name and domain are
separate single values in `web/src/config/identity.json`.

The retired logo family is archived outside this repo; the build lints `dist/` so none of it can come back by accident
(`retiredBrandTerms` in the private privacy lists, merged over `cms/config/privacy.json`).
