import { expect, test, type Page } from '@playwright/test';

// The home hall only starts on hardware WebGL (a software rasteriser keeps the poster); headless runs usually have
// software GL only, so every hall check is guarded by the same test the page uses.
const hasWebGL = (page: Page) => page.evaluate(() => {
  try {
    const c = document.createElement('canvas'), o = { failIfMajorPerformanceCaveat: true };
    const gl = (c.getContext('webgl2', o) || c.getContext('webgl', o)) as WebGLRenderingContext | null;
    if (!gl) return false;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return !/swiftshader|llvmpipe|softpipe|software/i.test(String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
  } catch { return false; }
});

test.describe('reduced motion (prefers-reduced-motion: reduce)', () => {
  test.use({ reducedMotion: 'reduce' });
  for (const url of ['/', '/games/space-engineers-2/mods/data-center', '/blog/section-test-bench']) {
    test(`${url}: nothing moves and no video plays`, async ({ page }) => {
      const media: string[] = [];
      page.on('request', (r) => { if (/\.(mp4|webm)(\?|$)/.test(r.url())) media.push(r.url()); });
      await page.goto(url);
      await page.waitForLoadState('load');
      if (url === '/' && (await hasWebGL(page))) await expect(page.locator('#hall')).toHaveClass(/is-live/, { timeout: 30_000 });
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(1500);
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a as any).animationName ?? a.constructor.name));
      expect(running).toEqual([]);
      const videos = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => v.paused));
      expect(videos.every(Boolean)).toBe(true);
      expect(media).toEqual([]); // loop videos are never even requested
      if (url === '/') {
        // one still screen: not pinned, no scroll walk, only the first beat
        const hall = page.locator('#hall');
        expect(await hall.evaluate((h: HTMLElement) => h.offsetHeight)).toBeLessThanOrEqual(await page.evaluate(() => innerHeight * 1.2));
        await expect(page.locator('#hall .beat--1 h1')).toBeVisible();
        await expect(page.locator('#hall .beat--2, #hall .beat--3')).toHaveCount(2);
        for (const b of await page.locator('#hall .beat--2, #hall .beat--3').all()) await expect(b).toBeHidden();
        await expect(page.locator('[data-hall-hint]')).toBeHidden();
        expect(await page.locator('[data-hall-meter]').evaluate((m: HTMLElement) => m.style.transform)).toMatch(/^(scaleX\(0\))?$/); // the walk never advances
        if (await hall.evaluate((h) => h.classList.contains('is-live'))) {
          await expect(page.locator('[data-hall-state]')).toHaveText('Online'); // the finished aisle, no build-up
          await page.evaluate(() => scrollTo(0, 0));
          const clip = (await page.locator('#hall canvas').boundingBox())!;
          const a = await page.screenshot({ clip });
          await page.waitForTimeout(700);
          const b = await page.screenshot({ clip });
          expect(Buffer.compare(a, b)).toBe(0); // static frame
        }
      }
    });
  }
});

test('the footer toggle reduces motion without the OS setting and is remembered', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Reduce motion' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/mods');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.waitForTimeout(400);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(running).toBe(0);
});

test('with motion allowed, scroll walks the hero hall through its beats; the 3D aisle builds where WebGL exists', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await page.waitForLoadState('load');
  const hall = page.locator('#hall');
  const beat = (n: number) => page.locator(`#hall .beat--${n}`);
  // pinned: the hall is several screens tall and the first beat shows
  expect(await hall.evaluate((h: HTMLElement) => h.offsetHeight)).toBeGreaterThan(await page.evaluate(() => innerHeight * 2));
  await expect(beat(1)).toHaveAttribute('aria-hidden', 'false');
  await expect(beat(2)).toBeHidden();
  if (await hasWebGL(page)) {
    await expect(hall).toHaveClass(/is-live/, { timeout: 30_000 });
    await expect(page.locator('[data-hall-state]')).toHaveText(/Drafting|Welding|Online/);
    await expect(page.locator('[data-hall-state]')).toHaveText('Online', { timeout: 30_000 }); // blueprint → weld → online
  } else {
    // no hardware WebGL: the poster stays, the 3D code and models are never fetched
    await page.waitForTimeout(1500);
    await expect(hall).not.toHaveClass(/is-live/);
    await expect(page.locator('#hall .hall__poster img')).toBeVisible();
    await expect(page.locator('[data-hall-state]')).toHaveText('Standby');
    expect(requests.filter((u) => /\/_astro\/hall\.|\.glb$/.test(u))).toEqual([]);
  }
  // scroll to the middle of the walk: beat 1 fades out of the tab order, beat 2 shows, the meter fills
  await page.evaluate(() => { const h = document.getElementById('hall')!; scrollTo(0, h.offsetTop + (h.offsetHeight - innerHeight) * 0.5); });
  await expect(beat(1)).toHaveAttribute('aria-hidden', 'true');
  await expect(beat(1).getByRole('link', { includeHidden: true }).first()).toHaveAttribute('tabindex', '-1');
  await expect(beat(2)).toBeVisible();
  await expect(beat(2)).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('[data-hall-meter]')).toHaveAttribute('style', /scaleX\(0\.[1-9]/);
  // and back to the top
  await page.evaluate(() => scrollTo(0, 0));
  await expect(beat(1)).toHaveAttribute('aria-hidden', 'false');
  await expect(beat(1).getByRole('link', { name: 'Browse our mods' })).toHaveAttribute('tabindex', '0');
  expect(errors).toEqual([]);
});

test('no script errors on any page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`); });
  for (const url of ['/', '/mods', '/games/space-engineers-2/mods/data-center', '/blog', '/blog/section-test-bench', '/roadmap', '/404']) {
    await page.goto(url);
    await page.waitForLoadState('load');
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(600);
  }
  expect(errors.filter((e) => !/404 \(Not Found\)/.test(e))).toEqual([]);
});
