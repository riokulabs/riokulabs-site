<!-- managed by riokulabs/.github - edit there (templates/), not here -->
## What this changes

<!-- What and why, in a few sentences. Link the issue: "Fixes #123". -->

## How you checked it

<!-- Commands you ran, what you saw. -->

## Checklist

- [ ] `npm run check` passes in `cms/`, and `npm test`, `npx astro check` and `npm run build` pass in `web/`
- [ ] Anything private stays private: visibility-gated collections still hide drafts and private entries (the build's privacy canary passes)
- [ ] `npm run check:public` passes in `cms/`: no private project names, ideas or deny-list terms in tracked files (they live only in the gitignored `cms/config/privacy.local.json` and `cms/seed/private.ts`)
- [ ] No secrets: no `.env`, tokens or API keys committed; `cms/.env.example` lists names only
- [ ] Visible text is plain language; art is our own renders or captures, never a publisher's key art
- [ ] No new deploy steps in CI; the GitHub Pages workflow (`.github/workflows/pages.yml`) keeps its triggers, secrets and gates unless the maintainer approved a change
- [ ] Commits are signed off (`git commit -s`, see CONTRIBUTING.md)
- [ ] I have signed the Rioku Labs CLA (the bot asks on your first pull request; see CONTRIBUTING.md)
