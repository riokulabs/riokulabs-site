import { expect, test } from '@playwright/test';

const DC = '/games/space-engineers-2/mods/data-center';

test('Data Center: the first 8 stills render with captions; feature loops are lazy and have controls', async ({ page }) => {
  await page.goto(DC);
  const stills = page.locator('section[aria-labelledby=gallery] .gallery__item');
  await expect(stills).toHaveCount(8);
  for (const item of await stills.all()) {
    await expect(item.locator('.gallery__title')).not.toBeEmpty();
    await expect(item.locator('.gallery__text')).not.toBeEmpty();
  }
  await expect(page.locator('section[aria-labelledby=gallery] a[href$="/history"]')).toHaveText('How it was built');
  const loops = page.locator('section[aria-labelledby=features] figure.loop');
  await expect(loops).not.toHaveCount(0);
  for (const l of await loops.all()) {
    await expect(l.locator('video source[type="video/mp4"]')).toHaveCount(1);
    await expect(l.locator('video')).toHaveAttribute('preload', 'none');
    await expect(l.getByRole('button', { name: /loop/i })).toBeVisible();
  }
  await expect(page.locator('img[src$=".gif"], source[srcset*=".gif"]')).toHaveCount(0);
});

test('mods browser: status and game filters, live count, empty state', async ({ page }) => {
  await page.goto('/mods');
  const tiles = page.locator('[data-grid] > .tile');
  const shown = page.locator('[data-grid] > .tile:not([hidden])');
  await expect(tiles).toHaveCount(6); // Data Center + 5 public ideas; nothing private, unlisted or on a private game
  await expect(page.locator(`[data-grid] a.tile[href="${DC}"]`)).toHaveCount(1);
  await expect(page.locator('[data-grid] a.tile')).toHaveCount(1); // ideas are teasers, not links
  await expect(page.locator('a[href="/games/space-engineers-2/mods/fixture-test-bench"]')).toHaveCount(0);
  const status = page.getByRole('group', { name: 'Status' });
  const say = page.locator('[data-filter-status]');
  await expect(status.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  await status.getByRole('button', { name: /^In testing/ }).click();
  await expect(status.getByRole('button', { name: /^In testing/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(status.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(shown).toHaveCount(1);
  await expect(shown).toHaveAttribute('href', DC);
  await expect(say).toHaveText('1 mod shown');
  await expect(say).toHaveAttribute('aria-live', 'polite');
  await status.getByRole('button', { name: /^In the works/ }).click();
  await expect(shown).toHaveCount(5);
  await expect(say).toHaveText('5 mods shown');
  await status.getByRole('button', { name: /^Released/ }).click();
  await expect(shown).toHaveCount(0);
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-empty] a')).toHaveAttribute('href', '/roadmap');
  await status.getByRole('button', { name: /^All/ }).click();
  await expect(shown).toHaveCount(6);
  await expect(page.locator('[data-empty]')).toBeHidden();
  const game = page.getByRole('group', { name: 'Game' });
  await game.getByRole('button', { name: 'Space Engineers 2' }).click();
  await expect(game.getByRole('button', { name: 'Space Engineers 2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(game.getByRole('button', { name: 'All games' })).toHaveAttribute('aria-pressed', 'false');
  await expect(shown).toHaveCount(6);
});

test.describe('mods browser without JS', () => {
  test.use({ javaScriptEnabled: false });
  test('every tile is in the HTML and visible', async ({ page }) => {
    await page.goto('/mods');
    const tiles = page.locator('[data-grid] > .tile');
    await expect(tiles).toHaveCount(6);
    for (const t of await tiles.all()) await expect(t).toBeVisible();
    await expect(page.locator('[data-empty]')).toBeHidden();
  });
});

test('lightbox is keyboard operable and returns focus', async ({ page }) => {
  await page.goto(DC);
  const first = page.locator('section[aria-labelledby=gallery] .gallery__thumb').first();
  await first.focus();
  await page.keyboard.press('Enter');
  const dlg = page.locator('section[aria-labelledby=gallery] dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.lightbox__count')).toHaveText('1 / 8');
  await expect(dlg.locator('.lightbox__title')).toHaveText('Contained cold aisle');
  await page.keyboard.press('ArrowRight');
  await expect(dlg.locator('.lightbox__count')).toHaveText('2 / 8');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(dlg.locator('.lightbox__count')).toHaveText('8 / 8');
  // focus stays inside the modal
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(first).toBeFocused();
});

test('loop videos have a working pause/play control', async ({ page }) => {
  await page.goto(DC);
  const fig = page.locator('section[aria-labelledby=features] figure.loop').first();
  await fig.scrollIntoViewIfNeeded();
  const btn = fig.locator('[data-loop-toggle]');
  await expect(btn).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(await fig.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('unlisted test bench: built, noindex, changelog with anchors, not listed', async ({ page }) => {
  await page.goto('/games/space-engineers-2/mods/fixture-test-bench');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('#v1-0-0')).toBeVisible();
  await expect(page.locator('#v0-9-0-beta-1')).toBeVisible();
  await page.goto('/mods');
  await expect(page.locator('a[href="/games/space-engineers-2/mods/fixture-test-bench"]')).toHaveCount(0);
});
