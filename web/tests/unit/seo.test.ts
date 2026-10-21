import { describe, expect, it } from 'vitest';
import { metaDescription } from '../../src/lib/seo';

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
