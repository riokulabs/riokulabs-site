import { expect, test, type Page } from '@playwright/test';
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
  for (const want of ['fam:all', 'fam:rack', 'block', 'canvas', 'state:intact', 'state:fracture', 'view:shaded', 'view:wire', 'power', 'spin', 'anim', 'swatch', 'custom']) expect(seen, want).toContain(want);
  expect(seen).not.toContain('input'); // the pull-apart slider is disabled (not in the tab order) until Broken

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

test('needs-review models never get a viewer (unlisted bench fixture)', async ({ page }) => {
  await page.goto('/blog/section-test-bench');
  await expect(page.locator('.post__body .viewer')).toHaveCount(1);
  await expect(page.locator('.post__body [data-load]')).toHaveCount(0);
});
