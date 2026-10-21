import { describe, expect, it } from 'vitest';
import { renderBlocks } from '../../src/lib/richtext';

const para = (text: string, extra: Record<string, unknown> = {}) => [{ type: 'paragraph', children: [{ type: 'text', text, ...extra }] }];

describe('renderBlocks', () => {
  it('keeps line breaks inside a paragraph', () => {
    expect(renderBlocks(para('one\n\ntwo\r\nthree'))).toBe('<p>one<br><br>two<br>three</p>');
  });

  it('escapes text before adding breaks', () => {
    expect(renderBlocks(para('<b>\n&'))).toBe('<p>&lt;b&gt;<br>&amp;</p>');
  });

  it('keeps breaks inside marks', () => {
    expect(renderBlocks(para('a\nb', { bold: true }))).toBe('<p><strong>a<br>b</strong></p>');
  });
});
