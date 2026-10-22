import type { Page } from '@playwright/test';
import { expect, test } from './youtube-guard';
import AxeBuilder from '@axe-core/playwright';

// Block explorer on the mod page (components/BlockExplorer.astro + scripts/explorer.ts).
// Software WebGL so the explorer renders headless.
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
const DC = '/games/space-engineers-2/mods/data-center';
const ex = (page: Page) => page.locator('#explorer');
const LAZY = /\/_astro\/(explorer|OutputPass)\.[\w-]+\.js$|\.glb$/;
/** Scroll the explorer into view and wait for its first block to be on screen. */
const boot = async (page: Page) => {
  await ex(page).scrollIntoViewIfNeeded();
  // headless WebGL is SwiftShader (software): the explorer waits for the visitor to opt in
  const start = ex(page).locator('[data-start3d]');
  if (await start.isVisible().catch(() => false)) await start.click();
  await expect(ex(page).locator('canvas[data-canvas]')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  await expect(ex(page).locator('[data-msg]')).toBeHidden({ timeout: 60_000 });
};
const block = (page: Page, name: string) => ex(page).locator('[data-list]').getByRole('button', { name });

test('on a software renderer the explorer waits for "Show the 3D view" and loads nothing before it', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto(DC);
  await ex(page).scrollIntoViewIfNeeded();
  await expect(ex(page)).toHaveAttribute('data-gpu', 'software');
  const start = ex(page).getByRole('button', { name: 'Show the 3D view' });
  await expect(start).toBeVisible();
  await page.waitForTimeout(1500);
  expect(urls.filter((u) => LAZY.test(u))).toEqual([]);
  await expect(ex(page).locator('[data-spin]')).toHaveAttribute('aria-pressed', 'true');
  await start.click();
  await expect(ex(page).locator('canvas[data-canvas]')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  // no idle spin on a software renderer
  await expect(ex(page).locator('[data-spin]')).toHaveAttribute('aria-pressed', 'false');
});

test('explorer code and GLBs are not downloaded until it nears the viewport; then everything is self-hosted', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  // Start at the bottom of the page, far from the explorer: scroll before any page script runs.
  await page.addInitScript(() => document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') scrollTo(0, document.documentElement.scrollHeight); }));
  await page.goto(DC);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(2000);
  expect(urls.filter((u) => LAZY.test(u))).toEqual([]);
  await boot(page);
  expect(urls.some((u) => /\/_astro\/explorer\.[\w-]+\.js$/.test(u))).toBe(true);
  expect(urls.some((u) => /\/models\/data-center\/dc-rack42-splitfront\.[0-9a-f]{8}\.glb$/.test(u))).toBe(true);
  expect(urls.filter((u) => !u.startsWith('http://127.0.0.1') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
  // the "Under the hood" sheet is filled from the explorer's current block
  await expect(page.locator('[data-sheet-name]')).toHaveText('Server Rack (Split Front Doors)');
  await expect(page.locator('[data-sheet-rows]')).toContainText('42U');
});

test('block list: 73 blocks, family filter and search', async ({ page }) => {
  await page.goto(DC);
  const items = ex(page).locator('[data-list] li');
  await expect(items).toHaveCount(73);
  await expect(ex(page).locator('[data-fams] [data-f=all]')).toHaveAttribute('aria-pressed', 'true');
  await ex(page).locator('[data-fams] [data-f=server]').click();
  await expect(ex(page).locator('[data-fams] [data-f=server]')).toHaveAttribute('aria-pressed', 'true');
  await expect(ex(page).locator('[data-fams] [data-f=all]')).toHaveAttribute('aria-pressed', 'false');
  await expect(ex(page).locator('[data-list] li:not([hidden])')).toHaveCount(10);
  await expect(block(page, 'KVM Console 6U')).toBeVisible();
  await expect(block(page, 'Server Rack (Split Front Doors) 42U')).toBeHidden();
  await ex(page).locator('[data-fams] [data-f=all]').click();
  await ex(page).getByRole('searchbox', { name: 'Find a block' }).fill('cooler');
  await expect(ex(page).locator('[data-list] li:not([hidden])')).toHaveCount(1);
  await expect(block(page, 'In-Row Cooler (CRAC)')).toBeVisible();
  await ex(page).getByRole('searchbox', { name: 'Find a block' }).fill('no such block');
  await expect(ex(page).locator('[data-list] li:not([hidden])')).toHaveCount(0);
  await expect(ex(page).locator('[data-none]')).toBeVisible();
});

test('selecting a block, states (Building stage slider, Broken pull-apart), view and toggles', async ({ page }) => {
  await page.goto(DC);
  await boot(page);
  await expect(block(page, 'Server Rack (Split Front Doors) 42U')).toHaveAttribute('aria-pressed', 'true');
  await expect(ex(page).getByRole('button', { name: 'Open doors' })).toBeVisible();

  await block(page, 'KVM Console 6U').click();
  await expect(block(page, 'KVM Console 6U')).toHaveAttribute('aria-pressed', 'true');
  await expect(block(page, 'Server Rack (Split Front Doors) 42U')).toHaveAttribute('aria-pressed', 'false');
  await expect(ex(page).locator('[data-name]')).toHaveText('KVM Console');
  await expect(page).toHaveURL(/#dc-srv-kvm$/);
  await expect(ex(page).getByRole('button', { name: 'Open drawer' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-sheet-name]')).toHaveText('KVM Console');
  await ex(page).getByRole('button', { name: 'Open drawer' }).click();
  await expect(ex(page).getByRole('button', { name: 'Close drawer' })).toBeVisible();

  const state = ex(page).getByRole('group', { name: 'State' });
  const pull = ex(page).getByRole('slider', { name: /Pull apart/ });
  await expect(pull).toBeDisabled();
  await expect(ex(page).locator('[data-pullnote]')).toBeVisible();

  await state.getByRole('button', { name: 'Building' }).click();
  await expect(state.getByRole('button', { name: 'Building' })).toHaveAttribute('aria-pressed', 'true');
  const stage = ex(page).getByRole('slider', { name: /Construction stage/ });
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('max', '6');
  await expect(ex(page).locator('[data-anims]')).toBeHidden();
  await stage.fill('3');
  await expect(ex(page).locator('[data-stage-n]')).toHaveText('3');
  await expect(ex(page).locator('[data-rdmode]')).toHaveText(/stage 3/i, { timeout: 30_000 });
  await expect(pull).toBeDisabled();

  await state.getByRole('button', { name: 'Broken' }).click();
  await expect(state.getByRole('button', { name: 'Broken' })).toHaveAttribute('aria-pressed', 'true');
  await expect(state.getByRole('button', { name: 'Building' })).toHaveAttribute('aria-pressed', 'false');
  await expect(stage).toBeHidden();
  await expect(pull).toBeEnabled({ timeout: 30_000 });
  await expect(ex(page).locator('[data-pullnote]')).toBeHidden();
  await expect.poll(async () => Number(await pull.inputValue()), { timeout: 10_000 }).toBeGreaterThanOrEqual(35); // it opens up on its own
  await pull.fill('80');
  await expect(ex(page).locator('[data-pull-n]')).toHaveText('80%');

  await state.getByRole('button', { name: 'Intact' }).click();
  await expect(pull).toBeDisabled();
  await expect(pull).toHaveValue('0');

  const view = ex(page).getByRole('group', { name: 'View' });
  await view.getByRole('button', { name: 'Wireframe' }).click();
  await expect(view.getByRole('button', { name: 'Wireframe' })).toHaveAttribute('aria-pressed', 'true');
  await expect(view.getByRole('button', { name: 'Shaded' })).toHaveAttribute('aria-pressed', 'false');
  await expect(ex(page).locator('[data-rdmode]')).toHaveText(/Wireframe/i, { timeout: 10_000 });

  for (const name of ['Power', 'Turntable']) {
    const b = ex(page).getByRole('button', { name, exact: true });
    const before = await b.getAttribute('aria-pressed');
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  }
});

test('paint: 12 swatches with one pressed; a custom colour clears them; painting returns to Shaded', async ({ page }) => {
  await page.goto(DC);
  await boot(page);
  const paint = ex(page).getByRole('group', { name: 'Paint' });
  const swatches = paint.getByRole('button');
  await expect(swatches).toHaveCount(12);
  await expect(paint.locator('[aria-pressed=true]')).toHaveCount(1);
  await ex(page).getByRole('group', { name: 'View' }).getByRole('button', { name: 'Wireframe' }).click();
  await paint.getByRole('button', { name: 'Orange' }).click();
  await expect(paint.getByRole('button', { name: 'Orange' })).toHaveAttribute('aria-pressed', 'true');
  await expect(paint.locator('[aria-pressed=true]')).toHaveCount(1);
  await expect(ex(page).getByRole('group', { name: 'View' }).getByRole('button', { name: 'Shaded' })).toHaveAttribute('aria-pressed', 'true');
  await ex(page).locator('input[type=color][data-custom]').fill('#00ff88');
  await expect(paint.locator('[aria-pressed=true]')).toHaveCount(0);
});

test('no WebGL: a message instead of a blank box, no 3D downloads, and the block list still works', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test override
    HTMLCanvasElement.prototype.getContext = function (type: string, ...a: unknown[]) { return /webgl/.test(type) ? null : orig.call(this, type, ...a); };
  });
  await page.goto(DC);
  await ex(page).scrollIntoViewIfNeeded();
  await expect(ex(page).locator('[data-msg]')).toBeVisible();
  await expect(ex(page).locator('[data-msg]')).toContainText('can’t show 3D');
  await page.waitForTimeout(500);
  expect(urls.filter((u) => LAZY.test(u))).toEqual([]);
  await ex(page).locator('[data-fams] [data-f=rack]').click();
  await expect(ex(page).locator('[data-list] li:not([hidden])')).toHaveCount(6);
});

test('loaded explorer has no axe violations and its controls are keyboard reachable', async ({ page }) => {
  await page.goto(DC);
  await boot(page);
  const r = await new AxeBuilder({ page }).include('#explorer').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);

  // Narrow the list to the 6 racks, then Tab through the whole explorer and record what takes focus.
  await ex(page).locator('[data-fams] [data-f=rack]').click();
  await ex(page).getByRole('searchbox', { name: 'Find a block' }).focus();
  const seen: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || !a.closest('#explorer')) return null;
      return a.dataset.f ? `fam:${a.dataset.f}` : a.dataset.slug ? 'block' : a.dataset.s ? `state:${a.dataset.s}` : a.dataset.m ? `view:${a.dataset.m}`
        : a.dataset.h ? 'swatch' : a.matches('[data-canvas]') ? 'canvas' : a.matches('[data-power]') ? 'power' : a.matches('[data-spin]') ? 'spin'
        : a.matches('[data-custom]') ? 'custom' : a.matches('[data-o]') ? 'anim' : a.tagName.toLowerCase();
    });
    if (d === null) break;
    seen.push(d);
  }
  for (const want of ['fam:rack', 'block', 'canvas', 'state:intact', 'state:fracture', 'view:shaded', 'view:wire', 'power', 'spin', 'anim', 'swatch', 'custom']) expect(seen, want).toContain(want);
  expect(seen).not.toContain('input'); // the pull-apart slider is disabled (not in the tab order) until Broken
  // the type toolbar and the block list are one tab stop each (roving tabindex), so Tab doesn't walk 73 blocks
  expect(seen.filter((s) => s.startsWith('fam:'))).toEqual(['fam:rack']);
  expect(seen.filter((s) => s === 'block')).toHaveLength(1);
  expect(seen.indexOf('block')).toBe(seen.indexOf('fam:rack') + 1);

  // keyboard orbit on the canvas stops the idle turntable
  // (software rendering starts with the turntable off: switch it on first)
  if ((await ex(page).locator('[data-spin]').getAttribute('aria-pressed')) !== 'true') await ex(page).locator('[data-spin]').click();
  await expect(ex(page).locator('[data-spin]')).toHaveAttribute('aria-pressed', 'true');
  await ex(page).locator('[data-canvas]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(ex(page).locator('[data-spin]')).toHaveAttribute('aria-pressed', 'false');
  // block buttons work from the keyboard
  await ex(page).locator('[data-list] li:not([hidden]) button').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(ex(page).locator('[data-list] li:not([hidden]) button').nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test('block picker keyboard: roving tab stops, arrows/Home/End, Enter selects, and a skip link past the explorer', async ({ page }) => {
  await page.goto(DC);
  const list = ex(page).locator('[data-list]');
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.slug ?? (document.activeElement as HTMLElement | null)?.dataset.f ?? document.activeElement?.id ?? '');
  // only the selected block and the pressed type are in the tab order
  await expect(list.locator('button[tabindex="0"], button:not([tabindex])')).toHaveCount(1);
  await expect(list.locator('button[tabindex="0"], button:not([tabindex])')).toHaveAttribute('aria-pressed', 'true');
  await expect(ex(page).locator('[data-fams] button[tabindex="0"], [data-fams] button:not([tabindex])')).toHaveCount(1);
  await expect(ex(page).getByRole('toolbar', { name: 'Block type' })).toBeVisible();

  // types: arrows move focus, Enter presses
  await ex(page).locator('[data-fams] [data-f=all]').focus();
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe('rack');
  await page.keyboard.press('End');
  expect(await focused()).toBe('room');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe('server');
  await page.keyboard.press('Enter');
  await expect(ex(page).locator('[data-fams] [data-f=server]')).toHaveAttribute('aria-pressed', 'true');
  await expect(ex(page).locator('[data-list] li:not([hidden])')).toHaveCount(10);

  // Tab goes from the toolbar straight into the (filtered) list, at its first shown block
  await page.keyboard.press('Tab');
  const firstServer = await list.locator('li:not([hidden]) button').first().getAttribute('data-slug');
  expect(await focused()).toBe(firstServer);
  await page.keyboard.press('ArrowDown');
  const second = await list.locator('li:not([hidden]) button').nth(1).getAttribute('data-slug');
  expect(await focused()).toBe(second);
  await page.keyboard.press('End');
  expect(await focused()).toBe(await list.locator('li:not([hidden]) button').last().getAttribute('data-slug'));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe(second);
  await page.keyboard.press('Enter');
  await expect(list.locator(`[data-slug="${second}"]`)).toHaveAttribute('aria-pressed', 'true');
  // leaving and coming back lands on the same block
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  expect(await focused()).toBe(second);

  // the skip link comes right before the explorer and jumps past it
  await page.goto(DC);
  const skip = page.getByRole('link', { name: 'Skip past the 3D explorer' });
  await skip.focus();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await focused()).toBe('explorer-after');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#explorer'))).toBe(false);
});

test('narrow screens: the block picker sits above the viewer as a scrolling chip row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(DC);
  await ex(page).scrollIntoViewIfNeeded();
  const picker = await ex(page).locator('.ex__browser').boundingBox();
  const stage = await ex(page).locator('.ex__stage').boundingBox();
  const panel = await ex(page).locator('.ex__panel').boundingBox();
  expect(picker!.y + picker!.height).toBeLessThanOrEqual(stage!.y + 1);
  expect(stage!.y + stage!.height).toBeLessThanOrEqual(panel!.y + 1);
  const list = ex(page).locator('[data-list]');
  expect(await list.evaluate((l) => getComputedStyle(l).flexDirection)).toBe('row');
  expect(await list.evaluate((l) => l.scrollWidth > l.clientWidth)).toBe(true); // swipe sideways, no nested vertical box
  expect(await list.evaluate((l) => l.scrollHeight <= l.clientHeight + 1)).toBe(true);
  for (const b of await ex(page).locator('[data-fams] button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  // no horizontal page scroll
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('needs-review models never get a viewer (unlisted bench fixture)', async ({ page }) => {
  await page.goto('/blog/section-test-bench');
  await expect(page.locator('.post__body .viewer')).toHaveCount(1);
  await expect(page.locator('.post__body [data-load]')).toHaveCount(0);
});
