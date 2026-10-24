/** Dev log feed (SPEC §9): the 30 newest public posts, full HTML of the text sections, cover as enclosure. */
import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { absolute, categoryName, listedPosts, site, tagName } from '../lib/site';
import { renderBlocks } from '../lib/richtext';
import { meta } from '../lib/images';
import { feedDescription, imageMime } from '../lib/feeds';
import type { Section } from '../lib/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function contentHtml(body: Section[]): string {
  return body
    .map((s) => {
      if (s.type === 'rich-text') return renderBlocks(s.content);
      if (s.type === 'callout') return `<p><strong>${esc(s.title ?? s.tone)}</strong></p>${renderBlocks(s.body)}`;
      if (s.type === 'quote') return `<blockquote><p>${esc(s.text)}</p></blockquote>`;
      if (s.type === 'code') return `<pre><code>${esc(s.code)}</code></pre>`;
      if (s.type === 'stat-grid') return `<ul>${s.stats.map((x) => `<li><strong>${esc(x.value)}</strong> ${esc(x.label)}</li>`).join('')}</ul>`;
      return '';
    })
    .join('\n')
    .replace(/href="\//g, `href="${absolute('/')}/`);
}

export const GET: APIRoute = async (context) => {
  const s = site();
  const posts = listedPosts().slice(0, 30);
  const items = await Promise.all(
    posts.map(async (p) => {
      // Enclosure = the original cover image (emitted by Astro as an imported asset), with its real byte length.
      // Spoiler posts: the feed carries only the title and a pointer, so readers still meet the warning first.
      if (p.spoiler) return { title: `Spoiler: ${p.title}`, link: `/blog/${p.slug}`, pubDate: new Date(p.date), description: s.copy.spoilerNotice.summary, categories: ['Spoilers'] };
      const cover = p.cover ? { src: meta(p.cover).src.split('?')[0], length: fs.statSync(path.resolve('src/assets/cms', p.cover.src)).size, type: imageMime(p.cover) } : undefined;
      return {
        title: p.title,
        link: `/blog/${p.slug}`,
        pubDate: new Date(p.date),
        description: p.excerpt,
        content: contentHtml(p.body),
        categories: [categoryName(p.category), ...p.tags.map(tagName)].filter(Boolean) as string[],
        ...(cover ? { enclosure: { url: absolute(cover.src), length: cover.length, type: cover.type } } : {}),
      };
    }),
  );
  return rss({
    title: `${s.settings.siteName}: dev log`,
    // Never empty: an unset CMS description must not fail scripts/validate-feeds.ts (and with it the deploy).
    description: feedDescription(s.settings),
    site: context.site!,
    items,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: `<language>en-us</language><atom:link href="${new URL('/rss.xml', context.site).href}" rel="self" type="application/rss+xml"/>`,
    trailingSlash: false,
  });
};
