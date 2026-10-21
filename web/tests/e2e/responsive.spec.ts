import { expect, test } from '@playwright/test';

for (const url of ['/', '/games', '/games/space-engineers-2', '/mods', '/games/space-engineers-2/mods/data-center', '/blog', '/blog/how-the-data-center-was-made', '/roadmap', '/about']) {
  test(`${url}: no horizontal page scroll on a phone`, async ({ page }) => {
    await page.goto(url);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  });
}

test('phone: the nav folds into a Menu button that opens, closes on Escape and on a link', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu' });
  const nav = page.locator('#site-nav');
  test.skip((page.viewportSize()?.width ?? 1280) >= 640, 'desktop shows the full nav');
  await expect(menu).toHaveAttribute('aria-controls', 'site-nav');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(nav).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Mods', 'Roadmap', 'Dev log', 'About']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(nav).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await nav.getByRole('link', { name: 'Mods' }).click();
  await expect(page).toHaveURL(/\/mods$/);
  await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#site-nav [aria-current=page]')).toHaveText('Mods');
});

test('desktop: the full nav shows and there is no Menu button', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 640, 'phones use the Menu button');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
  await expect(page.locator('#site-nav')).toBeVisible();
});
