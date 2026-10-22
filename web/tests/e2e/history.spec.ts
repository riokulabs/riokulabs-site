import { expect, test } from './youtube-guard';

test('roadmap: now panel, one ordered rail per mod plus the studio track, idea teasers, no private item', async ({ page }) => {
  await page.goto('/roadmap');
  await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();
  const now = page.locator('aside.nowpanel');
  await expect(now).toContainText('On the bench right now');
  await expect(now.locator('li')).not.toHaveCount(0);
  await expect(page.locator('section.trk h2')).toHaveText(['Data Center', 'Beyond one mod']);
  await expect(page.locator('#rm-data-center a')).toHaveAttribute('href', '/games/space-engineers-2/mods/data-center');
  const order = ['done', 'now', 'next', 'later'];
  for (const rail of await page.locator('ol.rail').all()) {
    const phases = await rail.locator('li.n').evaluateAll((ls) => ls.map((l) => /n--(done|now|next|later)/.exec(l.className)![1]));
    expect(phases.length).toBeGreaterThan(0);
    expect(phases).toEqual([...phases].sort((a, b) => order.indexOf(a) - order.indexOf(b))); // Done → Now → Next → Later
    for (const h of await rail.locator('li.n h3').allTextContents()) expect(h.trim()).not.toMatch(/^\??$/); // no empty or "?" cards
    expect(await rail.getAttribute('aria-label')).toMatch(/roadmap$/);
  }
  // the Data Center rail runs through every phase
  const dc = page.getByRole('list', { name: 'Data Center roadmap' });
  for (const p of order) await expect(dc.locator(`li.n--${p}`)).not.toHaveCount(0);
  // rails light up when they scroll into view
  for (const rail of await page.locator('ol.rail').all()) {
    await rail.scrollIntoViewIfNeeded();
    await expect(rail).toHaveClass(/is-lit/);
  }
  // ideas only appear as teaser bands: a name and a line, no link
  const teasers = page.locator('section.tease');
  await expect(teasers).toHaveCount(5);
  await expect(teasers.locator('a')).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toMatch(/canary/i);
});

test('roadmap arrow buttons page the rail sideways and disable at the ends', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/roadmap');
  const wrap = page.locator('[data-rail-wrap="data-center"]');
  const [back, fwd] = await page.locator('[data-rail-nav="data-center"] button').all();
  await expect(back).toHaveAccessibleName('Scroll Data Center roadmap back');
  // a rail that fits has no arrows at all
  for (const w of await page.locator('[data-rail-wrap]').all()) {
    const id = await w.getAttribute('data-rail-wrap');
    const fits = await w.evaluate((el) => el.scrollWidth <= el.clientWidth + 4);
    if (fits) await expect(page.locator(`[data-rail-nav="${id}"]`)).toBeHidden();
    else await expect(page.locator(`[data-rail-nav="${id}"]`)).toBeVisible();
  }
  const overflow = await wrap.evaluate((w) => w.scrollWidth > w.clientWidth + 4);
  test.skip(!overflow, 'rail fits the viewport');
  await expect(back).toBeDisabled();
  await expect(fwd).toBeEnabled();
  await fwd.click();
  await expect.poll(() => wrap.evaluate((w) => w.scrollLeft)).toBeGreaterThan(0);
  await expect(back).toBeEnabled();
  await back.click();
  await expect.poll(() => wrap.evaluate((w) => w.scrollLeft)).toBeLessThan(4);
  await expect(back).toBeDisabled();
});

test('old /history URL redirects to the roadmap', async ({ request }) => {
  const r = await request.get('/history', { maxRedirects: 0 });
  expect(r.status()).toBe(301);
  expect(r.headers()['location']).toMatch(/\/roadmap$/);
});

test('history: six public families, no private family', async ({ page }) => {
  await page.goto('/games/space-engineers-2/mods/data-center/history');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText([/42U rack/, /Servers/, /Cable trays/, /Room shell/, /Room equipment/, /Hero hall/]);
  await expect(page.locator('[data-family]')).toHaveCount(6);
  const html = await page.content();
  expect(html).not.toMatch(/zz[ _-]?private[ _-]?canary/i);
});

test('history: tabs, scrubber and compare are keyboard operable', async ({ page }) => {
  await page.goto('/games/space-engineers-2/mods/data-center/history');
  const tab1 = page.getByRole('tab', { name: /42U rack/ });
  await tab1.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Servers/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Servers/ })).toBeFocused();
  const servers = page.locator('[data-family=servers]');
  await expect(servers).toBeVisible();
  await expect(page.locator('[data-family=rack42]')).toBeHidden();
  const thumb1 = servers.locator('[data-goto="1"]');
  await thumb1.focus();
  await page.keyboard.press('ArrowRight');
  await expect(servers.locator('.hv__stage.is-current')).toHaveAttribute('data-stage', '2');
  await expect(servers.locator('[data-goto="2"]')).toBeFocused();
  const cmp = servers.getByRole('button', { name: 'Compare with previous' });
  await cmp.focus();
  await page.keyboard.press('Enter');
  await expect(cmp).toHaveAttribute('aria-pressed', 'true');
  const range = servers.locator('.hv__cmp input[type=range]');
  await range.focus();
  await page.keyboard.press('ArrowLeft');
  expect(Number(await range.inputValue())).toBeLessThan(50);
});

test('history deep link selects family and stage', async ({ page }) => {
  await page.goto('/games/space-engineers-2/mods/data-center/history?family=trays&stage=4#trays');
  await expect(page.getByRole('tab', { name: /Cable trays/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-family=trays] .hv__stage.is-current')).toHaveAttribute('data-stage', '4');
});

test.describe('history without JS', () => {
  test.use({ javaScriptEnabled: false });
  test('all stages render as a vertical list of captioned figures', async ({ page }) => {
    await page.goto('/games/space-engineers-2/mods/data-center/history');
    await expect(page.locator('.hv__stage')).toHaveCount(58);
    await expect(page.locator('.hv__stage figcaption .hv__label').first()).toBeVisible();
  });
});

test('compare slider (post) is keyboard operable', async ({ page }) => {
  await page.goto('/blog/how-the-data-center-was-made');
  const range = page.locator('[data-compare] input[type=range]').first();
  await range.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await range.inputValue()).toBe('52');
  await expect(page.locator('[data-compare]').first()).toHaveAttribute('style', /--pos: 52%/);
});
