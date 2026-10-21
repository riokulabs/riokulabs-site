/** Short screen recording of the home hero ignition (for review; not committed). npx tsx scripts/record-hero.ts <outDir> */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const out = path.resolve(process.argv[2] ?? 'screens');
fs.mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/serve.ts', '4397'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: out, size }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4397/');
  await page.waitForTimeout(6500);
  const v = page.video();
  await ctx.close();
  const p = await v!.path();
  fs.renameSync(p, path.join(out, `hero-ignition-${name}.webm`));
}
await browser.close();
server.kill();
console.log('recorded to', out);
