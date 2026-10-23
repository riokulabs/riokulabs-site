---
name: write-devlog
description: Draft a Rioku Labs blog post from one of the six templates (dev log round-up, feature, release notes, thoughts, spoiler, review) in the maintainer's voice, with real facts and pictures, and save it to Strapi as a private draft. Use when asked to write, draft or rework a blog or dev-log post.
---

# Write a blog post

The blog gives players sneak peeks, some technical detail and the odd opinion, the way Keen's dev diaries, Factorio's
Friday Facts and Cloudflare's engineering blog do. It has to read like a person wrote it; the maintainer throws out
anything that sounds generated.

## What makes a post work

Readers come to imagine what they could build, not to read a spec sheet. Lead with that.

- **Imagination first.** Put the reader in the game: "picture your mining ship with a little server closet off the
  main corridor". Role play, multiplayer stakes, the moment something comes to life. Specs (block counts, slot sizes,
  the full parts list) belong on the mod page, not the post. Never frame the goal as a faithful 1:1 copy of the real
  thing; that bores most players.
- **Respect the reader.** Players are adults. Say "role play", never "play pretend", and never explain the game in a
  way that talks down to people who already play it.
- **Brainstorm out loud.** A "what if" section is welcome: ideas the mod could grow into once the game allows it.
  Open it with something like "none of this is planned", hedge Keen's plans, and keep our unreleased projects as
  vague teasers.
- **Teasers go between the lines.** One understated sentence ("a small first step in that direction") beats spelling
  the hint out.
- **Bring your own ideas.** The maintainer wants the drafter's creativity, not only a tidy version of their notes.
  Propose scenes, what-ifs, angles, headings, titles and jokes of your own. List every one you invented under "Mine"
  at handover so they can keep or cut it. Facts and the maintainer's personal experiences still have to be real.
- **Humor.** Two or three light jokes per post, at most one per section, never the last line. The ones that land come
  from the real world of the subject and the maintainer's background (data centers, infosec: red team vs. blue team,
  DEF CON Wi-Fi) or from something true about the mod ("it doesn't cool anything, but it's very good at looking
  busy"). Affectionate teasing of Keen is fine ("Keen, if you're reading this: no pressure. Okay, a little pressure.").

## Start from the maintainer's take

Before drafting, collect what the maintainer actually thinks: ask for a few raw lines, or pull them from what they've
already said (chat, Slack screenshots, notes). Build the post around their framing and phrases, then add structure
and your own ideas around it. A draft built only from the mod docs reads like documentation.

## The rule the first drafts broke

Never stretch one small part into a whole post. A single block, mechanic or fix is a 150-300 word section inside a
dev log. A whole post goes only to a whole system with real stakes (a new mod, how a server room fits together, a hard
constraint we fought), and even then it's told for players, not as engineering notes.

## Pick a template

| Template | Use it for | Shape |
|---|---|---|
| **Dev log** (most posts) | What happened since the last one | 2-3 sentence opening, 3-5 "At a glance" bullets, 3-5 sections across the mods (what changed, why a player cares, one visual, 150-300 words each), at most one "behind the build" story, a hedged "what's next", standard footer. 1,000-1,600 words. |
| **Feature** | A whole system or a new mod, rarely | The finished thing first, as a clip; what it does for you in game; scenes of how people might use it; why we built it; what the game makes possible now; a "what if" brainstorm; limits, honestly. 1,000-2,000 words. |
| **Release notes** | Each major or minor release (see "Release posts" below) | "At a glance", known issues up front, one heading per feature with a visual and a one-line benefit, install link, link to the full changelog. |
| **Thoughts** | Opinion pieces | The claim or decision first, the reasoning, fair credit to other views, an honest "we don't know yet", ending on what we'll do. First person, the author's own voice. |
| **Spoiler** | Hidden or unfinished game content | Only after a major Keen update or when a diff finds hidden content; never for a hotfix. Behind the spoiler gate (`spoiler: true`). What it is and where it showed up in game, what it might mean, hedged hard. Visuals and sources follow "Spoiler visuals" below; never say where in the game files a fact came from. Honest titles: don't promise hidden content when there's none. |
| **Review** | Yearly or at a milestone | TL;DR, a few themes, priorities ahead, "what this means for you" split by players, modders and contributors. |

The "behind the build" story uses the small-change arc: what bugged us → why it was harder than it looked → what the
player would lose without it → the fix → what's still missing. If a topic can't fill that arc, it gets one line.

## Release posts

- **Only major and minor releases get a post** (x.0.0 and x.y.0). A patch (x.y.z) never gets its own post.
- **Patches go into their minor release's post.** Edit the existing post, don't create a new one:
  - add or extend a "Patch notes" section near the top, newest patch first: a `### vX.Y.Z` heading with the date,
    then short bullets of what was fixed or changed, in player terms;
  - update the known issues (strike or remove the ones that are fixed);
  - set the post's `updatedNote` to one line such as "Updated for v0.9.1: two fixes";
  - keep the title, slug and date; publish the update.
- **Title:** always `Release: <Mod name> v<major>.<minor>.<patch>`, with the full three-part version of the release
  the post is for, for example "Release: Data Center v0.9.0". No hook or subtitle in the title; put the personality
  in the subtitle and the opening.
- **Slug:** follows the title, for example `release-data-center-v0-9-0`.
- **Category:** Release notes. Tag the mod and link it in `relatedMods`.

## Titles

Release posts use the fixed format above. For everything else: a little markety, YouTube-ish but restrained: a hook that names the interesting thing. No fake urgency, no all caps,
no "you won't believe". Puns go in headings. Examples of the register: "We Gave a Server Rack a Proper Way to Die",
"Your Ship Deserves a Server Room", "Drones That Patch Your Hull While You Fly".

## Facts

- Build content comes from the mod's own docs in the workspace (`mods/<Mod>/README.md`, `CHANGELOG.md`, `NOTES.md`).
  Use real numbers. Never invent a fact, a number, an anecdote or a feeling.
- Before handing over, check every claim about what a block does against the README, especially anything that
  depends on launch options or scripts (the Programmable server only runs code with `-loadScripts`).
- Anything about the maintainer personally comes only from what they've said. If you fill a gap, flag it as
  "check this" when you hand over the draft.
- Unreleased ideas stay vague teasers. The CMS privacy guard and the build reject private names anyway.

## Voice

- "We" for the team, "I" for opinions and personal notes. American English.
- Plain words, contractions, varied sentence length, candor about what broke or got cut, hedged plans.
- No AI tells:
  - no em dashes as pivots, no reflexive lists of three, no "not just X, but Y";
  - no "delve", "seamless", "robust", "it's worth noting";
  - no "the short answer / the long answer" setups, no "Here's the trick";
  - no mirrored lines ("None of that changes X. All of it changes Y."), no "and that's fine";
  - no bullets that open with a bold label, no run of three questions;
  - no tidy moral at the end, no hype.
- No internal process references: no plan or task numbers, rulings, audits, fix rounds, branches, code or subpart
  names, tool names.
- Don't "fix" quirks in text the maintainer wrote themselves.

## Spoiler visuals

What a spoiler post may show, and where its facts may come from:

- **Allowed:** our own in-game screenshots and clips of anything reachable in normal play (Keen's video policy covers
  in-game capture), including footage made with Keen's official debug menu (say so in the caption, and use a
  throwaway world).
- **Allowed: our own concept art,** when it's our own design. It must be marked in the caption, for example "Rioku
  Labs concept art: our guess, not from Keen's files and not official". Design it from the facts in the post (a
  12.5 m two-leaf gate, a flat atmospheric thruster), never from Keen's hidden models: no tracing, no matching
  their silhouette, no renders made with their files in view. Keep our own look so nobody mistakes it for a leak.
- **Never:** renders or images of Keen's unreleased models, textures or art taken from the game or SDK files, and
  no footage of features unlocked with hidden launch options (for example co-op before Keen ships it).
- **Sources for facts:** lean on what's visible in the shipped data, language and asset files. Findings that only
  come from decompiled code are phrased cautiously or tied to what Keen has said in public, and are never cited.
- Don't say Keen recommends datamining unless we can link a Keen statement that says so.

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

One closing line, then the standard footer (mod page or Workshop, GitHub, RSS). Until the Rioku Labs Discord exists,
an invitation to share ideas may point to the mod's GitHub Discussions; no other reply-asking lines. Two calls to
action at most.

## Saving

- Create the draft with `mcp__rioku-cms__create_blog-post` and `visibility: "private"`. Never publish; the maintainer
  does.
- For later edits use the CMS CLI (`editing-cms-content` skill): it changes one field or section and checks nothing
  else moved. MCP `update_blog-post` replaces the whole body, so it needs every section and every required field.
- Category by template (Dev log, How it's made for features, Release notes); tag the mods covered.
- Hand over: title, template, word count, images used, "Mine" (the ideas and jokes you invented), anything flagged
  "check this", pictures you'd still add. Offer a readable Markdown copy of the draft.

Research behind this: `docs/website/research/` in the workspace (blog-templates-proposal.md and the four source notes).
