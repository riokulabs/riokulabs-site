import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frameHits, scanDir } from '../../scripts/lint-dist';
import { loadPrivacyLists, loadPrivacyLocal, mergePrivacy } from '../../src/lib/privacy';

// Two sets: `pub` = the synthetic canaries from cms/config/privacy.json only (safe to print, even in public CI logs);
// `lists` = merged with the private lists when cms/config/privacy.local.json exists (used by the local-only suite).
const lists = loadPrivacyLists();
const pubEnv = process.env.PRIVACY_LOCAL_JSON; delete process.env.PRIVACY_LOCAL_JSON;
const pub = loadPrivacyLists(undefined, path.join(os.tmpdir(), 'no-such-privacy-local.json'));
if (pubEnv !== undefined) process.env.PRIVACY_LOCAL_JSON = pubEnv;
const local = loadPrivacyLocal() as { testSamples?: Record<string, string[]> } | null;
function tmpSite(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-dist-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

// These tests read the full hit text. They scan with `pub` (synthetic canaries only), so even verbose output under CI
// can only ever show the public canary terms; the CI-redaction test below switches verbose off again.
process.env.PRIVACY_VERBOSE = '1';

describe('dist privacy canary + IP lint', () => {
  it('passes a clean site', () => {
    expect(scanDir(tmpSite({ 'index.html': '<h1>Data Center</h1>', '_astro/a.js': 'console.log(1)' }), pub)).toEqual([]);
  });
  it('fails on a planted private term in HTML, JS and XML', () => {
    const hits = scanDir(tmpSite({ 'index.html': '<p>ZZ Private Canary</p>', '_astro/x.js': 'const s="zz_private_canary"', 'rss.xml': '<title>canary private mod</title>' }), pub);
    expect(hits.some((h) => h.startsWith('PRIVACY index.html'))).toBe(true);
    expect(hits.some((h) => h.startsWith('PRIVACY _astro/x.js'))).toBe(true);
    expect(hits.some((h) => h.startsWith('PRIVACY rss.xml'))).toBe(true);
  });
  it('fails on a planted file name', () => {
    expect(scanDir(tmpSite({ 'media/zz-private-canary-concept.jpg': 'binary' }), pub)[0]).toMatch(/file name media\/zz-private-canary-concept/);
  });
  it('fails on leftovers of a retired studio name (text, file names), but not on a near miss', () => {
    const hits = scanDir(tmpSite({ 'index.html': '<p>© ZZ Retired Brand</p>', 'feed.xml': '<link>https://zz-retired-brand.example/</link>', 'brand/zzrb-mark.svg': '<svg/>', 'x.js': 'title:"ZZRB"' }), pub);
    expect(hits.some((h) => h.startsWith('BRAND index.html:1'))).toBe(true);
    expect(hits.some((h) => h.startsWith('BRAND feed.xml'))).toBe(true);
    expect(hits.some((h) => h.startsWith('BRAND file name brand/zzrb-mark.svg'))).toBe(true);
    expect(hits.some((h) => h.startsWith('BRAND x.js'))).toBe(true);
    expect(scanDir(tmpSite({ 'index.html': '<p>The zzrbx blocks, by Rioku Labs</p>' }), pub)).toEqual([]);
  });
  it('fails on a planted IP term', () => {
    expect(scanDir(tmpSite({ 'about.html': '<p>like the zz-ip-canary</p>' }), pub)[0]).toMatch(/^IP about.html:1/);
  });
});

// Skipped under CI: a failure message would print a private term into the public Actions log.
describe.skipIf(!local || !!process.env.CI)('private lists (only with cms/config/privacy.local.json, not in CI)', () => {
  const s = local?.testSamples ?? {};
  it('catch every planted private, IP and retired sample in dist/, and pass the allowed ones', () => {
    for (const [kind, set] of [['PRIVACY', s.deny], ['IP', s.ip], ['BRAND', s.retired]] as const) {
      for (const t of set ?? []) expect(scanDir(tmpSite({ 'index.html': `<p>${t}</p>` }), lists).some((h) => h.startsWith(`${kind} index.html`)), t).toBe(true);
    }
    for (const t of s.allowed ?? []) expect(scanDir(tmpSite({ 'index.html': `<p>${t}</p>` }), lists), t).toEqual([]);
  });
});

describe('privacy config merge', () => {
  it('adds the private lists to the public canaries', () => {
    expect(mergePrivacy({ denyPatterns: ['a'], x: { y: [1] } }, { denyPatterns: ['b', 'a'], x: { z: 2 } })).toEqual({ denyPatterns: ['a', 'b'], x: { y: [1], z: 2 } });
  });
});

describe('GLB JSON chunk scan', () => {
  it('catches a deny term in a node name inside a .glb', () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, nodes: [{ name: 'ZZPrivateCanaryBay_door' }] }));
    const pad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
    const chunk = Buffer.concat([json, pad]);
    const head = Buffer.alloc(20);
    head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + chunk.length, 8);
    head.writeUInt32LE(chunk.length, 12); head.write('JSON', 16);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-glb-'));
    fs.mkdirSync(path.join(dir, 'models'));
    fs.writeFileSync(path.join(dir, 'models', 'x.glb'), Buffer.concat([head, chunk]));
    expect(scanDir(dir, pub)[0]).toMatch(/^PRIVACY models\/x.glb/);
  });
  it('catches the retired studio prefix in a material name inside a .glb', () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, materials: [{ name: 'ZZRB_Paint' }] }));
    const chunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const head = Buffer.alloc(20);
    head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + chunk.length, 8);
    head.writeUInt32LE(chunk.length, 12); head.write('JSON', 16);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-glb-'));
    fs.writeFileSync(path.join(dir, 'm.glb'), Buffer.concat([head, chunk]));
    expect(scanDir(dir, pub)[0]).toMatch(/^BRAND m.glb/);
  });
});

describe('public CI logs', () => {
  it('under CI a hit names kind, masked place and term index, never the term or its text', () => {
    const before = { ci: process.env.CI, v: process.env.PRIVACY_VERBOSE };
    process.env.CI = 'true'; delete process.env.PRIVACY_VERBOSE;
    try {
      const hits = scanDir(tmpSite({ 'media/zz-private-canary-concept.jpg': 'x', 'about.html': '<p>the zz-private-canary plan</p>' }), pub);
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) { expect(h).not.toMatch(/zz-private-canary|plan/); expect(h).toMatch(/^(PRIVACY|IP|BRAND) @[0-9a-f]{8} \(term #\d+\)$/); }
    } finally {
      if (before.ci === undefined) delete process.env.CI; else process.env.CI = before.ci;
      process.env.PRIVACY_VERBOSE = before.v ?? '1';
    }
  });
});

describe('dist iframe allowlist', () => {
  it('passes the youtube-nocookie player and pages without frames', () => {
    const ok = '<iframe src="https://www.youtube-nocookie.com/embed/Fx_embed-01?rel=0" title="x" loading="lazy"></iframe>';
    expect(frameHits(tmpSite({ 'index.html': '<h1>x</h1>', 'blog/a/index.html': ok, 'b.html': ok.replace('?rel=0', '?rel=0&amp;start=3') }))).toEqual([]);
  });
  it('flags any other frame source', () => {
    const bad = [
      '<iframe src="https://www.youtube.com/embed/Fx_embed-01"></iframe>',
      "<iframe src='https://evil.example/embed/Fx_embed-01'></iframe>",
      '<iframe src="https://www.youtube-nocookie.com/embed/Fx_embed-01/../x"></iframe>',
      '<iframe src=javascript:alert(1)></iframe>',
      '<IFRAME title="no src"></IFRAME>',
    ];
    const hits = frameHits(tmpSite(Object.fromEntries(bad.map((b, i) => [`p${i}.html`, b]))));
    expect(hits).toHaveLength(bad.length);
    expect(hits.every((h) => h.startsWith('FRAME '))).toBe(true);
  });
});
