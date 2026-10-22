/**
 * The e2e `test`: Playwright's, with YouTube's hosts cut off for every page, so a run never reaches YouTube (the
 * youtube-embed fixture loads a player iframe). Frame documents get a small local stand-in page so the frame still
 * loads (axe can scan it); every other request to those hosts is aborted.
 */
import { test as base, expect } from '@playwright/test';

export const YOUTUBE_HOSTS = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|ggpht\.com)(:\d+)?\//i;

const STAND_IN = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Video player (blocked in tests)</title></head><body></body></html>';

export const test = base.extend<{ blockYouTube: string[] }>({
  /** URLs of the blocked YouTube requests, in order. */
  blockYouTube: [
    async ({ context }, use) => {
      const seen: string[] = [];
      await context.route(YOUTUBE_HOSTS, (route) => {
        seen.push(route.request().url());
        return route.request().resourceType() === 'document'
          ? route.fulfill({ status: 200, contentType: 'text/html', body: STAND_IN })
          : route.abort('blockedbyclient');
      });
      await use(seen);
    },
    { auto: true },
  ],
});

export { expect };
