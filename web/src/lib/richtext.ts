/** Strapi "blocks" rich text → HTML (escaped). Heading ids match lib/toc.ts so the TOC links work. */
import type { RichBlocks } from './types';
import identity from '../config/identity.json';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const headingId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';

export const plain = (node: any): string => (node?.type === 'text' ? node.text : (node?.children ?? []).map(plain).join(''));

function inline(nodes: any[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'link') {
        const url = String(n.url ?? '');
        const safe = /^(https?:|mailto:|\/|#)/i.test(url) ? url : '#';
        const ext = /^https?:/i.test(safe) && !safe.toLowerCase().startsWith(`https://${identity.domain}`);
        return `<a href="${esc(safe)}"${ext ? ' rel="noopener"' : ''}>${inline(n.children)}</a>`;
      }
      if (n.type !== 'text') return inline(n.children);
      // Shift+Enter in the Strapi editor stores a line break as "\n" inside the text.
      let t = esc(n.text ?? '').replace(/\r?\n/g, '<br>');
      if (n.code) t = `<code>${t}</code>`;
      if (n.bold) t = `<strong>${t}</strong>`;
      if (n.italic) t = `<em>${t}</em>`;
      if (n.underline) t = `<u>${t}</u>`;
      if (n.strikethrough) t = `<s>${t}</s>`;
      return t;
    })
    .join('');
}

function list(b: any): string {
  const tag = b.format === 'ordered' ? 'ol' : 'ul';
  const items = (b.children ?? []).map((li: any) => (li.type === 'list' ? list(li) : `<li>${inline(li.children)}</li>`)).join('');
  return `<${tag}>${items}</${tag}>`;
}

/** @param shift heading level offset (e.g. 0 keeps h2 as h2). Levels are clamped to h2..h4 (one h1 per page). */
export function renderBlocks(blocks: RichBlocks = [], shift = 0): string {
  return blocks
    .map((b: any) => {
      switch (b.type) {
        case 'paragraph': {
          const html = inline(b.children);
          return html.trim() ? `<p>${html}</p>` : '';
        }
        case 'heading': {
          const lvl = Math.min(4, Math.max(2, (b.level ?? 2) + shift));
          return `<h${lvl} id="${headingId(plain(b))}">${inline(b.children)}</h${lvl}>`;
        }
        case 'list': return list(b);
        case 'quote': return `<blockquote><p>${inline(b.children)}</p></blockquote>`;
        case 'code': return `<pre><code>${esc(plain(b))}</code></pre>`;
        default: return '';
      }
    })
    .join('\n');
}
