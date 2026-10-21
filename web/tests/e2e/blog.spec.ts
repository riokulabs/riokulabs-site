import { expect, test } from '@playwright/test';

test('a post using every section type renders each one (fixture: section-test-bench)', async ({ page }) => {
  await page.goto('/blog/section-test-bench');
  const body = page.locator('.post__body');
  await expect(body.locator('.prose h2')).toHaveText(['Rich text']);
  await expect(body.locator('.prose h3')).toHaveText(['A third-level heading']);
  await expect(body.locator('.prose strong, .prose em, .prose code, .prose a, .prose ul, .prose ol, .prose blockquote')).toHaveCount(7);
  await expect(body.locator('figure.frame.sec-media--inline:not(.loop) picture')).toHaveCount(1); // image
  await expect(body.locator('.gallery__item')).toHaveCount(2); // gallery
  await expect(body.locator('figure.loop video[data-loop]')).toHaveCount(2); // loop-video + model-embed turntable
  await expect(body.locator('[data-compare] input[type=range]')).toHaveCount(1); // compare
  await expect(body.locator('figure.code pre.shiki')).toHaveCount(1); // code (Shiki, build time)
  await expect(body.locator('figure.code pre.shiki span[style*="color"]').first()).toBeVisible();
  for (const tone of ['note', 'tip', 'caution']) await expect(body.locator(`.callout--${tone}`)).toHaveCount(1);
  await expect(body.locator('.callout--caution.hazard')).toHaveCount(1);
  await expect(body.locator('.pull blockquote')).toHaveText(/A quote section/); // quote
  await expect(body.locator('.viewer')).toHaveCount(1); // model-embed (poster/loop fallback until M7)
  await expect(body.locator('.sec-card a.card')).toHaveCount(1); // mod-card (the private canary one is gone)
  await expect(body.locator('.strip .strip__item')).toHaveCount(5); // timeline-embed stages 2..6 (private family gone)
  await expect(body.locator('dl.stats .stat')).toHaveCount(2); // stat-grid
  expect(await page.content()).not.toMatch(/zz[ _-]?private[ _-]?canary/i);
});

test('post page: header meta, TOC, reading time, prev/next, related, JSON-LD', async ({ page }) => {
  await page.goto('/blog/how-the-data-center-was-made');
  await expect(page.locator('.post__head time').first()).toHaveAttribute('datetime', '2026-10-19');
  await expect(page.locator('.post__head .meta')).toContainText('min read');
  await expect(page.locator('.post__head .chip--mod')).toHaveText(/Data Center/);
  const toc = page.locator('aside.toc');
  await expect(toc.locator('a')).not.toHaveCount(0);
  const href = await toc.locator('a').first().getAttribute('href');
  await expect(page.locator(href!)).toHaveCount(1);
  await expect(page.locator('.prevnext a')).not.toHaveCount(0);
  await expect(page.locator('.crumbs').getByRole('link')).toHaveText(['Home', 'Dev log']);
  await expect(page.locator('.post__head .chips a.chip').first()).toBeVisible();
  await expect(page.locator('#related ~ ul .pcard')).not.toHaveCount(0);
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = ld.map((t) => JSON.parse(t)['@type']);
  expect(types).toEqual(expect.arrayContaining(['BlogPosting', 'BreadcrumbList']));
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
});

test('blog index: featured lead card, cards, topics; tag pages; no pagination pages', async ({ page, request }) => {
  await page.goto('/blog');
  const lead = page.locator('[data-lead] .pcard');
  await expect(lead).toHaveCount(1);
  await expect(lead).toHaveClass(/pcard--lead/);
  const cards = page.locator('[data-grid] .pcard, [data-lead] .pcard');
  await expect(cards).toHaveCount(4); // 4 public posts; the unlisted bench and spoiler fixture are not listed
  await expect(page.locator('[data-count]')).toHaveText('4 posts');
  await expect(page.locator('a[href="/blog/section-test-bench"], a[href="/blog/spoiler-fixture"]')).toHaveCount(0);
  await expect(page.locator('[data-nospoil]')).toHaveCount(0); // no listed spoiler posts, so no toggle
  await expect(page.locator('body')).not.toContainText(/canary/i);
  const topics = page.getByRole('navigation', { name: 'Topics' });
  await expect(topics.getByRole('link', { name: 'All topics' })).toHaveAttribute('aria-current', 'page');
  await topics.getByRole('link', { name: 'Animation' }).click();
  await expect(page).toHaveURL(/\/blog\/tag\/animation$/);
  await expect(page.locator('h1')).toHaveText('Animation');
  await expect(page.getByRole('navigation', { name: 'Topics' }).getByRole('link', { name: 'Animation' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main .pcard')).toHaveCount(1);
  await expect(page.locator('main .pcard--lead')).toHaveCount(0); // tag pages don't feature a lead
  for (const n of [1, 2]) expect((await request.get(`/blog/page/${n}`)).status()).toBe(404);
});

test('blog filters: search, mod buttons, ?mod= preset; the lead only leads the unfiltered list', async ({ page }) => {
  await page.goto('/blog');
  const visible = page.locator('[data-grid] li:not([hidden]) .pcard, [data-lead]:not([hidden]) .pcard');
  const lead = page.locator('[data-lead] .pcard');
  const search = page.getByRole('searchbox', { name: 'Search posts' });
  await search.fill('kvm drawer');
  await expect(visible).toHaveCount(1);
  await expect(visible).toContainText('KVM drawer');
  await expect(page.locator('[data-count]')).toHaveText('1 post');
  await expect(lead).not.toHaveClass(/pcard--lead/);
  await search.fill('nothing matches this');
  await expect(visible).toHaveCount(0);
  await expect(page.locator('[data-empty]')).toBeVisible();
  await search.fill('');
  await expect(visible).toHaveCount(4);
  await expect(lead).toHaveClass(/pcard--lead/);
  const mods = page.getByRole('group', { name: 'Mod' });
  await expect(mods.getByRole('button', { name: 'All mods' })).toHaveAttribute('aria-pressed', 'true');
  await mods.getByRole('button', { name: 'Data Center' }).click();
  await expect(mods.getByRole('button', { name: 'Data Center' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/blog\?mod=data-center$/);
  await expect(visible).toHaveCount(4);
  await expect(lead).not.toHaveClass(/pcard--lead/);
  await mods.getByRole('button', { name: 'All mods' }).click();
  await expect(page).toHaveURL(/\/blog$/);
  // the mod page links here with the filter preset
  await page.goto('/blog?mod=data-center');
  await expect(page.getByRole('group', { name: 'Mod' }).getByRole('button', { name: 'Data Center' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-lead] .pcard')).not.toHaveClass(/pcard--lead/);
  await page.goto('/blog?mod=no-such-mod');
  await expect(page.locator('[data-empty]')).toBeVisible();
  await expect(page.locator('[data-count]')).toHaveText('0 posts');
});

test.describe('spoiler posts', () => {
  const URL = '/blog/spoiler-fixture';
  test('the body waits behind the warning until the reader agrees', async ({ page }) => {
    await page.goto(URL);
    const gate = page.locator('.gate');
    await expect(gate).toBeVisible();
    await expect(gate.getByRole('heading', { name: 'Spoilers and unfinished content' })).toBeVisible();
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('aside.toc')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('SPOILER-BODY-MARKER');
    await expect(page.locator('[data-post-body]')).toBeHidden();
    await expect(page.locator('template[data-spoiler-body]')).toHaveCount(1);
    await expect(gate.locator('noscript')).toHaveCount(1);
    await page.getByRole('button', { name: 'Show me the post' }).click();
    await expect(gate).toBeHidden();
    await expect(page.locator('[data-post-body]')).toBeVisible();
    await expect(page.locator('.post__body')).toContainText('SPOILER-BODY-MARKER');
    await expect(page.locator('.post__head h1')).toBeFocused();
    // agreed for this post in this session only
    await page.reload();
    await expect(page.locator('.post__body')).toContainText('SPOILER-BODY-MARKER');
    expect(await page.evaluate(() => localStorage.getItem('rl-spoilers-ok'))).toBeNull();
  });

  test('"Don\'t ask again" is remembered across sessions', async ({ page, context }) => {
    await page.goto(URL);
    await page.getByRole('checkbox', { name: /Don.t ask again/ }).check();
    await page.getByRole('button', { name: 'Show me the post' }).click();
    expect(await page.evaluate(() => localStorage.getItem('rl-spoilers-ok'))).toBe('1');
    const fresh = await context.newPage(); // new tab: no sessionStorage, same localStorage
    await fresh.goto(URL);
    await expect(fresh.locator('.gate')).toBeHidden();
    await expect(fresh.locator('.post__body')).toContainText('SPOILER-BODY-MARKER');
  });

  test('without JS the warning stays, with a note, and the body is never shown', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(URL);
    await expect(page.locator('.gate')).toBeVisible();
    await expect(page.locator('.gate__nojs')).toContainText('needs JavaScript');
    await expect(page.getByRole('button', { name: 'Show me the post' })).toBeHidden();
    expect(await page.locator('body').innerText()).not.toContain('SPOILER-BODY-MARKER');
    await ctx.close();
  });

  test('the excerpt never leaks into meta tags, JSON-LD or feeds', async ({ page, request }) => {
    const excerpt = 'Unlisted fixture for the spoiler warning.';
    await page.goto(URL);
    for (const sel of ['meta[name=description]', 'meta[property="og:description"]']) await expect(page.locator(sel)).not.toHaveAttribute('content', excerpt);
    expect((await page.locator('script[type="application/ld+json"]').allTextContents()).join('')).not.toContain(excerpt);
    expect((await page.locator('head').innerHTML())).not.toContain('SPOILER-BODY-MARKER');
    for (const feed of ['/rss.xml', '/mods/releases.xml']) {
      const xml = await (await request.get(feed)).text();
      expect(xml).not.toContain(excerpt);
      expect(xml).not.toContain('SPOILER-BODY-MARKER');
    }
  });
});

test('feeds are linked and contain only listed posts', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel=alternate][type="application/rss+xml"]')).toHaveCount(2);
  const rss = await (await request.get('/rss.xml')).text();
  expect((rss.match(/<item>/g) ?? []).length).toBe(4);
  expect(rss).not.toMatch(/section-test-bench|canary/i);
  expect(rss).toContain('<content:encoded>');
});

test('a timeline embed opens stages in place and steps through the whole range', async ({ page }) => {
  await page.goto('/blog/how-the-data-center-was-made');
  const strip = page.locator('[data-strip]').first();
  const first = strip.locator('.strip__item a').first();
  await first.click();
  const dlg = strip.locator('dialog');
  await expect(dlg).toBeVisible();
  await expect(page).toHaveURL(/\/blog\/how-the-data-center-was-made$/);
  const total = Number((await dlg.locator('.lightbox__count').textContent())!.split('/')[1]);
  expect(total).toBeGreaterThanOrEqual(await strip.locator('.strip__item').count());
  await page.keyboard.press('ArrowRight');
  await expect(dlg.locator('.lightbox__count')).toHaveText(`2 / ${total}`);
  await expect(dlg.locator('.lightbox__meta')).toContainText('Step 02');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(first).toBeFocused();
});
