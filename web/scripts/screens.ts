/**
 * Screenshots for review (not committed: the user's preview policy). Needs a running server (`npm run preview`).
 *   npx tsx scripts/screens.ts <outDir> [baseUrl] [--reduced]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const out = path.resolve(process.argv[2] ?? 'screens');
const base = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://127.0.0.1:4321').replace(/\/$/, '');
const reduced = process.argv.includes('--reduced');
const PAGES: [string, string][] = [
  ['home', '/'],
  ['mods-index', '/mods'],
  ['games-index', '/games'],
  ['game-space-engineers-2', '/games/space-engineers-2'],
  ['mod-data-center', '/games/space-engineers-2/mods/data-center'],
  ['blog-index', '/blog'],
  ['post-how-the-data-center-was-made', '/blog/how-the-data-center-was-made'],
  ['history', '/history'],
  ['brand', '/brand'],
  ['about', '/about'],
];
const VIEWPORTS = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };

fs.mkdirSync(out, { recursive: true });
// System Chrome: Playwright's bundled Chromium has no H.264, so MP4 loops would render black.
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ ...vp, colorScheme: 'dark', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  for (const [name, url] of PAGES) {
    await page.goto(base + url, { waitUntil: 'networkidle' });
    // let the hero settle and lazy images load
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(2200);
    const file = path.join(out, `${name}-${vpName}${reduced ? '-reduced' : ''}.png`);
    if (vpName === 'mobile') {
      // Playwright's fullPage capture re-lays out mobile emulation wider than the device; grow the viewport instead.
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: vp.width, height: h });
      await page.waitForTimeout(400);
      await page.screenshot({ path: file });
      await page.setViewportSize({ width: vp.width, height: vp.height });
    } else await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await ctx.close();
}
await browser.close();
