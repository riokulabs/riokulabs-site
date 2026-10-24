import { describe, expect, it } from 'vitest';
import { blogTitle, cmsLogo, collectionJsonLd, gameTitle, homeTitle, metaDescription, modTitle, sameAsLinks, TITLE_MAX } from '../../src/lib/seo';

describe('metaDescription (components/Seo.astro)', () => {
  it('leaves text of 160 characters or fewer alone, with no ellipsis', () => {
    expect(metaDescription('Our mods for this game.')).toBe('Our mods for this game.');
    const exact = 'a'.repeat(160);
    expect(metaDescription(exact)).toBe(exact);
  });
  it('collapses whitespace', () => {
    expect(metaDescription('  two\n  lines  ')).toBe('two lines');
  });
  it('cuts long text at a word boundary and adds an ellipsis, 160 characters at most', () => {
    const text = 'Data Center for Space Engineers 2: 24U and 42U racks, ten rack servers, 38 cable-tray blocks and 19 room pieces including a raised floor, an in-row cooler and more besides.';
    const out = metaDescription(text);
    expect(text.length).toBeGreaterThan(160);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    const kept = out.slice(0, -1);
    expect(text.startsWith(kept)).toBe(true);
    expect(text[kept.length]).toMatch(/[\s,]/); // the next source character ends a word: no half words
    expect(kept).not.toMatch(/[\s,]$/); // and no dangling comma or space before the ellipsis
  });
  it('keeps the last word when the cut lands right after it', () => {
    const text = `${'abcd '.repeat(31)}abc tail-end-word`; // "abc" ends at character 158
    const out = metaDescription(text);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith(' abc…')).toBe(true);
  });
  it('hard-cuts a single word longer than the limit', () => {
    const out = metaDescription('x'.repeat(300));
    expect(out).toHaveLength(160);
    expect(out.endsWith('…')).toBe(true);
  });
  it('honours a custom limit', () => {
    expect(metaDescription('one two three four', 10)).toBe('one two…');
  });
});

describe('keyword titles', () => {
  it('names the game on mod pages, with the right article', () => {
    expect(modTitle('Data Center', 'Space Engineers 2', 'Rioku Labs')).toBe('Data Center: a Space Engineers 2 mod');
    expect(modTitle('Hull Kit', 'Elite Dangerous', 'Rioku Labs')).toBe('Hull Kit: an Elite Dangerous mod');
    expect(modTitle('Data Center', undefined, 'Rioku Labs')).toBe('Data Center');
  });
  it('drops the article, then the game, when the full title would pass the limit', () => {
    const studio = 'Rioku Labs';
    const name = 'A fairly long mod name'; // 22 + ": a Space Engineers 2 mod" (25) + " · Rioku Labs" (13) = 60
    expect(modTitle(name, 'Space Engineers 2', studio)).toBe(`${name}: a Space Engineers 2 mod`);
    const longer = 'A considerably longer mod name here'; // too long with the article and without it
    expect(modTitle(longer, 'Space Engineers 2', studio)).toBe(longer);
    const mid = 'Orbital Cargo Handling Suite'; // 28 + 25 + 13 = 66: too long with the article, 64 without it
    expect(modTitle(mid, 'Space Engineers 2', studio)).toBe(`${mid}: Space Engineers 2 mod`);
    for (const t of [modTitle(name, 'Space Engineers 2', studio), modTitle(mid, 'Space Engineers 2', studio)]) expect(`${t} · ${studio}`.length).toBeLessThanOrEqual(TITLE_MAX);
  });
  it('names the game on the dev-log index and the home page', () => {
    expect(blogTitle('Space Engineers 2', 'Rioku Labs')).toBe('Dev log: Space Engineers 2 modding');
    expect(blogTitle(undefined, 'Rioku Labs')).toBe('Dev log');
    expect(blogTitle('x'.repeat(60), 'Rioku Labs')).toBe('Dev log');
    expect(homeTitle('Rioku Labs', 'Space Engineers 2')).toBe('Rioku Labs · Space Engineers 2 mods');
    expect(homeTitle('Rioku Labs')).toBe('Rioku Labs');
  });
});

describe('title templates from the CMS', () => {
  it('fills {mod}, {game}, {a} and {studio}', () => {
    expect(modTitle('Hull Kit', 'Elite Dangerous', 'Rioku Labs', '{mod} for {game}')).toBe('Hull Kit for Elite Dangerous');
    expect(modTitle('Hull Kit', 'Elite Dangerous', 'Rioku Labs', '{mod}, {a} {game} mod')).toBe('Hull Kit, an Elite Dangerous mod');
    expect(gameTitle('Space Engineers 2', 'Rioku Labs')).toBe('Space Engineers 2 mods');
    expect(gameTitle('Space Engineers 2', 'Rioku Labs', 'Mods for {game}')).toBe('Mods for Space Engineers 2');
    expect(homeTitle('Rioku Labs', 'Space Engineers 2', '{studio}: {game} mods and more')).toBe('Rioku Labs: Space Engineers 2 mods and more');
    expect(blogTitle('Space Engineers 2', 'Rioku Labs', '{game} dev log', 'Notes')).toBe('Space Engineers 2 dev log');
  });
  it('falls back to the plain name or heading without a game or when too long', () => {
    expect(blogTitle(undefined, 'Rioku Labs', 'Dev log: {game} modding', 'Notes')).toBe('Notes');
    expect(blogTitle('x'.repeat(60), 'Rioku Labs', 'Dev log: {game} modding', 'Notes')).toBe('Notes');
    expect(blogTitle(undefined, 'Rioku Labs', 'Studio notes', 'Notes')).toBe('Studio notes');
    expect(homeTitle('Rioku Labs', undefined, '{studio} · {game} mods')).toBe('Rioku Labs');
    expect(modTitle('X'.repeat(50), 'Space Engineers 2', 'Rioku Labs', '{mod}: {a} {game} mod')).toBe('X'.repeat(50));
  });
});

describe('Organization sameAs and logo', () => {
  const links = [
    { url: 'https://www.youtube.com/@riokulabs', kind: 'external' },
    { url: 'https://github.com/riokulabs', kind: 'github' },
    { url: 'https://discord.gg/abc', kind: 'discord' },
    { url: 'https://www.youtube.com/@riokulabs', kind: 'youtube' },
    { url: '/rss.xml', kind: 'rss' },
    { url: 'https://rioku.dev/rss.xml', kind: 'rss' },
    { url: '/about', kind: 'internal' },
    { url: 'https://example.test/about', kind: 'internal' },
    { url: 'javascript:alert(1)', kind: 'external' },
    { url: 'mailto:hi@example.test', kind: 'external' },
  ];
  it('keeps only absolute http(s) profile links, in order, without duplicates', () => {
    expect(sameAsLinks(links)).toEqual(['https://www.youtube.com/@riokulabs', 'https://github.com/riokulabs', 'https://discord.gg/abc']);
    expect(sameAsLinks([])).toEqual([]);
  });
  it('prefers the CMS logo mark, then the logo, and only raster images', () => {
    const img = (src: string, mime?: string) => ({ src, mime, alt: '', focalX: 0.5, focalY: 0.5, width: 512, height: 512 });
    expect(cmsLogo({})).toBeUndefined();
    expect(cmsLogo({ logo: img('a.png', 'image/png') })?.src).toBe('a.png');
    expect(cmsLogo({ logo: img('a.png', 'image/png'), logoMark: img('m.png', 'image/png') })?.src).toBe('m.png');
    expect(cmsLogo({ logoMark: img('m.svg', 'image/svg+xml'), logo: img('a.jpg', 'image/jpeg') })?.src).toBe('a.jpg');
    expect(cmsLogo({ logoMark: img('m.svg', 'image/svg+xml') })).toBeUndefined();
  });
});

describe('collectionJsonLd', () => {
  it('builds a CollectionPage whose main entity is a numbered ItemList', () => {
    const ld = collectionJsonLd({ name: 'Mods', description: 'All of them.', url: 'https://x.test/mods' }, [
      { name: 'A', url: 'https://x.test/a' },
      { name: 'B', url: 'https://x.test/b' },
    ]);
    expect(ld).toEqual({
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Mods', description: 'All of them.', url: 'https://x.test/mods',
      mainEntity: {
        '@type': 'ItemList', numberOfItems: 2,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'A', url: 'https://x.test/a' },
          { '@type': 'ListItem', position: 2, name: 'B', url: 'https://x.test/b' },
        ],
      },
    });
  });
  it('leaves out an empty description', () => {
    expect(collectionJsonLd({ name: 'Games', url: 'https://x.test/games' }, [])).not.toHaveProperty('description');
  });
});
