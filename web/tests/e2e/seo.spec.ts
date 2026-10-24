import { expect, test } from './youtube-guard';
import type { Page } from '@playwright/test';

const DC = '/games/space-engineers-2/mods/data-center';
const ORIGIN = 'https://rioku.dev';

async function jsonLd(page: Page): Promise<any[]> {
  return (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
}

test('titles carry the game name', async ({ page }) => {
  const cases: [string, string][] = [
    ['/', 'Rioku Labs · Space Engineers 2 mods'],
    [DC, 'Data Center: a Space Engineers 2 mod · Rioku Labs'],
    ['/blog', 'Dev log: Space Engineers 2 modding · Rioku Labs'],
  ];
  for (const [url, title] of cases) {
    await page.goto(url);
    await expect(page).toHaveTitle(title);
    expect(title.length).toBeLessThanOrEqual(65);
  }
});

test('the home page Organization has a square PNG logo and only our own profiles in sameAs', async ({ page, request }) => {
  await page.goto('/');
  const org = (await jsonLd(page)).find((d) => d['@type'] === 'Organization');
  expect(org.logo).toBe(`${ORIGIN}/icon-512.png`);
  expect(org.sameAs).toEqual(['https://github.com/riokulabs']);
  const logo = await request.get('/icon-512.png');
  expect(logo.ok()).toBe(true);
  expect(logo.headers()['content-type']).toContain('image/png');
});

test('the home hero still has alt text from the CMS; decorative card thumbnails keep alt=""', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('.hall__poster img');
  await expect(hero).toHaveAttribute('alt', /cold aisle/i);
  await expect(page.locator('.hall__poster')).not.toHaveAttribute('aria-hidden', /.*/);
  const thumbs = page.locator('#mods .tile__shot img');
  expect(await thumbs.count()).toBeGreaterThan(0);
  for (const alt of await thumbs.evaluateAll((els) => els.map((e) => e.getAttribute('alt')))) expect(alt).toBe('');
});

for (const [url, name, first] of [
  ['/blog', 'Dev log', '/blog/'],
  ['/mods', 'Mods', '/games/space-engineers-2/mods/'],
  ['/games', 'Games', '/games/'],
] as const) {
  test(`${url} has CollectionPage + ItemList JSON-LD of its entries`, async ({ page }) => {
    await page.goto(url);
    const cp = (await jsonLd(page)).find((d) => d['@type'] === 'CollectionPage');
    expect(cp).toBeTruthy();
    expect(cp.name).toBe(name);
    expect(cp.url).toBe(`${ORIGIN}${url}`);
    const list = cp.mainEntity;
    expect(list['@type']).toBe('ItemList');
    expect(list.itemListElement.length).toBeGreaterThan(0);
    expect(list.numberOfItems).toBe(list.itemListElement.length);
    list.itemListElement.forEach((it: any, i: number) => {
      expect(it).toMatchObject({ '@type': 'ListItem', position: i + 1 });
      expect(it.url.startsWith(`${ORIGIN}${first}`)).toBe(true);
    });
    const text = JSON.stringify(cp);
    expect(text).not.toMatch(/canary|spoiler-fixture|section-test-bench/i); // private and unlisted entries never listed
  });
}

test('the sitemap gives listed posts and mod pages a lastmod and never lists unlisted pages', async ({ request }) => {
  const xml = await (await request.get('/sitemap-0.xml')).text();
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: /<loc>([^<]+)<\/loc>/.exec(m[1])![1],
    lastmod: /<lastmod>([^<]+)<\/lastmod>/.exec(m[1])?.[1],
  }));
  const at = (p: string) => entries.find((e) => e.loc === `${ORIGIN}${p}`);
  expect(at('/blog/how-the-data-center-was-made')?.lastmod).toMatch(/^2026-10-\d\dT/);
  expect(at(DC)?.lastmod).toMatch(/^\d{4}-\d\d-\d\dT/);
  for (const e of entries.filter((x) => /\/blog\/[^/]+$/.test(x.loc) && !x.loc.includes('/tag/'))) expect(e.lastmod, e.loc).toBeTruthy();
  expect(xml).not.toMatch(/spoiler-fixture|section-test-bench|canary/i);
});
