/**
 * Lighthouse (mobile, default simulated throttling ≈ Moto G Power on slow 4G) against the built site served by
 * scripts/serve.ts. Writes JSON + a summary to reports/lighthouse/ (gitignored). With --ci, asserts SPEC §6:
 * perf ≥ 95, a11y 100, best practices 100, SEO 100, LCP ≤ 2.0 s (≤ 2.5 s mod detail and history), CLS ≤ 0.05.
 *   npm run lighthouse [-- --ci] [-- --desktop]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const PAGES = ['/', '/games', '/games/space-engineers-2', '/mods', '/games/space-engineers-2/mods/data-center', '/blog', '/blog/how-the-data-center-was-made', '/roadmap', '/about', '/brand'];
const CI = process.argv.includes('--ci');
const DESKTOP = process.argv.includes('--desktop');
const PORT = 4399;
const OUT = path.resolve('reports', 'lighthouse');
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/serve.ts', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
const rows: any[] = [];
let failed = 0;
try {
  for (const p of PAGES) {
    const result = await lighthouse(`http://127.0.0.1:${PORT}${p}`, {
      port: chrome.port, output: 'json', logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      ...(DESKTOP ? { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttlingMethod: 'simulate', throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 } } : {}),
    });
    const lhr = result!.lhr;
    const s = (k: string) => Math.round((lhr.categories[k].score ?? 0) * 100);
    const lcp = lhr.audits['largest-contentful-paint'].numericValue! / 1000;
    const cls = lhr.audits['cumulative-layout-shift'].numericValue!;
    const tbt = lhr.audits['total-blocking-time'].numericValue!;
    const bytes = lhr.audits['total-byte-weight'].numericValue! / 1024;
    const row = { page: p, perf: s('performance'), a11y: s('accessibility'), bp: s('best-practices'), seo: s('seo'), lcp: +lcp.toFixed(2), cls: +cls.toFixed(3), tbt: Math.round(tbt), kb: Math.round(bytes) };
    rows.push(row);
    const name = (p === '/' ? 'home' : p.slice(1).replace(/\//g, '_')) + (DESKTOP ? '-desktop' : '-mobile');
    fs.writeFileSync(path.join(OUT, `${name}.json`), result!.report as string);
    // SPEC §6: 2.0 s for home, mods index and posts; 2.5 s for mod detail (and the media-heavy history viewer,
    // which SPEC doesn't list: we hold it to the detail-page budget)
    const lcpBudget = p.includes('/mods/') || p === '/history' ? 2.5 : 2.0;
    const problems = [
      row.perf < 95 && `perf ${row.perf}`, row.a11y < 100 && `a11y ${row.a11y}`, row.bp < 100 && `best-practices ${row.bp}`, row.seo < 100 && `seo ${row.seo}`,
      row.lcp > lcpBudget && `LCP ${row.lcp}s > ${lcpBudget}s`, row.cls > 0.05 && `CLS ${row.cls}`,
    ].filter(Boolean);
    if (problems.length) {
      failed++;
      const failing = Object.values(lhr.audits).filter((a: any) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'manual').map((a: any) => `${a.id}(${a.score})`);
      console.log(`  ${p}: ${problems.join(', ')} | low audits: ${failing.slice(0, 12).join(' ')}`);
    }
  }
} finally {
  await chrome.kill();
  server.kill();
}
console.table(rows);
fs.writeFileSync(path.join(OUT, `summary${DESKTOP ? '-desktop' : '-mobile'}.json`), JSON.stringify(rows, null, 2));
if (CI && failed) process.exit(1);
