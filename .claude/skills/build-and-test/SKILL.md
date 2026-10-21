---
name: build-and-test
description: Build and test Rioku Labs website with its real commands, and say which checks need tools that are not available in CI. Use when asked to run the tests, verify a change, or check whether the repo builds.
---
<!-- managed by riokulabs/.github - edit there (templates/), not here -->

# Build and test Rioku Labs website

1. Run the offline checks first: `scripts/test.sh`.
2. For a quick guard pass on what you changed: `python3 scripts/check_repo_guard.py --staged`.
3. Then, if the change needs it, the steps that only work on the maintainer's machine:

- Browser tests: `cd web && npx playwright install chromium && npm run test:e2e`; Lighthouse (local only, not in CI: timings on shared runners are noise): `npm run lighthouse`.

Report what ran, what passed, and what you could not run (and why). Do not claim a build passed if only the offline checks ran.
