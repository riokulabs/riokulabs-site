/**
 * Review media for the 3D viewer (not committed; preview policy): screenshots of each block (rest and animated
 * poses, desktop + mobile) and a short screen recording of the viewer in use.
 *   npx tsx scripts/viewer-media.ts <outDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';

const out = path.resolve(process.argv[2] ?? 'viewer-media');
fs.mkdirSync(out, { recursive: true });
const PORT = 4395;
const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/serve.ts', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sel = 'section[aria-labelledby=viewer]';
const loaded = (p: Page) => p.waitForFunction(() => document.querySelector('[data-status]')?.textContent?.includes('loaded'), null, { timeout: 90_000 });
const mvEval = (p: Page, f: string) => p.evaluate(`(async () => { const el = document.querySelector('${sel} model-viewer'); ${f} })()`);

/** The section at the full page width (so the page gutters show), not cropped to the section's own box. */
async function shotWide(p: Page, file: string) {
  const box = await p.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { y: r.top + scrollY, h: r.height }; });
  const w = await p.evaluate(() => document.documentElement.clientWidth);
  await p.screenshot({ path: file, fullPage: true, clip: { x: 0, y: Math.max(0, box.y - 24), width: w, height: box.h + 48 } });
}

async function shots(name: string, viewport: { width: number; height: number }, isMobile: boolean) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile, colorScheme: 'dark', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/games/space-engineers-2/mods/data-center`);
  await p.addStyleTag({ content: '.site-header{position:static!important}' });
  const s = p.locator(sel);
  await s.scrollIntoViewIfNeeded();
  await shotWide(p, path.join(out, `viewer-poster-${name}.png`));
  await s.locator('[data-load]').click();
  await loaded(p);
  await p.waitForTimeout(1200);
  await shotWide(p, path.join(out, `viewer-rack-${name}.png`));
  if (!isMobile) {
    await s.getByRole('button', { name: 'Open doors' }).click();
    await p.waitForTimeout(800);
    await s.getByRole('radio', { name: 'Paint: Blue' }).click();
    await p.waitForTimeout(800);
    await shotWide(p, path.join(out, `viewer-rack-open-blue-${name}.png`));
    for (const [label, file, clip] of [['KVM console server', 'kvm', 'Open drawer'], ['In-row cooler (CRAC)', 'crac', 'Switch on'], ['Cable tray, long straight, full', 'tray', '']] as const) {
      await s.getByRole('radio', { name: label }).click();
      await loaded(p);
      await p.waitForTimeout(1000);
      await shotWide(p, path.join(out, `viewer-${file}-${name}.png`));
      if (clip) {
        await s.getByRole('button', { name: clip }).click();
        await p.waitForTimeout(800);
        await shotWide(p, path.join(out, `viewer-${file}-animated-${name}.png`));
      }
    }
  }
  await ctx.close();
}

async function recording() {
  const size = { width: 1280, height: 800 };
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: out, size }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/games/space-engineers-2/mods/data-center`);
  await p.addStyleTag({ content: '.site-header{position:static!important}' });
  const s = p.locator(sel);
  await s.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, 120));
  await p.waitForTimeout(800);
  await s.locator('[data-load]').click();
  await loaded(p);
  await p.waitForTimeout(2500);                       // auto-rotate
  const box = await s.locator('model-viewer').boundingBox();
  if (box) {                                          // orbit by drag
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    for (let i = 0; i < 20; i++) { await p.mouse.move(box.x + box.width / 2 - i * 12, box.y + box.height / 2 + i * 2); await p.waitForTimeout(30); }
    await p.mouse.up();
  }
  await s.getByRole('button', { name: 'Open doors' }).click();
  await p.waitForTimeout(1800);
  for (const c of ['Orange', 'Black', 'Keen grey']) { await s.getByRole('radio', { name: `Paint: ${c}` }).click(); await p.waitForTimeout(700); }
  await s.getByRole('button', { name: 'Close doors' }).click();
  await p.waitForTimeout(1500);
  await s.getByRole('radio', { name: 'KVM console server' }).click();
  await loaded(p);
  await p.waitForTimeout(800);
  await s.getByRole('button', { name: 'Open drawer' }).click();
  await p.waitForTimeout(2800);
  await s.getByRole('radio', { name: 'In-row cooler (CRAC)' }).click();
  await loaded(p);
  await p.waitForTimeout(800);
  await s.getByRole('button', { name: 'Switch on' }).click();
  await p.waitForTimeout(4000);
  const v = p.video();
  await ctx.close();
  fs.renameSync(await v!.path(), path.join(out, 'viewer-demo.webm'));
}

try {
  await shots('desktop', { width: 1440, height: 1000 }, false);
  await shots('mobile', { width: 390, height: 844 }, true);
  await recording();
} finally {
  await browser.close();
  server.kill();
}
console.log('viewer media in', out);
