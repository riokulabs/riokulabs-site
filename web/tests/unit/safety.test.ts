import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafeMediaKey, assertSafeRedirect, resolveInside, UnsafeContentError } from '../../src/lib/safety';
import { filterVisible, normalise } from '../../src/lib/load';

describe('media paths (round 3, finding 1)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'site-media-'));
  it.each(['../etc/passwd', 'showcase/../../etc/passwd', '/etc/passwd', 'C:/x.jpg', 'showcase\\img\\x.jpg', 'a\0b.jpg', '', 'a//b.jpg'])('rejects %j', (k) => {
    expect(() => resolveInside(base, k)).toThrow(UnsafeContentError);
  });
  it('accepts and copies a valid key inside the base', () => {
    const dest = resolveInside(base, 'showcase/img/x.jpg');
    expect(path.relative(base, dest)).toBe(path.join('showcase', 'img', 'x.jpg'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'ok');
    expect(fs.readFileSync(dest, 'utf8')).toBe('ok');
  });
  it('normalise refuses seed: URLs outside fixtures mode', () => {
    const raw = { mods: [], blogPosts: [], modReleases: [], timelineFamilies: [], milestones: [], blocks: [], categories: [], tags: [], authors: [], redirects: [],
      homePage: { heroTagline: 'x', heroMedia: { kind: 'image', image: { alt: 'a', file: { url: 'seed:showcase/img/a.jpg', mime: 'image/jpeg' } } } } };
    expect(() => normalise(filterVisible(raw), 'strapi')).toThrow(/seed: media URL outside fixtures/);
    expect(() => normalise(filterVisible(raw), 'fixtures')).not.toThrow();
  });
  it('normalise refuses traversal in a seed: URL', () => {
    const raw = { mods: [], blogPosts: [], modReleases: [], timelineFamilies: [], milestones: [], blocks: [], categories: [], tags: [], authors: [], redirects: [],
      homePage: { heroTagline: 'x', heroMedia: { kind: 'image', image: { alt: 'a', file: { url: 'seed:../../../etc/passwd', mime: 'image/jpeg' } } } } };
    expect(() => normalise(filterVisible(raw), 'fixtures')).toThrow(UnsafeContentError);
  });
  it('keys are plain', () => expect(assertSafeMediaKey('history/img/rack42/01-mockup-v1.jpg')).toBeTruthy());
});

describe('redirects (round 3, finding 2)', () => {
  it('passes valid rules', () => {
    expect(assertSafeRedirect({ from: '/old-post', to: '/blog/new-post' })).toEqual({ from: '/old-post', to: '/blog/new-post' });
    expect(assertSafeRedirect({ from: '/steam', to: 'https://steamcommunity.com/sharedfiles/filedetails/?id=123' }).to).toMatch(/^https:/);
  });
  it.each([
    [{ from: '/a', to: '/b\n/c https://evil.com 301' }, 'newline-injected rule'],
    [{ from: '/a\n/x', to: '/b' }, 'newline in from'],
    [{ from: '/a', to: '//evil.com' }, 'protocol-relative'],
    [{ from: '/a', to: 'https://evil.com/x' }, 'non-allowlisted host'],
    [{ from: '/a', to: 'https://steamcommunity.com.evil.com/' }, 'suffix host trick'],
    [{ from: '/a', to: 'https://user@github.com/' }, 'userinfo'],
    [{ from: '/a', to: 'http://github.com/' }, 'plain http'],
    [{ from: '/a', to: 'javascript:alert(1)' }, 'javascript URL'],
    [{ from: 'a', to: '/b' }, 'from not rooted'],
    [{ from: '/A B', to: '/b' }, 'whitespace in from'],
  ])('rejects %j (%s)', (r) => {
    expect(() => assertSafeRedirect(r)).toThrow(UnsafeContentError);
  });
  it('fails normalise (the build) on an invalid entry', () => {
    const raw = { mods: [], blogPosts: [], modReleases: [], timelineFamilies: [], milestones: [], blocks: [], categories: [], tags: [], authors: [],
      redirects: [{ documentId: 'r1', from: '/x', to: '//evil.com', visibility: 'public', publishedAt: 'x' }] };
    expect(() => normalise(filterVisible(raw), 'fixtures')).toThrow(UnsafeContentError);
  });
  it('the CMS schema carries the same constraints', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../cms/src/api/redirect/content-types/redirect/schema.json'), 'utf8'));
    const to = new RegExp(schema.attributes.to.regex);
    const from = new RegExp(schema.attributes.from.regex);
    expect(to.test('/blog/x')).toBe(true);
    expect(to.test('https://github.com/riokulabs/x')).toBe(true);
    expect(to.test('//evil.com')).toBe(false);
    expect(to.test('https://evil.com')).toBe(false);
    expect(to.test('/a\n/b')).toBe(false);
    expect(from.test('/old')).toBe(true);
    expect(from.test('/a b')).toBe(false);
  });
});
