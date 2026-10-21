import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SE2 = '/games/space-engineers-2';
const DC = `${SE2}/mods/data-center`;

test('primary nav: Home, Mods, Roadmap, Dev log, About; the home page features our mods', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
  await expect(nav).toHaveText(['Home', 'Mods', 'Roadmap', 'Dev log', 'About']);
  await expect(nav.first()).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[aria-current=page]')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText(/^Rioku\s*Labs$/);
  await expect(page.locator('h1 span')).toHaveText('Labs');
  await expect(page.locator('#hall')).toHaveAttribute('aria-labelledby', 'hero-title');
  await expect(page.locator('#hall .beat--1').getByRole('link', { name: 'Browse our mods' })).toHaveAttribute('href', '/mods');
  await expect(page.locator('#hall .beat--1').getByRole('link', { name: 'See the roadmap' })).toHaveAttribute('href', '/roadmap');
  const mods = page.locator('#mods');
  await expect(mods.getByRole('heading', { name: 'Our mods' })).toBeVisible();
  await expect(mods.locator(`a.tile--live[href="${DC}"]`)).toHaveCount(1);
  await expect(mods.locator(`a.tile--live[href="${DC}"]`)).toBeVisible();
  await expect(mods.locator('.tile--tease')).toHaveCount(2); // ideas are teasers, never links
  await expect(mods.locator('a.tile--tease')).toHaveCount(0);
  await expect(page.locator('#log .pcard')).toHaveCount(3);
  // mod and game pages count as "Mods"
  for (const url of [DC, SE2, '/mods']) {
    await page.goto(url);
    await expect(page.getByRole('navigation', { name: 'Primary' }).locator('[aria-current=page]')).toHaveText('Mods');
  }
  await page.goto('/blog/how-the-data-center-was-made');
  await expect(page.getByRole('navigation', { name: 'Primary' }).locator('[aria-current=page]')).toHaveText('Dev log');
});

test('/games lists the public games with their mod counts, and never the private canary game', async ({ page }) => {
  await page.goto('/games');
  await expect(page.locator('[data-game]')).toHaveCount(1);
  const se2 = page.locator('[data-game="space-engineers-2"]');
  await expect(se2).toContainText('Space Engineers 2');
  await expect(se2).toContainText(/1 in testing/); // the same stage-aware words as the tiles and the /mods filters
  await expect(se2).not.toContainText(/\b0 /); // empty buckets are left out
  await expect(page.locator('body')).not.toContainText(/canary/i);
});

test('a game page shows its mods, install notes, posts and trademark line', async ({ page }) => {
  await page.goto(SE2);
  await expect(page.locator('h1')).toHaveText('Space Engineers 2');
  const tiles = page.locator('section[aria-labelledby=game-mods] .tile');
  await expect(tiles.and(page.locator(`a[href="${DC}"]`))).toHaveCount(1);
  await expect(page.locator(`a.tile[href="${DC}"]`)).toContainText('73 blocks');
  await expect(page.locator('section[aria-labelledby=game-mods] .tile--tease')).toHaveCount(5);
  await expect(page.locator('#platform')).toBeVisible();
  await expect(page.locator('.prose')).toContainText('-loadScripts');
  await expect(page.locator('section[aria-labelledby=game-posts] .pcard')).not.toHaveCount(0);
  await expect(page.locator('.legal-note')).toContainText('Keen Software House');
  await expect(page.locator('a[href="https://store.steampowered.com/app/1133870/"]')).toHaveCount(1);
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.join('')).toContain('"VideoGame"');
  await expect(page.locator('body')).not.toContainText(/canary/i);
});

test('mod pages live under their game URL, with Mods breadcrumbs and an honest header', async ({ page }) => {
  await page.goto(DC);
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  await expect(crumbs.getByRole('link', { name: 'Mods' })).toHaveAttribute('href', '/mods');
  await expect(crumbs.locator('[aria-current=page]')).toHaveText('Data Center');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `https://rioku.dev${DC}`);
  await expect(page.locator('.mod-head .status')).toContainText('Space Engineers 2');
  await expect(page.locator('h1')).toHaveText('Data Center');
  await expect(page.locator('.mod-head .lead')).toContainText('73 blocks');
  // no Workshop or GitHub URL yet: plain status notes, not links or button look-alikes
  const actions = page.locator('.mod-head__actions');
  await expect(actions.locator('a, button, .btn, [aria-disabled]')).toHaveCount(0);
  await expect(actions.locator('.pending')).toHaveText(['Coming to the Workshop', 'Source at release']);
  // the rest of the page: what's in it, under the hood, up close, renders
  await expect(page.locator('section[aria-labelledby=inside] .fam')).not.toHaveCount(0);
  for (const fam of await page.locator('section[aria-labelledby=inside] .fam').all()) await expect(fam.locator('p')).not.toBeEmpty();
  await expect(page.locator('section[aria-labelledby=tech] [data-sheet]')).toHaveCount(1);
  await expect(page.locator('section[aria-labelledby=tech] details.reqs summary')).toHaveText('Playing with scripts');
  await expect(page.locator('section[aria-labelledby=features] .feature')).not.toHaveCount(0);
  await expect(page.locator(`section[aria-labelledby=log] a[href="/blog?mod=data-center"]`)).toHaveCount(1);
  await page.goto(`${DC}/history`);
  await expect(page.locator('h1')).toContainText('Data Center');
});

test('old flat mod URLs answer 301 to the game URLs (generated _redirects)', async ({ request, page }) => {
  for (const [from, to] of [['/mods/data-center', DC], ['/mods/data-center/history', `${DC}/history`], ['/mods/idea-fixture-a', `${SE2}/mods/idea-fixture-a`]]) {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status(), from).toBe(301);
    expect(res.headers()['location']).toBe(to);
  }
  // only mods that had a history page get a history redirect; the query string survives
  expect((await request.get('/mods/idea-fixture-a/history', { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get('/mods/data-center?ref=steam', { maxRedirects: 0 })).headers()['location']).toBe(`${DC}?ref=steam`);
  await page.goto('/mods/data-center');
  await expect(page).toHaveURL(new RegExp(`${DC}$`));
  await expect(page.locator('h1')).toHaveText('Data Center');
});

test('a public mod on a private game is not built anywhere', async ({ request }) => {
  for (const url of ['/games/canary-private-game', '/games/canary-private-game/mods/orphan-canary-mod', '/mods/orphan-canary-mod']) {
    expect((await request.get(url, { maxRedirects: 0 })).status(), url).toBe(404);
  }
  const redirects = await (await request.get('/_redirects')).text();
  expect(redirects).not.toMatch(/canary/);
});

test('/legal and the footer carry the per-game trademark notice; /brand has the one logo, no concepts', async ({ page, request }) => {
  await page.goto('/legal');
  await expect(page.locator('.game-notices')).toContainText('Space Engineers is a trademark of Keen Software House');
  await expect(page.locator('.site-footer__legal')).toContainText('Keen Software House');
  await expect(page.locator('.site-footer__legal')).toContainText('Rioku Labs');
  await page.goto('/brand');
  await expect(page.locator('[data-concept], .concept--current')).toHaveCount(0);
  const logos = page.locator('.logos figure.lg');
  await expect(logos.locator('figcaption b')).toHaveText(['Full logo', 'Mark', 'One color', 'Small mark']);
  for (const img of await logos.locator('img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  }
  for (const a of await logos.locator('a[download]').all()) expect((await request.get((await a.getAttribute('href'))!)).status()).toBe(200);
  const all = page.locator('details.all-dl');
  await all.locator('summary').click();
  const n = Number((await all.locator('summary').textContent())!.match(/\d+/)![0]);
  await expect(all.locator('li a[download]')).toHaveCount(n);
  await expect(page.locator('.donts figure')).toHaveCount(4);
  // colours copy on click, and say so
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const sw = page.getByRole('button', { name: /Copy Signal blue/ });
  await expect(page.locator('[data-swatches] .sw')).toHaveCount(5);
  await sw.click();
  await expect(sw.locator('code')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#4FB8FF');
  await expect(sw.locator('code')).toHaveText('#4FB8FF', { timeout: 4000 });
  await expect(page.locator('[data-copy]')).not.toHaveCount(0);
  // the logo concept gallery is gone from the build
  expect(existsSync(new URL('../../dist/brand/concepts', import.meta.url))).toBe(false);
  expect((await request.get('/brand/concepts/')).status()).toBe(404);
});
