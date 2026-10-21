import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkUrl,
  detectMime,
  expandFiles,
  looksInternal,
  MAX_BYTES,
  findFolder,
  parseArgs,
  parseFolderPath,
  planFile,
  privacyHits,
  readEnv,
  resolveFolder,
  selectRoute,
  slugify,
  stripJpeg,
  stripPng,
  uploadOne,
  UsageError,
  type FolderNode,
  type Term,
} from '../scripts/lib/media-upload';

// Synthetic terms only: the real private lists never appear in a public test file.
const terms: Term[] = [
  { re: /zz[ _-]?private[ _-]?canary/i, kind: 'PRIVACY', index: 1 },
  { re: /\bzzipc\b/i, kind: 'IP', index: 2 },
];

// --- tiny synthetic files -------------------------------------------------------------------------------------------
const seg = (marker: number, payload: Buffer) => {
  const h = Buffer.alloc(4);
  h[0] = 0xff;
  h[1] = marker;
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
};
/** EXIF (big-endian TIFF) with one IFD entry: Orientation = o, plus a fake GPS marker string. */
const exif = (o: number) => {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(o, 18);
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from('GPS-SECRET', 'latin1')]);
};
const jpeg = (orientation = 1) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, exif(orientation)),
    seg(0xe2, Buffer.from('ICC_PROFILE\0keep', 'latin1')),
    seg(0xfe, Buffer.from('comment', 'latin1')),
    seg(0xdb, Buffer.alloc(65, 1)),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xaa, 0xbb, 0xff, 0xd9]),
  ]);
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    chunk('tEXt', Buffer.from('Author\0someone', 'latin1')),
    chunk('eXIf', Buffer.from('MM', 'latin1')),
    chunk('IDAT', Buffer.alloc(10, 7)),
    chunk('IEND', Buffer.alloc(0)),
  ]);

let dir: string;
const put = (name: string, data: Buffer) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, data);
  return f;
};
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-upload-test-'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const opts = (argv: string[]) => parseArgs(argv);
const one = { n: 1, of: 1 };

describe('parseArgs', () => {
  it('reads files and flags in any order, with spaces or =', () => {
    const o = parseArgs(['a.png', '--alt', 'Racks in a row', '--caption=Cold aisle', 'b.jpg', '--dry-run', '--name', 'racks']);
    expect(o).toMatchObject({ files: ['a.png', 'b.jpg'], alt: 'Racks in a row', caption: 'Cold aisle', name: 'racks', dryRun: true, force: false, decorative: false });
  });
  it('requires alt text unless decorative', () => {
    expect(() => parseArgs(['a.png'])).toThrow(/--alt is required/);
    expect(() => parseArgs(['a.png', '--alt', '   '])).toThrow(/--alt is required/);
    expect(parseArgs(['a.png', '--decorative']).decorative).toBe(true);
    expect(() => parseArgs(['a.png', '--decorative', '--alt', 'x'])).toThrow(/drop one/);
  });
  it('rejects unknown options, missing values and no files', () => {
    expect(() => parseArgs(['a.png', '--alt', 'x', '--bogus'])).toThrow(UsageError);
    expect(() => parseArgs(['a.png', '--alt'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--alt', 'x'])).toThrow(/no files/);
    expect(() => parseArgs(['a.png', '--alt', 'x', '--name', '!!!'])).toThrow(/--name/);
  });
  it('reads --folder as a normalised path and --create-folder only with it', () => {
    expect(parseArgs(['a.png', '--alt', 'x', '--folder', ' /Blog/ Server rack post /']).folder).toBe('Blog/Server rack post');
    expect(parseArgs(['a.png', '--alt', 'x', '--folder=Blog', '--create-folder'])).toMatchObject({ folder: 'Blog', createFolder: true });
    expect(parseArgs(['a.png', '--alt', 'x']).createFolder).toBe(false);
    expect(() => parseArgs(['a.png', '--alt', 'x', '--create-folder'])).toThrow(/--create-folder needs --folder/);
    expect(() => parseArgs(['a.png', '--alt', 'x', '--folder', 'Blog//Post'])).toThrow(UsageError);
    expect(() => parseArgs(['a.png', '--alt', 'x', '--folder', '/'])).toThrow(UsageError);
    expect(parseFolderPath('Blog/Server rack post')).toEqual(['Blog', 'Server rack post']);
  });
  it('--help needs nothing else', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('name hygiene', () => {
  it('slugifies to lowercase hyphenated ASCII', () => {
    expect(slugify('  Café Racks: the COLD aisle!  ')).toBe('cafe-racks-the-cold-aisle');
    expect(slugify('a_b__c')).toBe('a-b-c');
    const long = slugify('word '.repeat(30));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('-')).toBe(false);
  });
  it('flags internal work-item names', () => {
    for (const n of ['plan-3-task-2', 'Task_7', 'shot-t12c', 'wip', 'final-audit', 'ruling-4', 'floor plan']) expect(looksInternal(n), n).toBe(true);
    for (const n of ['server-racks', 'planet-surface', 'tasks', 'twelve', 'cold-aisle-2']) expect(looksInternal(n), n).toBe(false);
  });
});

describe('type checks', () => {
  it('accepts matching images and videos', () => {
    expect(detectMime('a.png', png())).toBe('image/png');
    expect(detectMime('a.JPEG', jpeg())).toBe('image/jpeg');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(8)]);
    expect(detectMime('a.mp4', mp4)).toBe('video/mp4');
    expect(detectMime('a.mov', mp4)).toBe('video/quicktime');
  });
  it('refuses other types and mismatches', () => {
    expect(() => detectMime('a.svg', Buffer.from('<svg/>'))).toThrow(/only images and videos/);
    expect(() => detectMime('a.pdf', Buffer.from('%PDF-1.7'))).toThrow(/only images and videos/);
    expect(() => detectMime('a.png', Buffer.from('#!/bin/sh\necho'))).toThrow(/not a recognised/);
    expect(() => detectMime('a.png', jpeg())).toThrow(/content is image\/jpeg/);
  });
});

describe('metadata stripping', () => {
  it('drops EXIF and comments from a JPEG, keeps JFIF, ICC and the image data', () => {
    const src = jpeg();
    const { out, removed, orientation } = stripJpeg(src);
    expect(removed).toBe(2);
    expect(orientation).toBe(1);
    expect(out.includes(Buffer.from('Exif'))).toBe(false);
    expect(out.includes(Buffer.from('GPS-SECRET'))).toBe(false);
    expect(out.includes(Buffer.from('comment'))).toBe(false);
    expect(out.includes(Buffer.from('JFIF'))).toBe(true);
    expect(out.includes(Buffer.from('ICC_PROFILE'))).toBe(true);
    expect(out.subarray(-14).equals(src.subarray(-14))).toBe(true);
  });
  it('reports the EXIF orientation', () => {
    expect(stripJpeg(jpeg(6)).orientation).toBe(6);
  });
  it('drops PNG text and EXIF chunks', () => {
    const { out, removed } = stripPng(png());
    expect(removed).toBe(2);
    expect(out.includes(Buffer.from('tEXt'))).toBe(false);
    expect(out.includes(Buffer.from('eXIf'))).toBe(false);
    expect(out.includes(Buffer.from('IDAT'))).toBe(true);
    expect(out.subarray(-12, -4).toString('latin1').slice(4)).toBe('IEND');
  });
  it('strips a real sharp-made JPEG and it still decodes', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const src: Buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'someone' } })
      .toBuffer();
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const { out, removed } = stripJpeg(src);
    expect(removed).toBeGreaterThan(0);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(8);
  });
  it('drops anything appended after the end of the image', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const img: Buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const { out, removed } = stripJpeg(Buffer.concat([img, Buffer.from('PK\u0003\u0004hidden-zip-SECRET')]));
    expect(removed).toBeGreaterThan(0);
    expect(out.includes(Buffer.from('SECRET'))).toBe(false);
    expect(out.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect((await sharp(out).metadata()).width).toBe(8);
  });
  it('keeps every scan of a progressive JPEG', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const img: Buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#a03020' } }).jpeg({ progressive: true }).toBuffer();
    const { out } = stripJpeg(img);
    expect(out.length).toBe(img.length);
    const px = await sharp(out).raw().toBuffer();
    expect(px.length).toBe(64 * 64 * 3);
  });
  it('refuses a JPEG with no end-of-image marker', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const img: Buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer();
    expect(() => stripJpeg(img.subarray(0, img.length - 2))).toThrow(/end-of-image/);
  });
});

describe('privacy check', () => {
  it('names the kind, field and a tag, never the term or the text', () => {
    const hits = privacyHits({ alt: 'A shot of ZZ-Private-Canary hall', caption: 'fine' }, terms);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^PRIVACY in alt @[0-9a-f]{8} \(term #1\)$/);
    expect(hits[0]).not.toMatch(/canary/i);
  });
  it('matches through file-name separators', () => {
    expect(privacyHits({ 'file name': 'shot_zzipc_01.png' }, terms)).toHaveLength(1);
  });
});

describe('planFile refusals and naming', () => {
  it('names the upload from the alt text and strips metadata', async () => {
    const f = put('IMG_0042.jpg', jpeg());
    const p = await planFile(f, opts([f, '--alt', 'Server racks in the cold aisle']), terms, one);
    expect(p.name).toBe('server-racks-in-the-cold-aisle.jpg');
    expect(p.mime).toBe('image/jpeg');
    expect(p.data.includes(Buffer.from('GPS-SECRET'))).toBe(false);
  });
  it('numbers files in a batch and prefers --name', async () => {
    const f = put('x.png', png());
    const p = await planFile(f, opts([f, '--alt', 'Hall', '--name', 'Overview Shot']), terms, { n: 2, of: 3 });
    expect(p.name).toBe('overview-shot-2.png');
  });
  it('refuses an internal-looking name unless --name is given', async () => {
    const f = put('plan-3-task-2.png', png());
    await expect(planFile(f, opts([f, '--decorative']), terms, one)).rejects.toThrow(/internal work item/);
    await expect(planFile(f, opts([f, '--alt', 'WIP of the hall']), terms, one)).rejects.toThrow(/internal work item/);
    const ok = await planFile(f, opts([f, '--decorative', '--name', 'hall-divider']), terms, one);
    expect(ok.name).toBe('hall-divider.png');
  });
  it('refuses on a privacy hit in the source file name, alt or caption', async () => {
    const f = put('zz-private-canary.png', png());
    await expect(planFile(f, opts([f, '--alt', 'Hall']), terms, one)).rejects.toThrow(/PRIVACY in file name/);
    const g = put('hall.png', png());
    await expect(planFile(g, opts([g, '--alt', 'Hall', '--caption', 'about zzipc']), terms, one)).rejects.toThrow(/IP in caption/);
    await expect(planFile(g, opts([g, '--alt', 'Hall', '--folder', 'Blog/zz private canary']), terms, one)).rejects.toThrow(/PRIVACY in folder/);
  });
  it('refuses files over 20 MB unless --force', async () => {
    const big = put('big.png', Buffer.concat([png(), Buffer.alloc(MAX_BYTES)]));
    await expect(planFile(big, opts([big, '--alt', 'Hall']), terms, one)).rejects.toThrow(/20 MB/);
    await expect(planFile(big, opts([big, '--alt', 'Hall', '--force']), terms, one)).resolves.toBeTruthy();
  });
  it('refuses non-media files', async () => {
    const f = put('notes.txt', Buffer.from('hello'));
    await expect(planFile(f, opts([f, '--alt', 'Notes']), terms, one)).rejects.toThrow(/only images and videos/);
  });
  it('rotates a JPEG with an EXIF orientation via the injected rotator', async () => {
    const f = put('turned.jpg', jpeg(6));
    const rotate = vi.fn(async () => Buffer.from('rotated'));
    const p = await planFile(f, opts([f, '--alt', 'Hall']), terms, one, rotate);
    expect(rotate).toHaveBeenCalledOnce();
    expect(p.data.toString()).toBe('rotated');
    await expect(planFile(f, opts([f, '--alt', 'Hall']), terms, one)).rejects.toThrow(/rotation/);
  });
});

describe('files, url and env', () => {
  it('expands globs and rejects missing files', () => {
    put('g1.png', png());
    put('g2.png', png());
    expect(expandFiles(['g*.png'], dir).map((f) => path.basename(f))).toEqual(['g1.png', 'g2.png']);
    expect(() => expandFiles(['nope.png'], dir)).toThrow(/not a file/);
    expect(() => expandFiles(['zz*.webp'], dir)).toThrow(/no files match/);
  });
  it('allows http only on localhost', () => {
    expect(checkUrl('https://cms.rioku.dev/')).toBe('https://cms.rioku.dev');
    expect(checkUrl('http://localhost:1337')).toBe('http://localhost:1337');
    expect(() => checkUrl('http://cms.example.com')).toThrow(/https/);
  });
  it('reads only the three keys from cms/.env; the environment wins', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'APP_KEYS=secret\nSTRAPI_UPLOAD_TOKEN="from-file"\nSTRAPI_ADMIN_TOKEN=admin-from-file\n');
    expect(readEnv(dir, {})).toStrictEqual({ url: 'https://cms.rioku.dev', token: 'from-file', adminToken: 'admin-from-file' });
    expect(readEnv(dir, { STRAPI_UPLOAD_TOKEN: 'from-env', STRAPI_ADMIN_TOKEN: 'admin-env', STRAPI_URL: 'http://localhost:1337' })).toStrictEqual({
      url: 'http://localhost:1337',
      token: 'from-env',
      adminToken: 'admin-env',
    });
    fs.rmSync(path.join(dir, '.env'));
    expect(readEnv(dir, {})).toStrictEqual({ url: 'https://cms.rioku.dev', token: undefined, adminToken: undefined });
  });
});

describe('route selection', () => {
  const noFolder = { dryRun: false };
  it('uses the admin route whenever STRAPI_ADMIN_TOKEN is set, even with an upload token', () => {
    expect(selectRoute({ url: 'x', adminToken: 'adm' }, noFolder)).toEqual({ kind: 'admin', token: 'adm' });
    expect(selectRoute({ url: 'x', adminToken: 'adm', token: 'api' }, noFolder)).toEqual({ kind: 'admin', token: 'adm' });
    expect(selectRoute({ url: 'x', adminToken: 'adm' }, { dryRun: false, folder: 'Blog' })).toEqual({ kind: 'admin', token: 'adm' });
  });
  it('falls back to the Content API with STRAPI_UPLOAD_TOKEN', () => {
    expect(selectRoute({ url: 'x', token: 'api' }, noFolder)).toEqual({ kind: 'content', token: 'api' });
  });
  it('refuses --folder on the Content API path, even in a dry run', () => {
    expect(() => selectRoute({ url: 'x', token: 'api' }, { dryRun: false, folder: 'Blog' })).toThrow(/--folder needs STRAPI_ADMIN_TOKEN/);
    expect(() => selectRoute({ url: 'x' }, { dryRun: true, folder: 'Blog' })).toThrow(UsageError);
  });
  it('needs some token unless it is a dry run', () => {
    expect(() => selectRoute({ url: 'x' }, noFolder)).toThrow(/neither STRAPI_ADMIN_TOKEN nor STRAPI_UPLOAD_TOKEN/);
    expect(selectRoute({ url: 'x' }, { dryRun: true })).toEqual({ kind: 'content', token: undefined });
  });
});

describe('folders', () => {
  const tree: FolderNode[] = [
    { id: 1, name: 'API Uploads', children: [] },
    {
      id: 2,
      name: 'Blog',
      children: [
        { id: 3, name: 'Server rack post', children: [] },
        { id: 4, name: 'Cold aisle', children: [] },
      ],
    },
  ];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  /** Mock admin API: GET folder-structure returns `tree`; POST /upload/folders hands out ids from 100. */
  const server = (t: FolderNode[] = tree) => {
    let next = 100;
    return vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/upload/folder-structure') && init.method === 'GET') return json({ data: t });
      if (url.endsWith('/upload/folders') && init.method === 'POST') {
        const b = JSON.parse(init.body as string);
        return json({ data: { id: next++, name: b.name, parent: b.parent } }, 201);
      }
      return json({ error: { message: 'Not Found' } }, 404);
    });
  };

  it('finds a folder by its name path, exact first, then a single case-insensitive match', () => {
    expect(findFolder(tree, ['Blog', 'Server rack post'])).toMatchObject({ found: 2, node: { id: 3 } });
    expect(findFolder(tree, ['blog', 'COLD AISLE'])).toMatchObject({ found: 2, node: { id: 4 } });
    expect(findFolder(tree, ['Blog', 'Nope'])).toMatchObject({ found: 1, node: { id: 2 } });
    expect(findFolder(tree, ['Nope'])).toMatchObject({ found: 0, node: undefined });
    const twins = [{ id: 8, name: 'Blog' }, { id: 9, name: 'BLOG' }];
    expect(findFolder(twins, ['blog']).found).toBe(0);
  });
  it('resolves an existing folder with one authenticated GET and creates nothing', async () => {
    const f = server();
    const r = await resolveFolder('http://localhost:1337', 'adm', 'Blog/Server rack post', { create: false, dryRun: false }, f as any);
    expect(r).toEqual({ id: 3, path: 'Blog/Server rack post', created: [], wouldCreate: [] });
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://localhost:1337/upload/folder-structure');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer adm');
  });
  it('refuses a missing folder without --create-folder and lists the nearby folders', async () => {
    const f = server();
    const err = resolveFolder('http://localhost:1337', 'adm', 'Blog/Test', { create: false, dryRun: false }, f as any);
    await expect(err).rejects.toThrow(/folder "Blog\/Test" not found: "Blog" has no "Test"\. Folders in "Blog": "Cold aisle", "Server rack post"\. Pass --create-folder/);
    await expect(resolveFolder('http://localhost:1337', 'adm', 'Media', { create: false, dryRun: false }, f as any)).rejects.toThrow(
      /the Media Library root has no "Media"\. Folders in the Media Library root: "API Uploads", "Blog"/,
    );
    expect(f.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('creates each missing level under the right parent with --create-folder', async () => {
    const f = server();
    const r = await resolveFolder('http://localhost:1337', 'adm', 'Blog/Test/Shots', { create: true, dryRun: false }, f as any);
    expect(r).toEqual({ id: 101, path: 'Blog/Test/Shots', created: ['Blog/Test', 'Blog/Test/Shots'], wouldCreate: [] });
    const posts = f.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(posts.map(([url]) => url)).toEqual(['http://localhost:1337/upload/folders', 'http://localhost:1337/upload/folders']);
    expect(posts.map(([, init]) => JSON.parse(init.body as string))).toEqual([{ name: 'Test', parent: 2 }, { name: 'Shots', parent: 100 }]);
    expect((posts[0][1].headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
  it('reports the folder names as stored, whatever case was typed', async () => {
    const r = await resolveFolder('http://localhost:1337', 'adm', 'blog/server RACK post', { create: false, dryRun: false }, server() as any);
    expect(r).toMatchObject({ id: 3, path: 'Blog/Server rack post' });
    const c = await resolveFolder('http://localhost:1337', 'adm', 'blog/New one', { create: true, dryRun: true }, server() as any);
    expect(c).toMatchObject({ path: 'Blog/New one', wouldCreate: ['Blog/New one'] });
    await expect(resolveFolder('http://localhost:1337', 'adm', 'Blog', { create: false, dryRun: false }, server([]) as any)).rejects.toThrow(
      /There are no folders in the Media Library root\./,
    );
  });
  it('creates a top-level folder with a null parent', async () => {
    const f = server([]);
    const r = await resolveFolder('http://localhost:1337', 'adm', 'Blog', { create: true, dryRun: false }, f as any);
    expect(r.id).toBe(100);
    expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string)).toEqual({ name: 'Blog', parent: null });
  });
  it('a dry run with --create-folder only reports what it would create', async () => {
    const f = server();
    const r = await resolveFolder('http://localhost:1337', 'adm', 'Blog/Test', { create: true, dryRun: true }, f as any);
    expect(r).toEqual({ path: 'Blog/Test', created: [], wouldCreate: ['Blog/Test'] });
    expect(f).toHaveBeenCalledOnce();
  });
  it('explains a 401 and a 403 from the folder routes without echoing the token', async () => {
    const deny = (status: number) => vi.fn(async () => json({ error: { message: status === 401 ? 'Unauthorized' : 'Forbidden' } }, status));
    const e401 = await resolveFolder('https://cms.rioku.dev', 'secret-token', 'Blog', { create: false, dryRun: false }, deny(401) as any).catch((e) => e);
    expect(e401.message).toMatch(/HTTP 401 Unauthorized \(admin token rejected/);
    expect(e401.message).not.toMatch(/secret-token/);
    await expect(resolveFolder('https://cms.rioku.dev', 'secret-token', 'Blog', { create: false, dryRun: false }, deny(403) as any)).rejects.toThrow(
      /HTTP 403 Forbidden \(the admin token lacks a Media Library permission/,
    );
  });
});

describe('uploadOne request', () => {
  const file = { name: 'server-racks.png', mime: 'image/png', data: png() };
  it('sends one multipart POST with the file and fileInfo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify([{ id: 7, documentId: 'abc', url: '/uploads/server_racks_123.png', name: 'server-racks.png', mime: 'image/png', size: 0.1 }]), { status: 201 }),
    );
    const up = await uploadOne('http://localhost:1337', 'tok', file, { alternativeText: 'Server racks', caption: 'Cold aisle' }, fetchMock as any);
    expect(up).toMatchObject({ id: 7, documentId: 'abc', url: 'http://localhost:1337/uploads/server_racks_123.png', name: 'server-racks.png' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1337/api/upload');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const form = init.body as FormData;
    const sent = form.get('files') as File;
    expect(sent.name).toBe('server-racks.png');
    expect(sent.type).toBe('image/png');
    expect(Buffer.from(await sent.arrayBuffer()).equals(file.data)).toBe(true);
    expect(JSON.parse(form.get('fileInfo') as string)).toEqual({ name: 'server-racks.png', alternativeText: 'Server racks', caption: 'Cold aisle' });
    expect([...form.keys()].sort()).toEqual(['fileInfo', 'files']);
  });
  it('omits an empty caption and keeps absolute URLs', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 1, documentId: 'd', url: 'https://cdn.example/x.png', name: 'x.png' }]), { status: 201 }));
    const up = await uploadOne('https://cms.rioku.dev', 'tok', file, { alternativeText: '' }, fetchMock as any);
    expect(up.url).toBe('https://cdn.example/x.png');
    const form = (fetchMock.mock.calls[0] as any)[1].body as FormData;
    expect(JSON.parse(form.get('fileInfo') as string)).toEqual({ name: 'server-racks.png', alternativeText: '' });
  });
  it('surfaces the Strapi error message', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 }));
    await expect(uploadOne('https://cms.rioku.dev', 'tok', file, { alternativeText: 'x' }, fetchMock as any)).rejects.toThrow(/HTTP 403 Forbidden/);
  });
  it('admin route: POST /upload with the admin token and fileInfo.folder, as the Media Library UI sends it', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify([{ id: 9, documentId: 'adm1', url: '/uploads/server_racks_9.png', name: 'server-racks.png', mime: 'image/png', size: 0.1 }]), { status: 201 }),
    );
    const up = await uploadOne('http://localhost:1337', 'adm', file, { alternativeText: 'Server racks', caption: 'Cold aisle', folder: 3 }, fetchMock as any, 'admin');
    expect(up).toMatchObject({ id: 9, documentId: 'adm1', url: 'http://localhost:1337/uploads/server_racks_9.png' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1337/upload');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer adm');
    const form = init.body as FormData;
    expect([...form.keys()].sort()).toEqual(['fileInfo', 'files']);
    expect(form.getAll('files')).toHaveLength(1);
    const sent = form.get('files') as File;
    expect(sent.name).toBe('server-racks.png');
    expect(Buffer.from(await sent.arrayBuffer()).equals(file.data)).toBe(true);
    expect(JSON.parse(form.get('fileInfo') as string)).toEqual({ name: 'server-racks.png', alternativeText: 'Server racks', caption: 'Cold aisle', folder: 3 });
  });
  it('admin route without a folder sends no folder field', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 1, url: '/uploads/x.png', name: 'x.png' }]), { status: 201 }));
    await uploadOne('http://localhost:1337', 'adm', file, { alternativeText: 'x' }, fetchMock as any, 'admin');
    const form = (fetchMock.mock.calls[0] as any)[1].body as FormData;
    expect(JSON.parse(form.get('fileInfo') as string)).toEqual({ name: 'server-racks.png', alternativeText: 'x' });
  });
  it('the Content API path refuses a folder and sends nothing', async () => {
    const fetchMock = vi.fn();
    await expect(uploadOne('http://localhost:1337', 'api', file, { alternativeText: 'x', folder: 3 }, fetchMock as any, 'content')).rejects.toThrow(/cannot file uploads into a folder/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('admin route explains a 403', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 }));
    await expect(uploadOne('http://localhost:1337', 'adm', file, { alternativeText: 'x' }, fetchMock as any, 'admin')).rejects.toThrow(/lacks a Media Library permission/);
  });
});
