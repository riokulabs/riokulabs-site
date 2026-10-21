/**
 * Offline RSS 2.0 checks for dist/rss.xml and dist/mods/releases.xml (the W3C validator needs the live URL, M9):
 * well-formed XML (xmllint), required channel/item elements, absolute links, unique guids, RFC 822 dates,
 * atom:link rel=self, content:encoded namespace when used, enclosure with a real length and type.
 *   npx tsx scripts/validate-feeds.ts
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const errors: string[] = [];
for (const file of ['dist/rss.xml', 'dist/mods/releases.xml']) {
  const xml = fs.readFileSync(file, 'utf8');
  try { execFileSync('xmllint', ['--noout', file], { stdio: 'pipe' }); } catch (e: any) { errors.push(`${file}: not well-formed: ${e.stderr}`); continue; }
  const need = (re: RegExp, what: string) => { if (!re.test(xml)) errors.push(`${file}: missing ${what}`); };
  need(/^<\?xml version="1.0" encoding="UTF-8"\?>/, 'XML declaration');
  need(/<rss version="2.0"/, 'rss version 2.0');
  need(/<channel><title>[^<]+<\/title>/, 'channel title');
  need(/<channel>[\s\S]*<link>https:\/\/[^<]+<\/link>/, 'channel link');
  need(/<channel>[\s\S]*<description>[^<]+<\/description>/, 'channel description');
  need(/<atom:link href="https:\/\/[^"]+" rel="self" type="application\/rss\+xml"\/>/, 'atom:link rel=self');
  if (xml.includes('<content:encoded>')) need(/xmlns:content="http:\/\/purl.org\/rss\/1.0\/modules\/content\/"/, 'content namespace');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const guids = new Set<string>();
  for (const it of items) {
    const title = it.match(/<title>([^<]*)<\/title>/)?.[1];
    const link = it.match(/<link>([^<]*)<\/link>/)?.[1];
    const guid = it.match(/<guid[^>]*>([^<]*)<\/guid>/)?.[1];
    const date = it.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1];
    if (!title) errors.push(`${file}: item without title`);
    if (!link || !/^https:\/\//.test(link)) errors.push(`${file}: item link not absolute: ${link}`);
    if (!guid || guids.has(guid)) errors.push(`${file}: missing/duplicate guid ${guid}`);
    guids.add(guid!);
    if (!date || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(date)) errors.push(`${file}: bad pubDate ${date}`);
    const enc = it.match(/<enclosure url="([^"]+)" length="(\d+)" type="([^"]+)"\/>/);
    if (it.includes('<enclosure') && (!enc || enc[2] === '0' || !/^https:\/\//.test(enc[1]))) errors.push(`${file}: bad enclosure in "${title}"`);
  }
  console.log(`${file}: ${items.length} item(s)`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('validate-feeds: OK');
