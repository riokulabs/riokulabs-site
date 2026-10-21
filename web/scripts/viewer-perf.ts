/** Viewer cost after "Load 3D model" (Lighthouse can't click): transferred bytes of the runtime and GLB, time to
 *  the model's load event, and frame-time while auto-rotating. Software GL headless, so frame times are pessimistic.
 *    npx tsx scripts/viewer-perf.ts   → reports/viewer-perf.json */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 4394;
const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/serve.ts', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1350, height: 940 } });
await page.goto(`http://127.0.0.1:${PORT}/games/space-engineers-2/mods/data-center`);
const sec = page.locator('section[aria-labelledby=viewer]');
await sec.scrollIntoViewIfNeeded();
const t0 = await page.evaluate(() => performance.now());
await sec.locator('[data-load]').click();
await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent?.includes('loaded'), null, { timeout: 90_000 });
const t1 = await page.evaluate(() => performance.now());
const res = await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
  .filter((r) => /vendor|\.glb/.test(r.name)).map((r) => ({ url: r.name.replace(/^https?:\/\/[^/]+/, ''), transferKB: Math.round(r.transferSize / 1024), decodedKB: Math.round(r.decodedBodySize / 1024) })));
// (a string, so tsx's helper injection doesn't leak into the page)
const frames: number[] = await page.evaluate(`new Promise((resolve) => { const ts = []; const f = (t) => { ts.push(t); if (ts.length < 120) requestAnimationFrame(f); else resolve(ts); }; requestAnimationFrame(f); })`);
const dts = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
const report = {
  measuredAt: new Date().toISOString(), note: 'headless Chrome, SwiftShader software GL (pessimistic frame times), local br-compressed server',
  msToModelLoaded: Math.round(t1 - t0), resources: res,
  runtimeTransferKB: res.filter((r) => /vendor/.test(r.url)).reduce((n, r) => n + r.transferKB, 0),
  glbTransferKB: res.filter((r) => /\.glb/.test(r.url)).reduce((n, r) => n + r.transferKB, 0),
  frameMsMedian: +dts[Math.floor(dts.length / 2)].toFixed(1), frameMsP95: +dts[Math.floor(dts.length * 0.95)].toFixed(1),
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/viewer-perf.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
server.kill();
