import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY, fill, inlineHtml, normaliseCopy, plainText } from '../../src/lib/copy';
import { normalise } from '../../src/lib/load';
import fixtures from '../../fixtures/content.json';

describe('normaliseCopy', () => {
  it('uses the built-in wording, with {studio} filled in, when the CMS has none of the fields (a CMS not yet redeployed)', () => {
    const c = normaliseCopy({ siteSettings: { siteName: 'Rioku Labs', socialLinks: [] }, homePage: { heroTagline: 'x' } });
    expect(c.footerPitch).toBe(DEFAULT_COPY.siteSettings.footerPitch);
    expect(c.blogIndex.title).toBe('Dev log');
    expect(c.blogIndex.metaDescription).toBe('How Rioku Labs makes its mods, including the parts that went wrong.');
    expect(c.modTitleTemplate).toBe('{mod}: {a} {game} mod');
    expect(c.homeTitleTemplate).toBe('Rioku Labs · {game} mods');
    expect(c.spoilerNotice.title).toBe('Spoilers and unfinished content');
    expect(c.home.modsHeading).toBe('Our mods');
    expect(c.brand.title).toBe('Brand kit');
    expect(c.legal.title).toBe('Legal');
    expect(normaliseCopy({})).toEqual(c);
  });
  it('takes a CMS value when set and falls back field by field when one is empty', () => {
    const c = normaliseCopy({
      siteSettings: { footerPitch: '  We make mods.  ', blogIndex: { title: 'Notes', intro: '', metaTitle: 'Studio notes' }, spoilerNotice: { body: 'Careful.' } },
      homePage: { teaserText: 'Something new.' },
      legalPage: { title: '' },
    });
    expect(c.footerPitch).toBe('We make mods.');
    expect(c.blogIndex).toMatchObject({ title: 'Notes', metaTitle: 'Studio notes', intro: DEFAULT_COPY.siteSettings.blogIndex.intro });
    expect(c.spoilerNotice).toMatchObject({ body: 'Careful.', title: 'Spoilers and unfinished content' });
    expect(c.home.teaserText).toBe('Something new.');
    expect(c.legal.title).toBe('Legal');
  });
  it('ignores values of the wrong type', () => {
    const c = normaliseCopy({ siteSettings: { footerPitch: 42, blogIndex: 'oops', modsIndex: [] } });
    expect(c.footerPitch).toBe(DEFAULT_COPY.siteSettings.footerPitch);
    expect(c.blogIndex.title).toBe('Dev log');
    expect(c.modsIndex.title).toBe('Mods');
  });
  it('keeps the built-in wording general: no single game or mod at site level', () => {
    const all = JSON.stringify({ ...DEFAULT_COPY, $comment: '' });
    expect(all).not.toMatch(/data center|space engineers|\bSE2\b|server rack/i);
  });
  it('reaches the Site model through normalise, from fixtures that do and do not carry the fields', () => {
    const withFields = normalise(structuredClone(fixtures) as any, 'fixtures').site;
    expect(withFields.copy.blogIndex.title).toBe('Dev log');
    const old = structuredClone(fixtures) as any;
    for (const k of ['footerPitch', 'blogIndex', 'modsIndex', 'gamesIndex', 'roadmapIndex', 'notFound', 'spoilerNotice', 'modTitleTemplate']) delete old.siteSettings[k];
    for (const k of ['modsHeading', 'teaserText']) delete old.homePage[k];
    const site = normalise(old, 'fixtures').site;
    expect(site.copy).toEqual(withFields.copy);
  });
});

describe('fill', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(fill('{mod}: {a} {game} mod', { mod: 'X', a: 'a', game: 'G' })).toBe('X: a G mod');
    expect(fill('{studio} and {typo}', { studio: 'R' })).toBe('R and {typo}');
  });
});

describe('inlineHtml', () => {
  it('turns [label](url) into links for site paths and http(s) URLs only', () => {
    expect(inlineHtml('Follow the [RSS feed](/rss.xml).')).toBe('Follow the <a href="/rss.xml">RSS feed</a>.');
    expect(inlineHtml('[GitHub](https://github.com/riokulabs)')).toBe('<a href="https://github.com/riokulabs" rel="noopener">GitHub</a>');
    expect(inlineHtml('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
    expect(inlineHtml('[x](//evil.test/a)')).toBe('[x](//evil.test/a)');
  });
  it('escapes everything else', () => {
    expect(inlineHtml('<script>alert(1)</script> & "q"')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;');
    expect(inlineHtml('[<b>x</b>](/a)')).toBe('<a href="/a">&lt;b&gt;x&lt;/b&gt;</a>');
    expect(inlineHtml('[x](/a"onmouseover="y)')).not.toContain('"onmouseover');
  });
  it('plainText drops the link markup', () => {
    expect(plainText('Follow the [RSS feed](/rss.xml).')).toBe('Follow the RSS feed.');
  });
});
