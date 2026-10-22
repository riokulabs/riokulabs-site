import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { youtubeEmbedUrl, youtubeId, youtubeWatchUrl } from '../../src/lib/youtube';
import { normalise } from '../../src/lib/load';

const ID = 'dQw4w9WgXcQ';

describe('youtubeId', () => {
  it.each([
    [ID],
    [` ${ID} `],
    ['Fx_embed-01'],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`],
    [`https://www.youtube.com/watch?feature=share&v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc123&t=10`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/shorts/${ID}?feature=share`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube.com/embed/${ID}?start=30`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
  ])('accepts %s', (input) => expect(youtubeId(input)).toBe(input.trim().length === 11 ? input.trim() : ID));

  it.each([
    [undefined],
    [null],
    [42],
    [''],
    ['dQw4w9WgXc'], // 10 chars
    ['dQw4w9WgXcQQ'], // 12 chars
    ['dQw4w9WgX!Q'], // bad character
    [`https://evil.com/watch?v=${ID}`],
    [`https://youtube.com.evil.com/watch?v=${ID}`],
    [`https://evil.com/embed/${ID}`],
    [`https://evilyoutu.be/${ID}`],
    [`http://www.youtube.com/watch?v=${ID}`], // not https
    [`https://user@www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com:8443/watch?v=${ID}`],
    [`javascript:alert(1)//https://youtu.be/${ID}`],
    [`javascript:alert('${ID}')`],
    [`data:text/html,${ID}`],
    [`https://www.youtube.com/watch?v=${ID}x`],
    [`https://www.youtube.com/watch?v=${ID.slice(0, 10)}`],
    [`https://www.youtube.com/watch`],
    [`https://www.youtube.com/${ID}`],
    [`https://www.youtube.com/embed/${ID}/extra`],
    [`https://www.youtube-nocookie.com/shorts/${ID}`],
    [`https://youtu.be/${ID}/extra`],
    [`https://youtu.be/watch?v=${ID}`],
    [`//www.youtube.com/watch?v=${ID}`],
  ])('rejects %s', (input) => expect(youtubeId(input)).toBeUndefined());

  it('builds the nocookie embed URL and the watch URL', () => {
    expect(youtubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

describe('the CMS url field', () => {
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../cms/src/components/sections/youtube-embed.json'), 'utf8'));
  const re = new RegExp(schema.attributes.url.regex);

  it('admits every form the site accepts', () => {
    for (const u of [ID, `https://www.youtube.com/watch?v=${ID}&t=42s`, `https://youtu.be/${ID}?si=abc`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`]) {
      expect(u).toMatch(re);
      expect(youtubeId(u)).toBe(ID);
    }
  });

  it('rejects other hosts and schemes up front', () => {
    for (const u of [`https://evil.com/watch?v=${ID}`, `http://youtu.be/${ID}`, 'javascript:alert(1)', `https://youtube.com.evil.com/watch?v=${ID}`]) expect(u).not.toMatch(re);
  });
});

describe('normalise: sections.youtube-embed', () => {
  const body = (s: Record<string, unknown>) => normalise({ aboutPage: { body: [{ __component: 'sections.youtube-embed', ...s }] } }, 'strapi').site.about.body;

  it('maps a valid section (id parsed, size defaults to wide)', () => {
    expect(body({ url: `https://youtu.be/${ID}?si=x`, title: 'Rack demo', caption: 'The rack in action.' })).toEqual([
      { type: 'youtube-embed', id: ID, title: 'Rack demo', caption: 'The rack in action.', size: 'wide' },
    ]);
    expect(body({ url: ID, title: 'Rack demo', size: 'full' })).toEqual([{ type: 'youtube-embed', id: ID, title: 'Rack demo', caption: undefined, size: 'full' }]);
  });

  it('drops the section when the URL does not parse or the title is missing', () => {
    expect(body({ url: `https://evil.com/watch?v=${ID}`, title: 'x' })).toEqual([]);
    expect(body({ url: 'javascript:alert(1)', title: 'x' })).toEqual([]);
    expect(body({ url: ID, title: '  ' })).toEqual([]);
    expect(body({ url: ID })).toEqual([]);
  });
});
