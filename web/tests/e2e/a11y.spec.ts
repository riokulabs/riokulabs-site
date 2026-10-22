import { expect, test } from './youtube-guard';
import AxeBuilder from '@axe-core/playwright';

const PAGES = ['/', '/games', '/games/space-engineers-2', '/mods', '/games/space-engineers-2/mods/data-center', '/blog', '/blog/how-the-data-center-was-made', '/blog/section-test-bench', '/roadmap', '/about', '/brand', '/legal', '/404'];

for (const url of PAGES) {
  test(`axe: ${url} has no WCAG 2.2 AA violations`, async ({ page }) => {
    test.setTimeout(90_000); // the home page builds a 3D hall and the mod page a block explorer while axe runs
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    // Reveal-on-view content (roadmap rails, .reveal) is checked as a reader sees it: scroll through, let it settle.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 100));
      await Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {})));
    });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target}`);
    expect(summary).toEqual([]);
  });
}

test('every page has one h1, a title, canonical and OG tags', async ({ page }) => {
  for (const url of PAGES.filter((u) => u !== '/404')) {
    await page.goto(url);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await page.title()).toMatch(/Rioku Labs/);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', new RegExp(`^https://rioku\\.dev${url === '/' ? '' : url}$`));
    for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) await expect(page.locator(`meta[property="${p}"]`)).toHaveCount(1);
  }
});
