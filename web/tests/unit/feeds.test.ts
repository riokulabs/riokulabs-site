import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_DESCRIPTION, feedDescription, imageMime } from '../../src/lib/feeds';

describe('feed channel description', () => {
  it('uses the site description when set', () => {
    expect(feedDescription({ description: ' Game mods. ', defaultSeo: { metaDescription: 'SEO text' } })).toBe('Game mods.');
  });
  it('falls back to the default SEO description, then to a constant (empty CMS field must not break the deploy)', () => {
    expect(feedDescription({ description: '', defaultSeo: { metaDescription: 'SEO text' } })).toBe('SEO text');
    expect(feedDescription({ description: '   ', defaultSeo: { metaDescription: '' } })).toBe(DEFAULT_SITE_DESCRIPTION);
    expect(feedDescription({ description: '', defaultSeo: undefined })).toBe(DEFAULT_SITE_DESCRIPTION);
    expect(feedDescription(undefined)).toBe(DEFAULT_SITE_DESCRIPTION);
  });
  it('the constant is non-empty and names the studio', () => {
    expect(DEFAULT_SITE_DESCRIPTION).toMatch(/Rioku Labs/);
  });
});

describe('enclosure MIME type', () => {
  it("uses the media file's own type", () => {
    expect(imageMime({ src: 'strapi/a.jpg', mime: 'image/png' })).toBe('image/png');
    expect(imageMime({ src: 'strapi/a', mime: 'image/WebP' })).toBe('image/webp');
  });
  it('guesses from the extension when the CMS gave none (or something that is not an image type)', () => {
    expect(imageMime({ src: 'strapi/a.png' })).toBe('image/png');
    expect(imageMime({ src: 'strapi/a.JPEG' })).toBe('image/jpeg');
    expect(imageMime({ src: 'strapi/a.webp', mime: 'video/mp4' })).toBe('image/webp');
    expect(imageMime({ src: 'strapi/a.avif', mime: '' })).toBe('image/avif');
  });
  it('never claims JPEG for an unknown file', () => {
    expect(imageMime({ src: 'strapi/a.bin' })).toBe('application/octet-stream');
  });
});
