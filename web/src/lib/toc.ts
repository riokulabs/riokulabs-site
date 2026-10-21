import type { Section } from './types';
import { headingId, plain } from './richtext';

export interface TocItem { id: string; text: string; level: 2 | 3 }

/** h2/h3 headings from rich-text sections, in order (SPEC §4.5). */
export function toc(body: Section[]): TocItem[] {
  const items: TocItem[] = [];
  for (const s of body) {
    if (s.type !== 'rich-text') continue;
    for (const b of s.content) {
      if (b.type === 'heading' && (b.level === 2 || b.level === 3)) items.push({ id: headingId(plain(b)), text: plain(b), level: b.level });
    }
  }
  return items;
}
