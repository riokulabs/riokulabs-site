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
  parseArgs,
  planFile,
  privacyHits,
  readEnv,
  slugify,
  stripJpeg,
  stripPng,
  uploadOne,
  UsageError,
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
  it('rejects unknown options, missing values, no files and --folder', () => {
    expect(() => parseArgs(['a.png', '--alt', 'x', '--bogus'])).toThrow(UsageError);
    expect(() => parseArgs(['a.png', '--alt'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--alt', 'x'])).toThrow(/no files/);
    expect(() => parseArgs(['a.png', '--alt', 'x', '--folder', 'Blog'])).toThrow(/media_move_assets/);
    expect(() => parseArgs(['a.png', '--alt', 'x', '--name', '!!!'])).toThrow(/--name/);
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
  it('reads only the two keys from cms/.env; the environment wins', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'APP_KEYS=secret\nSTRAPI_UPLOAD_TOKEN="from-file"\n');
    expect(readEnv(dir, {})).toEqual({ url: 'https://cms.rioku.dev', token: 'from-file' });
    expect(readEnv(dir, { STRAPI_UPLOAD_TOKEN: 'from-env', STRAPI_URL: 'http://localhost:1337' })).toEqual({ url: 'http://localhost:1337', token: 'from-env' });
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
});
