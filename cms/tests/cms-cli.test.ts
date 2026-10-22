import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdminClient, UsageError } from '../scripts/lib/admin-http';
import {
  blocksToMarkdown,
  conv,
  editSection,
  listQuery,
  markdownToBlocks,
  move,
  newSection,
  outline,
  outlineLine,
  parseCli,
  parseInline,
  resolveType,
  type Schemas,
  sectionNumber,
  subsetMatch,
  summarizeBlocks,
  type TypeSchema,
  VerifyError,
} from '../scripts/lib/cms-cli';
import { runCommand } from '../scripts/lib/cms-commands';

// --- a tiny schema set and an in-memory Content Manager ------------------------------------------------------------

const UID = 'api::blog-post.blog-post';
const blogPost: TypeSchema = {
  uid: UID,
  kind: 'collectionType',
  info: { singularName: 'blog-post', pluralName: 'blog-posts' },
  mainField: 'title',
  attributes: {
    title: { type: 'string' },
    spoiler: { type: 'boolean' },
    visibility: { type: 'enumeration', enum: ['public', 'unlisted', 'private'] },
    tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag.tag' },
    cover: { type: 'component', component: 'media.image' },
    body: { type: 'dynamiczone', components: ['sections.rich-text', 'sections.image', 'sections.model-embed'] },
  },
};
const about: TypeSchema = { uid: 'api::about-page.about-page', kind: 'singleType', info: { singularName: 'about-page' }, attributes: { title: { type: 'string' } } };
const components = [
  { uid: 'media.image', attributes: { file: { type: 'media' }, alt: { type: 'string' }, caption: { type: 'text' }, decorative: { type: 'boolean' } } },
  { uid: 'sections.image', attributes: { image: { type: 'component', component: 'media.image' }, size: { type: 'enumeration', enum: ['inline', 'wide', 'full'] } } },
  { uid: 'sections.rich-text', attributes: { content: { type: 'blocks' } } },
  { uid: 'sections.model-embed', attributes: { model: { type: 'relation', target: 'api::block-3d-model.block-3d-model' }, caption: { type: 'string' } } },
  { uid: 'sections.code', attributes: { language: { type: 'enumeration', enum: ['ts', 'text'] }, code: { type: 'text' } } },
  {
    uid: 'sections.youtube-embed',
    attributes: { url: { type: 'string' }, title: { type: 'string' }, caption: { type: 'string' }, size: { type: 'enumeration', enum: ['inline', 'wide', 'full'] } },
  },
];
const schemas: Schemas = {
  types: new Map([[UID, blogPost], [about.uid, about]]),
  components: new Map(components.map((c) => [c.uid, c as any])),
};

const para = (text: string) => ({ type: 'paragraph', children: [{ type: 'text', text }] });
const file = (id: number) => ({ id, url: `/uploads/f${id}.png`, mime: 'image/png', name: `f${id}.png` });

/**
 * Fake Content Manager: stores the draft in read form (media as objects, relations as ids on the side), answers the
 * routes the CLI uses, and applies PUTs the way Strapi does (sent keys only, components by id, relations kept unless
 * a set/connect is sent). `tamper` lets a test make the server change something it was not asked to.
 */
function fakeServer(opts: { tamper?: (doc: any) => void } = {}) {
  let nextComp = 100;
  const doc: any = {
    id: 1,
    documentId: 'post1',
    title: 'Server racks',
    spoiler: false,
    visibility: 'private',
    status: 'draft',
    publishedAt: null,
    updatedAt: 't0',
    cover: { id: 1, file: file(5), alt: 'Cover', caption: null, decorative: false },
    body: [
      { __component: 'sections.rich-text', id: 1, content: [para('Intro'), { type: 'heading', level: 2, children: [{ type: 'text', text: 'Racks' }] }] },
      { __component: 'sections.image', id: 2, size: 'wide', image: { id: 3, file: file(17), alt: 'Racks in a row', caption: null, decorative: false } },
      { __component: 'sections.model-embed', id: 4, caption: 'The rack' },
    ],
  };
  const rels: Record<string, string[]> = { [`${UID}:post1:tags`]: ['tagA', 'tagB'], 'sections.model-embed:4:model': ['model9'] };
  const calls: { method: string; url: string; body?: any }[] = [];

  const toRead = (v: any, uid: string): any => {
    const out: any = { ...v };
    for (const [k, a] of Object.entries((schemas.components.get(uid) as any).attributes) as [string, any][]) {
      if (a.type === 'media' && typeof v[k] === 'number') out[k] = file(v[k]);
      if (a.type === 'component' && v[k] && typeof v[k] === 'object') out[k] = toRead({ id: v[k].id ?? nextComp++, decorative: false, caption: null, ...v[k] }, a.component);
      if (a.type === 'relation') delete out[k];
    }
    return out;
  };
  const counted = () => {
    const d = structuredClone(doc);
    d.tags = { count: rels[`${UID}:post1:tags`].length };
    for (const s of d.body) if (s.__component === 'sections.model-embed') s.model = { count: (rels[`sections.model-embed:${s.id}:model`] ?? []).length };
    return d;
  };

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url: u.pathname + u.search, body });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const p = decodeURIComponent(u.pathname);
    if (p === '/content-manager/content-types') return ok({ data: [...schemas.types.values()] });
    if (p === '/content-manager/components') return ok({ data: components });
    if (p === '/content-manager/content-types-settings') return ok({ data: [{ uid: UID, settings: { mainField: 'title' } }] });
    if (p === `/content-manager/collection-types/${UID}`) return ok({ results: [counted()], pagination: { total: 1 } });
    const rel = p.match(/^\/content-manager\/relations\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (rel) return ok({ results: (rels[`${rel[1]}:${rel[2]}:${rel[3]}`] ?? []).map((documentId) => ({ documentId })), pagination: { pageCount: 1 } });
    if (p === `/content-manager/collection-types/${UID}/post1`) {
      if (method === 'GET') return ok({ data: counted() });
      if (method === 'PUT') {
        for (const [k, v] of Object.entries(body)) {
          if (k === 'tags') rels[`${UID}:post1:tags`] = (v as any).set.map((x: any) => x.documentId);
          else if (k === 'body') {
            doc.body = (v as any[]).map((s) => {
              const id = s.id ?? nextComp++;
              if (s.model?.set) rels[`${s.__component}:${id}:model`] = s.model.set.map((x: any) => x.documentId);
              return { ...toRead({ ...s, id }, s.__component) };
            });
          } else if (k === 'cover') doc.cover = toRead(v, 'sections.image').image ?? v;
          else doc[k] = v;
        }
        doc.updatedAt = 't1';
        opts.tamper?.(doc);
        return ok({ data: counted() });
      }
    }
    if (p === `/content-manager/collection-types/${UID}/post1/actions/publish` && method === 'POST') {
      doc.status = 'published';
      return ok({ data: counted() });
    }
    return new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404 });
  };
  return { doc, rels, calls, client: new AdminClient('http://localhost:1337', 'tok', fetchImpl as any) };
}

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-cli-test-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function run(argv: string[], server = fakeServer(), files: Record<string, string> = {}) {
  const lines: string[] = [];
  const code = await runCommand(parseCli(argv), {
    client: server.client,
    out: (l) => lines.push(l),
    err: (l) => lines.push(`ERR ${l}`),
    readText: (f) => {
      if (!(f in files)) throw new Error(`no file ${f}`);
      return files[f];
    },
    backupDir: tmp,
  });
  return { code, lines, out: lines.join('\n'), server };
}
const puts = (s: ReturnType<typeof fakeServer>) => s.calls.filter((c) => c.method === 'PUT');

// --- arguments ------------------------------------------------------------------------------------------------------

describe('parseCli', () => {
  it('reads commands, positionals and flags with spaces or =', () => {
    expect(parseCli(['list', 'blog-post', '--fields=title,date', '--filter', 'slug=a', '--filter', 'visibility=public', '--limit', '5'])).toEqual({
      cmd: 'list',
      pos: ['blog-post'],
      flags: { fields: 'title,date', filter: ['slug=a', 'visibility=public'], limit: '5' },
    });
    expect(parseCli(['set', 'blog-post', 'x', 'title=A=B', '--json-value', 'tags={"set":[]}']).pos).toEqual(['blog-post', 'x', 'title=A=B']);
  });
  it('refuses unknown commands and flags, wrong counts, and flags a command does not take', () => {
    expect(() => parseCli(['frob'])).toThrow(/unknown command/);
    expect(() => parseCli(['get', 'blog-post'])).toThrow(/expected 2/);
    expect(() => parseCli(['get', 'blog-post', 'x', '--bogus'])).toThrow(/unknown option/);
    expect(() => parseCli(['get', 'blog-post', 'x', '--yes'])).toThrow(/does not take --yes/);
    expect(() => parseCli(['list', 'blog-post', '--limit'])).toThrow(/needs a value/);
    expect(() => parseCli(['set', 'blog-post', 'x', 'oops'])).toThrow(/field=value/);
    expect(() => parseCli(['set', 'blog-post', 'x'])).toThrow(/nothing to change/);
    expect(() => parseCli(['section-insert', 'blog-post', 'x', '1'])).toThrow(/--kind/);
  });
  it('has no delete command', () => {
    for (const c of ['delete', 'remove', 'rm']) expect(() => parseCli([c, 'blog-post', 'x'])).toThrow(/no delete command/);
  });
  it('the --yes guard: publish and unpublish refuse without it', () => {
    expect(() => parseCli(['publish', 'blog-post', 'x'])).toThrow(/--yes/);
    expect(() => parseCli(['unpublish', 'blog-post', 'x'])).toThrow(UsageError);
    expect(parseCli(['publish', 'blog-post', 'x', '--yes']).flags.yes).toBe(true);
  });
  it('help needs nothing', () => {
    expect(parseCli([]).cmd).toBe('help');
    expect(parseCli(['get', '--help']).cmd).toBe('help');
  });
  it('section numbers are 1-based and checked', () => {
    expect(sectionNumber('2', 3)).toBe(2);
    expect(sectionNumber('end', 3, true)).toBe(4);
    expect(sectionNumber('4', 3, true)).toBe(4);
    expect(() => sectionNumber('0', 3)).toThrow(/1\.\.3/);
    expect(() => sectionNumber('4', 3)).toThrow(UsageError);
    expect(() => sectionNumber('end', 3)).toThrow(UsageError);
  });
});

describe('type resolution', () => {
  it('accepts short names, plural names and uids', () => {
    expect(resolveType('blog-post', schemas).uid).toBe(UID);
    expect(resolveType('blog-posts', schemas).uid).toBe(UID);
    expect(resolveType(UID, schemas).uid).toBe(UID);
    expect(resolveType('Blog-Post', schemas).uid).toBe(UID);
  });
  it('lists the known types on a miss', () => {
    expect(() => resolveType('post', schemas)).toThrow(/unknown type "post"\. Types: about-page, blog-post/);
  });
});

describe('list query', () => {
  it('maps --status, --filter, --limit and --sort to Content Manager params', () => {
    expect(listQuery({ status: 'draft', filters: ['visibility=public'], limit: '5' }, blogPost)).toEqual({
      page: 1,
      pageSize: 5,
      sort: 'updatedAt:desc',
      status: 'draft',
      publicationFilter: 'never-published',
      'filters[$and][0][visibility][$eq]': 'public',
    });
    expect(listQuery({ status: 'published', filters: [], sort: 'title:asc' }, blogPost)).toMatchObject({ status: 'published', sort: 'title:asc' });
    expect(listQuery({ status: 'modified', filters: [] }, blogPost)).toMatchObject({ publicationStatusFilter: 'published-modified' });
  });
  it('refuses bad values', () => {
    expect(() => listQuery({ status: 'live', filters: [] }, blogPost)).toThrow(/--status/);
    expect(() => listQuery({ filters: ['nope=1'] }, blogPost)).toThrow(/no field nope/);
    expect(() => listQuery({ filters: ['tags=a'] }, blogPost)).toThrow(/plain fields/);
    expect(() => listQuery({ filters: [], limit: '500' }, blogPost)).toThrow(/--limit/);
  });
});

// --- rendering ------------------------------------------------------------------------------------------------------

describe('outline', () => {
  it('renders one compact line per section', () => {
    const body = [
      { __component: 'sections.rich-text', content: [para('One'), para('Two'), para('Three'), { type: 'heading', level: 2, children: [{ type: 'text', text: 'H' }] }, { type: 'heading', level: 3, children: [] }] },
      { __component: 'sections.image', image: { file: { id: 17 }, alt: 'Racks in a row' }, size: 'wide' },
      { __component: 'sections.model-embed', caption: null },
      { __component: 'sections.code', language: 'ts', code: 'a\nb\nc', filename: 'x.ts' },
      { __component: 'sections.gallery', layout: 'grid', items: [{ kind: 'image', image: { file: { id: 3 } } }, { kind: 'loop', video: { mp4: { id: 4 } } }] },
      { __component: 'sections.timeline-embed', fromStage: 1, toStage: 3 },
      { __component: 'sections.image', image: { file: 8, decorative: true }, size: 'full' },
    ];
    expect(outline(body, [{}, {}, { model: ['doc9'] }, {}, {}, { family: ['fam1'] }, {}])).toEqual([
      '1 rich-text 3 paragraphs, 2 headings "One Two Three H"',
      '2 image file=17 alt="Racks in a row" size=wide',
      '3 model-embed model=doc9',
      '4 code language=ts 3 lines filename=x.ts',
      '5 gallery 2 items layout=grid files=3,v4',
      '6 timeline-embed family=fam1 from=1 to=3',
      '7 image file=8 decorative size=full',
    ]);
  });
  it('clips long text and shows missing relations as none', () => {
    expect(outlineLine(1, { __component: 'sections.image', image: { file: { id: 1 }, alt: 'x'.repeat(80) } })).toMatch(/alt="x{49}…"$/);
    expect(outlineLine(2, { __component: 'sections.mod-card' }, {})).toBe('2 mod-card mod=none');
  });
  it('summarises blocks', () => {
    expect(summarizeBlocks([para('a'), { type: 'list', children: [] }])).toBe('1 paragraph, 1 list');
    expect(summarizeBlocks([])).toBe('empty');
  });
});

// --- markdown -------------------------------------------------------------------------------------------------------

describe('markdown to blocks', () => {
  it('converts paragraphs, headings, lists and inline marks', () => {
    const md = '## Cold aisle\n\nThe racks sit in **two rows**\nwith `cold` air. See [the docs](https://rioku.dev/docs).\n\n- First\n- Second **bold**\n\n1. One\n2. Two\n';
    expect(markdownToBlocks(md)).toEqual([
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Cold aisle' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'The racks sit in ' },
          { type: 'text', text: 'two rows', bold: true },
          { type: 'text', text: ' with ' },
          { type: 'text', text: 'cold', code: true },
          { type: 'text', text: ' air. See ' },
          { type: 'link', url: 'https://rioku.dev/docs', children: [{ type: 'text', text: 'the docs' }] },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'list',
        format: 'unordered',
        children: [
          { type: 'list-item', children: [{ type: 'text', text: 'First' }] },
          { type: 'list-item', children: [{ type: 'text', text: 'Second ' }, { type: 'text', text: 'bold', bold: true }] },
        ],
      },
      {
        type: 'list',
        format: 'ordered',
        children: [
          { type: 'list-item', children: [{ type: 'text', text: 'One' }] },
          { type: 'list-item', children: [{ type: 'text', text: 'Two' }] },
        ],
      },
    ]);
  });
  it('round-trips through blocksToMarkdown', () => {
    const md = '## Title\n\nSome **bold** and `code` with [a link](/blog).\n\n- one\n- two\n\n1. a\n2. b';
    expect(blocksToMarkdown(markdownToBlocks(md))).toBe(md);
  });
  it('keeps unmatched marks as text and joins wrapped list items', () => {
    expect(parseInline('a ** b ` c [d]')).toEqual([{ type: 'text', text: 'a ** b ` c [d]' }]);
    expect(markdownToBlocks('- long\n  item\n')[0]).toMatchObject({ children: [{ children: [{ text: 'long item' }] }] });
  });
  it('refuses what it cannot convert faithfully, and unsafe links', () => {
    expect(() => markdownToBlocks('```\ncode\n```')).toThrow(/not supported/);
    expect(() => markdownToBlocks('> quote')).toThrow(/not supported/);
    expect(() => markdownToBlocks('![img](x.png)')).toThrow(/not supported/);
    expect(() => markdownToBlocks('[x](javascript:alert(1))')).toThrow(/link URL/);
    expect(() => markdownToBlocks('\n\n')).toThrow(/empty/);
  });
});

// --- section edits and diffing --------------------------------------------------------------------------------------

describe('section edits', () => {
  const read = (f: string) => ({ 'a.md': 'New **text**' } as Record<string, string>)[f] ?? '';
  const img = { __component: 'sections.image', id: 2, size: 'wide', image: { id: 3, file: 17, alt: 'Old', caption: null, decorative: false } };
  it('changes only the asked fields and reports old → new', () => {
    const r = editSection(img, { image: '21', alt: 'New alt', size: 'full' }, schemas, read);
    expect(r.section).toEqual({ ...img, size: 'full', image: { ...img.image, file: 21, alt: 'New alt' } });
    expect(r.changes).toEqual(['image.file: 17 → 21', 'image.alt: "Old" → "New alt"', 'size: "wide" → "full"']);
    expect(img.image.alt).toBe('Old');
  });
  it('reports nothing when the values are already set', () => {
    expect(editSection(img, { alt: 'Old' }, schemas, read).changes).toEqual([]);
  });
  it('converts --text-file for rich text and refuses options a section does not have', () => {
    const rt = { __component: 'sections.rich-text', id: 1, content: [para('Old')] };
    const r = editSection(rt, { textFile: 'a.md' }, schemas, read);
    expect(r.section.content).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'New ' }, { type: 'text', text: 'text', bold: true }] }]);
    expect(r.changes).toEqual(['content: 1 paragraph → 1 paragraph']);
    expect(() => editSection(rt, { alt: 'x' }, schemas, read)).toThrow(/--alt does not apply to rich-text/);
    expect(() => editSection(img, { textFile: 'a.md' }, schemas, read)).toThrow(/--text-file does not apply/);
    expect(() => editSection(img, { size: 'huge' }, schemas, read)).toThrow(/inline, wide, full/);
    expect(() => editSection(img, { image: 'abc' }, schemas, read)).toThrow(/numeric file id/);
    expect(() => editSection(img, { alt: ' ' }, schemas, read)).toThrow(/--alt cannot be empty/);
  });
  it('sets a model-embed relation with set and records the expected ids', () => {
    const me = { __component: 'sections.model-embed', id: 4, caption: 'x' };
    const r = editSection(me, { model: 'model2' }, schemas, read, { model: ['model9'] });
    expect(r.section.model).toEqual({ set: [{ documentId: 'model2' }] });
    expect(r.rels).toEqual({ model: ['model2'] });
    expect(r.changes).toEqual(['model: model9 → model2']);
  });
  it('builds new sections and insists on their required content', () => {
    expect(newSection('image', { image: '5', alt: 'A' }, schemas, read).section).toEqual({ __component: 'sections.image', size: 'wide', image: { file: 5, alt: 'A' } });
    expect(() => newSection('image', { image: '5' }, schemas, read)).toThrow(/--image <fileId> and --alt/);
    expect(() => newSection('rich-text', {}, schemas, read)).toThrow(/--text-file/);
    expect(() => newSection('model-embed', {}, schemas, read)).toThrow(/--model/);
    expect(() => newSection('video', {}, schemas, read)).toThrow(/--kind must be one of/);
  });
  it('builds a youtube-embed section and checks the URL like the site does', () => {
    const r = newSection('youtube-embed', { url: 'https://youtu.be/dQw4w9WgXcQ?si=x', title: 'Rack demo', caption: 'Doors' }, schemas, read);
    expect(r.section).toEqual({ __component: 'sections.youtube-embed', size: 'wide', url: 'https://youtu.be/dQw4w9WgXcQ?si=x', title: 'Rack demo', caption: 'Doors' });
    expect(outlineLine(5, r.section)).toBe('5 youtube-embed url="https://youtu.be/dQw4w9WgXcQ?si=x" title="Rack demo" caption="Doors" size=wide');
    for (const url of ['https://evil.com/watch?v=dQw4w9WgXcQ', 'http://youtu.be/dQw4w9WgXcQ', 'javascript:alert(1)', 'dQw4w9WgXc']) {
      expect(() => newSection('youtube-embed', { url, title: 'x' }, schemas, read)).toThrow(/--url must be/);
    }
    expect(() => newSection('youtube-embed', { url: 'dQw4w9WgXcQ' }, schemas, read)).toThrow(/--url and --title/);
    expect(() => editSection({ __component: 'sections.image', id: 2 }, { url: 'dQw4w9WgXcQ' }, schemas, read)).toThrow(/--url does not apply/);
    expect(parseCli(['section-insert', 'blog-post', 'x', 'end', '--kind', 'youtube-embed', '--url', 'dQw4w9WgXcQ', '--title', 'T']).flags.url).toBe('dQw4w9WgXcQ');
  });
  it('moves by 1-based positions', () => {
    expect(move(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(move(['a', 'b', 'c', 'd'], 4, 1)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('normalises read values to write form: media as ids, relations left out, component ids kept', () => {
    const read = { __component: 'sections.model-embed', id: 4, caption: 'x', model: { count: 1 } };
    expect(conv([read], blogPost.attributes.body, schemas, 'write')).toEqual([{ __component: 'sections.model-embed', id: 4, caption: 'x' }]);
    const cover = { id: 1, file: file(5), alt: 'Cover', caption: null, decorative: false };
    expect(conv(cover, blogPost.attributes.cover, schemas, 'write')).toEqual({ id: 1, file: 5, alt: 'Cover', caption: null, decorative: false });
    expect(conv(cover, blogPost.attributes.cover, schemas, 'compare')).toEqual({ file: 5, alt: 'Cover', caption: null, decorative: false });
  });
  it('subset matching lets the server fill defaults but not change sent values', () => {
    expect(subsetMatch({ a: 1, b: null }, { a: 1, b: 2, c: 3 })).toBe(true);
    expect(subsetMatch({ a: 1 }, { a: 2 })).toBe(false);
    expect(subsetMatch([{ a: 1 }], [{ a: 1 }, { a: 2 }])).toBe(false);
  });
});

// --- whole commands against the fake Content Manager ----------------------------------------------------------------

describe('commands', () => {
  it('list prints one line per entry with status and visibility', async () => {
    const r = await run(['list', 'blog-post', '--fields', 'title,tags']);
    expect(r.lines).toEqual(['post1  draft  private  title="Server racks"  tags=(2)', '(1 of 1)']);
  });
  it('get prints chosen fields, resolves requested relations, and the outline', async () => {
    const r = await run(['get', 'blog-post', 'post1', '--fields', 'title,tags', '--outline']);
    expect(r.lines).toEqual([
      'post1  draft  private  updated t0',
      'title: "Server racks"',
      'tags: tagA, tagB',
      'body:',
      '  1 rich-text 1 paragraph, 1 heading "Intro Racks"',
      '  2 image file=17 alt="Racks in a row" size=wide',
      '  3 model-embed model=model9 caption="The rack"',
    ]);
  });
  it('get --json prints the full entry; a single type needs "single"', async () => {
    const r = await run(['get', 'blog-post', 'post1', '--json']);
    expect(JSON.parse(r.out).documentId).toBe('post1');
    await expect(run(['get', 'about-page', 'abc'])).rejects.toThrow(/single type: use "single"/);
    await expect(run(['get', 'blog-post', 'single'])).rejects.toThrow(/collection type/);
  });
  it('set sends only the changed fields, prints old → new, and verifies', async () => {
    const r = await run(['set', 'blog-post', 'post1', 'title=Server racks', 'spoiler=true', 'visibility=unlisted']);
    expect(puts(r.server)).toHaveLength(1);
    expect(puts(r.server)[0].body).toEqual({ spoiler: true, visibility: 'unlisted' });
    expect(r.lines).toEqual(['spoiler: false → true', 'visibility: "private" → "unlisted"', 'saved draft post1; nothing else changed']);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
  it('set with nothing to change writes nothing', async () => {
    const r = await run(['set', 'blog-post', 'post1', 'title=Server racks']);
    expect(puts(r.server)).toHaveLength(0);
    expect(r.out).toMatch(/no change/);
  });
  it('set refuses unknown, system and section fields and bad values', async () => {
    await expect(run(['set', 'blog-post', 'post1', 'nope=1'])).rejects.toThrow(/no field nope/);
    await expect(run(['set', 'blog-post', 'post1', 'body=x'])).rejects.toThrow(/section-insert/);
    await expect(run(['set', 'blog-post', 'post1', 'spoiler=yes'])).rejects.toThrow(/true or false/);
    await expect(run(['set', 'blog-post', 'post1', 'tags=a'])).rejects.toThrow(/--json-value tags=/);
    await expect(run(['set', 'blog-post', 'post1', '--json-value', 'tags={bad'])).rejects.toThrow(/not valid JSON/);
  });
  it('set --json-value changes a relation and shows the ids', async () => {
    const r = await run(['set', 'blog-post', 'post1', '--json-value', 'tags={"set":[{"documentId":"tagC"}]}']);
    expect(puts(r.server)[0].body).toEqual({ tags: { set: [{ documentId: 'tagC' }] } });
    expect(r.lines[0]).toBe('tags: tagA,tagB → tagC');
  });
  it('section edit sends the whole body with every other section and media id unchanged', async () => {
    const r = await run(['section', 'blog-post', 'post1', '2', '--alt', 'Racks, from the aisle']);
    const sent = puts(r.server)[0].body;
    expect(Object.keys(sent)).toEqual(['body']);
    expect(sent.body).toEqual([
      { __component: 'sections.rich-text', id: 1, content: [para('Intro'), { type: 'heading', level: 2, children: [{ type: 'text', text: 'Racks' }] }] },
      { __component: 'sections.image', id: 2, size: 'wide', image: { id: 3, file: 17, alt: 'Racks, from the aisle', caption: null, decorative: false } },
      { __component: 'sections.model-embed', id: 4, caption: 'The rack' },
    ]);
    expect(r.server.rels['sections.model-embed:4:model']).toEqual(['model9']);
    expect(r.lines).toEqual([
      'section 2: image.alt: "Racks in a row" → "Racks, from the aisle"',
      '  2 image file=17 alt="Racks, from the aisle" size=wide',
      'saved draft post1; the other 2 sections are unchanged',
    ]);
  });
  it('section without options shows the section; rich text as markdown', async () => {
    const r = await run(['section', 'blog-post', 'post1', '1']);
    expect(r.lines).toEqual(['1 rich-text 1 paragraph, 1 heading "Intro Racks"', 'Intro\n\n## Racks']);
  });
  it('section-insert adds a section at the position and the rest keep their order', async () => {
    const r = await run(['section-insert', 'blog-post', 'post1', '2', '--kind', 'rich-text', '--text-file', 'n.md'], fakeServer(), { 'n.md': '## New\n\nText' });
    const sent = puts(r.server)[0].body.body;
    expect(sent.map((s: any) => s.__component)).toEqual(['sections.rich-text', 'sections.rich-text', 'sections.image', 'sections.model-embed']);
    expect(sent[1]).toEqual({ __component: 'sections.rich-text', content: markdownToBlocks('## New\n\nText') });
    expect(r.lines[0]).toBe('inserted section 2:');
    expect(r.out).toMatch(/4 sections, the others unchanged/);
  });
  it('section-move reorders and keeps each section relation with its section', async () => {
    const r = await run(['section-move', 'blog-post', 'post1', '3', '1']);
    expect(puts(r.server)[0].body.body.map((s: any) => s.id)).toEqual([4, 1, 2]);
    expect(r.lines.slice(1)).toEqual([
      '  1 model-embed model=model9 caption="The rack"',
      '  2 rich-text 1 paragraph, 1 heading "Intro Racks"',
      '  3 image file=17 alt="Racks in a row" size=wide',
    ]);
  });
  it('verify-after-write: an unexpected change elsewhere aborts with VerifyError and keeps a backup', async () => {
    const tamperBody = fakeServer({ tamper: (d) => (d.body[0].content = [para('changed by someone else')]) });
    const e = await run(['section', 'blog-post', 'post1', '2', '--alt', 'New'], tamperBody).catch((x) => x);
    expect(e).toBeInstanceOf(VerifyError);
    expect(e.message).toMatch(/VERIFY FAILED: .*body section 1 \(rich-text\)/);
    const backup = e.message.match(/saved in (\S+)\.$/)[1];
    const saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
    expect(saved.data.body[0].content).toEqual([para('Intro'), { type: 'heading', level: 2, children: [{ type: 'text', text: 'Racks' }] }]);
    expect(saved.data.tags).toEqual({ set: [{ documentId: 'tagA' }, { documentId: 'tagB' }] });
    fs.rmSync(backup);

    const tamperField = fakeServer({ tamper: (d) => (d.visibility = 'public') });
    await expect(run(['set', 'blog-post', 'post1', 'title=New'], tamperField)).rejects.toThrow(/VERIFY FAILED: .*visibility/);
    const tamperMedia = fakeServer({ tamper: (d) => (d.cover.file = file(6)) });
    await expect(run(['set', 'blog-post', 'post1', 'title=New'], tamperMedia)).rejects.toThrow(/VERIFY FAILED: .*cover/);
    const tamperCount = fakeServer({ tamper: (d) => d.body.pop() });
    await expect(run(['section', 'blog-post', 'post1', '1', '--text-file', 'a.md'], tamperCount, { 'a.md': 'x' })).rejects.toThrow(/body: 2 sections, expected 3/);
    const tamperRel = fakeServer({ tamper: () => undefined });
    tamperRel.rels[`${UID}:post1:tags`] = ['tagA', 'tagB'];
    const origFetch = (tamperRel.client as any).fetchImpl;
    let putDone = false;
    (tamperRel.client as any).fetchImpl = async (url: string, init: RequestInit = {}) => {
      const res = await origFetch(url, init);
      if (init.method === 'PUT') putDone = true;
      if (putDone) tamperRel.rels['sections.model-embed:4:model'] = ['other'];
      return res;
    };
    await expect(run(['set', 'blog-post', 'post1', 'title=New'], tamperRel)).rejects.toThrow(/body section 3 \(model-embed\) relation/);
    for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f));
  });
  it('publish posts to the publish action and reports the status change', async () => {
    const r = await run(['publish', 'blog-post', 'post1', '--yes']);
    expect(r.server.calls.some((c) => c.method === 'POST' && c.url.endsWith('/post1/actions/publish'))).toBe(true);
    expect(r.lines).toEqual(['published post1: draft → published, visibility private', 'note: visibility is private, so the entry stays off the public site']);
  });
  it('never sends the token anywhere but the Authorization header', async () => {
    const r = await run(['get', 'blog-post', 'post1', '--outline']);
    expect(r.server.calls.every((c) => !c.url.includes('tok'))).toBe(true);
  });
});
