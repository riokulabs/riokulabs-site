import { expect, test } from '@playwright/test';

test('keyboard: skip link, header, hero CTAs, footer', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.bar__home')).toBeFocused();
  for (const name of ['Home', 'Mods', 'Roadmap', 'Dev log', 'About']) {
    await page.keyboard.press('Tab');
    await expect(page.locator('header nav').getByRole('link', { name, exact: true })).toBeFocused();
  }
  // hero CTAs (the later scroll beats are hidden and out of the tab order until they show)
  await page.keyboard.press('Tab');
  await expect(page.locator('#hall .beat--1').getByRole('link', { name: 'Browse our mods' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#hall .beat--1').getByRole('link', { name: 'See the roadmap' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#mods').getByRole('link').first()).toBeFocused();
  // footer: the motion toggle is reachable and operable by keyboard
  await page.getByRole('button', { name: 'Reduce motion' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.keyboard.press('Tab');
  await expect(page.locator('footer').getByRole('link').first()).toBeFocused();
});

test('skip link moves focus to main', async ({ page }) => {
  await page.goto('/mods');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});
