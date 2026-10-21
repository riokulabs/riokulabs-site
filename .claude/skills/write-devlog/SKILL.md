---
name: write-devlog
description: Draft a Rioku Labs dev-log post (a build story or a thought piece) in the maintainer's voice, with real facts, pictures and 3D embeds, and save it to Strapi as a private draft. Use when asked to write, draft, rewrite or expand a blog or dev-log post.
---

# Write a dev-log post

The dev log exists so players get sneak peeks, technical detail and the occasional opinion, the way Keen's dev blogs
and Cloudflare's engineering blog do it, and so the next person feels they could build their own mod. Posts have to
read like a person wrote them. The maintainer is picky about this, and anything that sounds generated gets thrown out.

## 1. Get the facts first

- Build posts: read the mod's own docs in the workspace (`mods/<Mod>/README.md`, `CHANGELOG.md`, `NOTES.md`). Use the
  real numbers: sizes, speeds, counts, before and after. Never invent a fact, a number, an anecdote or a feeling.
- Anything about the maintainer personally (their job, history, opinions) comes only from what they've said. If you
  have to fill a gap, write it, then list it as "check this" when you hand the draft over.
- Only public things: our released or announced mods. Ideas for unreleased mods appear only as vague teasers, never
  how they'd work. The CMS privacy guard and the build will reject private names anyway; don't try to get round them.

## 2. Voice

- Build posts are "we" (Rioku Labs). Opinion and personal pieces are "I", by the maintainer's author entry.
- Plain words, contractions, varied sentence length. Say what went wrong and why, with numbers. A little dry humour
  is fine.
- No AI tells: no em dashes as pivots, no lists of three by reflex, no "not just X, but Y", no "delve", "seamless",
  "robust", "it's worth noting", "in conclusion", no tidy moral at the end, no hype.
- No internal process references: no "Plan 3", "Task 12", "T9c", rulings, audits, fix rounds, branches, merges,
  code or subpart names, tool names. Describe what changed in plain words.
- Long and in depth: about 1,000 to 1,600 words for a build post. A short post reads as filler.

## 3. Shape

- Open on the real-world thing or the problem, not on "In this post".
- Headings every few paragraphs, written like a person talking ("Then the doors", "Measuring a hole").
- A section with a picture or video every 300 to 400 words. Numbers that compare well go in a stat grid with a
  "was" note.
- End on something concrete: a try-it embed, how to turn it on, or a plain last line. Not a summary.

## 4. Pictures and embeds

Body sections (Strapi dynamic zone): `sections.rich-text`, `sections.image` (size inline/wide/full),
`sections.loop-video` (mp4 + poster), `sections.compare` (before/after), `sections.gallery`, `sections.stat-grid`,
`sections.model-embed` (an interactive 3D block), `sections.timeline-embed` (a build timeline), `sections.code`,
`sections.callout`, `sections.quote`, `sections.mod-card`.

- Find existing media with `mcp__rioku-cms__media_list_assets` (search by name or folder) and use its numeric `id`
  as `file`. Models: `mcp__rioku-cms__list_block-3d-model`.
- New images: renders live in the workspace under `resources/previews/` (local only). Pick the few that tell the
  story, then upload them with the `upload-media` skill (neutral file names, real alt text) and use the returned id.
- Every image gets alt text that describes what's in the picture and a caption that says why it matters.
- Set a cover image.

## 5. Save it

- Create or update the post with `mcp__rioku-cms__create_blog-post` / `update_blog-post`: `visibility: "private"`,
  never publish. Updates replace the whole `body`, so always send every section.
- Author: the maintainer's author entry for opinion pieces; build posts too unless told otherwise.
- Category: "How it's made" for build stories, "Dev log" for news and thought pieces. Tag the mod and topic.

## 6. Before you hand it over

Reread the draft once just for the AI tells and internal references above, then tell the maintainer: the title, the
word count, the images used, anything you had to assume ("check this"), and any picture you'd still like to add.
