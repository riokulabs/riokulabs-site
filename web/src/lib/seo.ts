/** Props of components/Seo.astro (shared with layouts/Base.astro). */
export interface SeoProps {
  title?: string;
  description?: string;
  path: string;
  ogPath?: string;
  ogAlt?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  publishedTime?: string;
  modifiedTime?: string;
}

/**
 * Meta description of at most `max` characters. Longer text is cut at the last word boundary that leaves room for an
 * ellipsis, with trailing punctuation dropped, so search results never show half a word.
 */
export function metaDescription(text: string, max = 160): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1); // one character is kept for the ellipsis
  const space = room.lastIndexOf(' ');
  const cut = s[max - 1] === ' ' ? room : space > 0 ? room.slice(0, space) : room;
  const out = (cut || room).replace(/[\s,;:.\-–—]+$/, '');
  return `${out || room}…`;
}
