---
name: turning-notes-into-prose
description: Use when the maintainer gives bullet notes, a list of changes, or rough points and asks to turn them into a paragraph or section of a blog or dev-log post.
---

# Turning notes into prose

Write the section the maintainer would have written from these notes, and nothing more. Everything in it has to be
traceable to the notes, to something they've told you, or to the mod's own docs.

## What you return, in this order

1. **The section.**
   - A heading in sentence case that says what's in it ("Power strips, a cooler and some signs"). No signposts like
     "Here's the honest part".
   - Plain American English, contractions, varied sentence length. "We" for the team; "I" only for something the
     maintainer said about themselves.
   - Facts only from the notes or the mod docs (`mods/<Mod>/README.md`, `CHANGELOG.md`). Use the docs to confirm a
     fact or sharpen a point, at most one or two added details, listed under "Added from the docs". Never add how-to
     steps (where to aim, which menu); that belongs on the mod page.
   - For each point, say why a player would notice or care, in a clause or a sentence. That's what keeps it
     interesting, not extra detail.
   - No invented experiences, feelings or scenes in their voice. No claims about how real hardware behaves unless the
     notes say so. No promises about the future unless the notes make them.
   - Zero jokes in the text.
   - 100-300 words. End on the last real point, not a wrap-up line.
2. **Joke spot (optional):** at most one for the whole section: where it would go and one suggested line built from
   something true in the notes. Or "none".
3. **Added from the docs:** facts you pulled in, with the file, or "nothing".
4. **Check this:** anything you had to assume, or "nothing".

## Example

Note: "in-row cooler draws power, fans spin up with a 2 second soft start, doesn't actually cool anything (game has no
heat), decided to be upfront in the description"

Section text: "The in-row cooler now draws power, and its fans spin up over a two-second soft start when you switch it
on. It doesn't cool anything, because Space Engineers 2 has no heat to remove, and the mod description says so."

Joke spot: after "no heat to remove". Suggestion: "It's very good at looking busy."

## Before you hand it over

Go through the section sentence by sentence and point each one at a note or a doc line. Anything you can't point at
comes out.
