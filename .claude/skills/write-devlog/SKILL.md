---
name: write-devlog
description: Draft a Rioku Labs blog post from one of the six templates (dev log round-up, feature, release notes, thoughts, spoiler, review) in the maintainer's voice, with real facts and pictures, and save it to Strapi as a private draft. Use when asked to write, draft or rework a blog or dev-log post.
---

# Write a blog post

The blog gives players sneak peeks, some technical detail and the odd opinion, the way Keen's dev diaries, Factorio's
Friday Facts and Cloudflare's engineering blog do. It has to read like a person wrote it; the maintainer throws out
anything that sounds generated.

## The rule the first drafts broke

Never stretch one small part into a whole post. A single block, mechanic or fix is a 150-300 word section inside a
dev log. A whole post goes only to a whole system with real stakes (a new mod, how a server room fits together, a hard
constraint we fought), and even then it's told for players, not as engineering notes.

## Pick a template

| Template | Use it for | Shape |
|---|---|---|
| **Dev log** (most posts) | What happened since the last one | 2-3 sentence opening, 3-5 "At a glance" bullets, 3-5 sections across the mods (what changed, why a player cares, one visual, 150-300 words each), at most one "behind the build" story, a hedged "what's next", standard footer. 1,000-1,600 words. |
| **Feature** | A whole system or a new mod, rarely | Result first with the finished thing as a GIF or clip; why we wanted it; options and constraints; design decisions; how it plays in game (before/after); limits; what's next; try it. Optional nerd-detail box. 1,500-2,500 words. |
| **Release notes** | Each Workshop update | "At a glance", known issues up front, one heading per feature with a GIF and a one-line benefit, install link, link to the full changelog. Terse. |
| **Thoughts** | Opinion pieces | The claim or decision first, the reasoning, fair credit to other views, an honest "we don't know yet", ending on what we'll do. First person, the author's own voice. |
| **Spoiler** | Hidden or unfinished game content | Behind the spoiler gate (`spoiler: true`). What it is and where it showed up, what it might mean, hedged hard. Our own screenshots or descriptions only, never game asset files or decompiled code. |
| **Review** | Yearly or at a milestone | TL;DR, a few themes, priorities ahead, "what this means for you" split by players, modders and contributors. |

The "behind the build" story uses the small-change arc: what bugged us → why it was harder than it looked → what the
player would lose without it → the fix → what's still missing. If a topic can't fill that arc, it gets one line.

## Titles

A little markety, YouTube-ish but restrained: a hook that names the interesting thing. No fake urgency, no all caps,
no "you won't believe". Puns go in headings. Examples of the register: "We Gave a Server Rack a Proper Way to Die",
"Your Ship Deserves a Server Room", "Drones That Patch Your Hull While You Fly".

## Facts

- Build content comes from the mod's own docs in the workspace (`mods/<Mod>/README.md`, `CHANGELOG.md`, `NOTES.md`).
  Use real numbers. Never invent a fact, a number, an anecdote or a feeling.
- Anything about the maintainer personally comes only from what they've said. If you fill a gap, flag it as
  "check this" when you hand over the draft.
- Unreleased ideas stay vague teasers. The CMS privacy guard and the build reject private names anyway.

## Voice

- "We" for the team, "I" for opinions and personal notes. American English.
- Plain words, contractions, varied sentence length, candor about what broke or got cut, hedged plans.
- No AI tells: no em dashes as pivots, no reflexive lists of three, no "not just X, but Y", no "delve", "seamless",
  "robust", "it's worth noting", no tidy moral at the end, no hype.
- No internal process references: no plan or task numbers, rulings, audits, fix rounds, branches, code or subpart
  names, tool names.
- Don't "fix" quirks in text the maintainer wrote themselves.

## Pictures

- One visual per section, placed right after the text it proves. Process shots (sketch → Blender → in game) and
  before/after pairs beat code.
- **New visuals by default.** Each post features fresh renders, GIFs or video made for it; that's what readers come
  for. Plan the shot list with the post and ask the mods session for the renders and in-game captures. Reuse an
  existing image only as a deliberate callback ("remember the hollow cabinet?"), never as filler.
- New files go up with the `upload-media` skill. 3D blocks can be embedded (`sections.model-embed`); find them with
  `mcp__rioku-cms__list_block-3d-model`.
- Every image gets alt text (what's in it) and a caption (why it matters). Set a cover.

## Ending

One closing line, then the standard footer (mod page or Workshop, GitHub, RSS). No closing question asking for
replies until the Rioku Labs Discord exists. Two calls to action at most.

## Saving

- `mcp__rioku-cms__create_blog-post` / `update_blog-post` with `visibility: "private"`. Never publish; the maintainer
  does. Updates replace the whole `body`, so always send every section.
- Category by template (Dev log, How it's made for features, Release notes); tag the mods covered.
- Hand over: title, template, word count, images used, anything flagged "check this", pictures you'd still add.

Research behind this: `docs/website/research/` in the workspace (blog-templates-proposal.md and the four source notes).
