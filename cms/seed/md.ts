/**
 * Minimal Markdown → Strapi "blocks" rich-text converter for seed content.
 * Supports: paragraphs, ## / ### headings, "- " and "1. " lists, "> " quotes, **bold**, *italic*, `code`,
 * [links](url). Enough for seed copy; the editor takes over in Strapi afterwards.
 */
export type Inline = { type: 'text'; text: string; bold?: boolean; italic?: boolean; code?: boolean } | { type: 'link'; url: string; children: Inline[] };
export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'list'; format: 'unordered' | 'ordered'; children: { type: 'list-item'; children: Inline[] }[] }
  | { type: 'quote'; children: Inline[] };

export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > last) out.push({ type: 'text', text: src.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**')) out.push({ type: 'text', text: t.slice(2, -2), bold: true });
    else if (t.startsWith('`')) out.push({ type: 'text', text: t.slice(1, -1), code: true });
    else if (t.startsWith('[')) {
      const [, label, url] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push({ type: 'link', url, children: [{ type: 'text', text: label }] });
    } else out.push({ type: 'text', text: t.slice(1, -1), italic: true });
    last = m.index! + t.length;
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
  return out.length ? out : [{ type: 'text', text: '' }];
}

export function md(src: string): Block[] {
  const blocks: Block[] = [];
  const paras = src.trim().split(/\n\s*\n/);
  for (const p of paras) {
    const lines = p.split('\n').map((l) => l.trim());
    const h = lines[0].match(/^(#{2,4}) (.*)$/);
    if (h && lines.length === 1) {
      blocks.push({ type: 'heading', level: h[1].length, children: inline(h[2]) });
    } else if (lines.every((l) => l.startsWith('- '))) {
      blocks.push({ type: 'list', format: 'unordered', children: lines.map((l) => ({ type: 'list-item', children: inline(l.slice(2)) })) });
    } else if (lines.every((l) => /^\d+\. /.test(l))) {
      blocks.push({ type: 'list', format: 'ordered', children: lines.map((l) => ({ type: 'list-item', children: inline(l.replace(/^\d+\. /, '')) })) });
    } else if (lines.every((l) => l.startsWith('> '))) {
      blocks.push({ type: 'quote', children: inline(lines.map((l) => l.slice(2)).join(' ')) });
    } else {
      blocks.push({ type: 'paragraph', children: inline(lines.join(' ')) });
    }
  }
  return blocks;
}

/** Plain text of blocks (reading time, excerpts, lint). */
export function blocksText(blocks: Block[]): string {
  const t = (c: any): string => (c.type === 'text' ? c.text : (c.children ?? []).map(t).join(''));
  return blocks.map((b: any) => (b.children ?? []).map(t).join(' ')).join('\n');
}
