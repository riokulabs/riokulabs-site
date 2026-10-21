#!/usr/bin/env bash
# managed by riokulabs/.github - edit there (templates/), not here
# The checks CI and the pull request template ask for. Run from anywhere in the clone.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
( cd cms && npm ci && npm run check )
( cd web && npm ci && npm test && npx astro check && npm run build )
# Browser tests also run in CI: cd web && npm run test:e2e. Lighthouse is local only: npm run lighthouse
