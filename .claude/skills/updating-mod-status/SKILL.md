---
name: updating-mod-status
description: Bring every place on the Rioku Labs site that describes a mod back in line after its state changes. Use when a mod gets a release or a patch, reaches a new test milestone, moves from idea to in progress, is delayed or blocked, or retires, and when asked to update the roadmap or a mod page.
---

# Updating a mod's status

A mod's state lives in the mod entry, its milestones, mod-release entries, blog posts and the home page, and they
drift. Change them together, from facts, in one pass. Commands: `cms/scripts/README-cms-cli.md`.

## 0. Get the facts

The mods session owns the mod. Send it a message and ask for:
- the version and date (Workshop upload date for a release)
- the changelog lines, in player terms
- what is done, what is now, what is next
- what is off-limits: unannounced parts, numbers not settled, anything not yet public

Don't guess. Never publish numbers or parts the mods session hasn't cleared.

## 1. Audit

```bash
cd cms && npm run cms -- mod-status <slug>      # or --all for every public mod
```

Read every warning; each says what is out of line and why.

## 2. Sync checklist

| Event | Change |
| --- | --- |
| Entering testing | stage `testing`; move finished milestones to done with a date; a short "now" item for the test. |
| Idea to in progress | modStatus `wip` and a stage; rewrite tagline, summary and feasibility from teaser to plain description; done/now milestones. |
| First release | modStatus `published`, clear stage, currentVersion, Workshop/mod.io/GitHub links, specs Version row, callouts that said "not on the Workshop"; release milestones to done with the date, a new "next"; mod-release entry with highlights and notes; post `Release: <Mod> vX.Y.Z`; home featured mod or teaser. |
| Minor or major (x.y.0) | currentVersion, Version row, mod-release entry, a new release post, roadmap moved on. |
| Patch (x.y.z) | currentVersion, Version row, mod-release entry; patch notes appended to the x.y.0 post with `updatedNote` (see `write-devlog`). No new post. |
| Delay or blocked | stage `blocked` or `paused` with blockedReason; reword now/next items so they don't promise a date. |
| Retirement | say so in the summary and a callout; clear later items; keep the page and its history. |

Keep milestone labels short and human. Workshop description images go under `web/public/workshop/<mod>/` through a
pull request. The mod's README, CHANGELOG and Workshop text belong to the mods session: send it a note with what you
changed on the site instead of editing them.

## 3. Check before writing

- Unreleased or upcoming mod: show the maintainer a before/after table of every change and wait for a yes.
- Factual corrections for a released mod (a stale version, a missing date) can go straight in.
- All public wording gets the AI-tell review from `write-devlog` and follows the site content rules: general wording,
  no show names in mod, block, release or roadmap content, American English.

## 4. Apply, publish, confirm

1. Write drafts with `npm run cms -- set` and `section` (create new entries with the MCP tools).
2. Re-run `mod-status <slug>` until the warnings left are ones you meant to keep.
3. Publish the changed entries together (`publish ... --yes`), only when the maintainer asked this session.
4. Wait for the site rebuild, then check the mod page, `/roadmap` and the home page on the live site.
