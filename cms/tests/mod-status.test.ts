import { describe, expect, it } from 'vitest';
import { AdminClient } from '../scripts/lib/admin-http';
import { parseCli } from '../scripts/lib/cms-cli';
import { runCommand } from '../scripts/lib/cms-commands';
import { cmpVersion, gatherModStatus, type ModStatusData, modWarnings, parseVersion } from '../scripts/lib/mod-status';

const para = (text: string) => [{ type: 'paragraph', children: [{ type: 'text', text }] }];

/** A released mod with everything in sync: no warnings. Tests change one thing at a time. */
function released(): ModStatusData {
  return {
    mod: {
      documentId: 'mod1', name: 'Data Center', slug: 'data-center', status: 'published', visibility: 'public',
      modStatus: 'published', stage: null, currentVersion: '0.9.0', updatedAt: '2026-10-22T04:00:00Z',
      steamWorkshopUrl: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1', tagline: 'Server racks.', summary: 'Racks and trays.',
      specs: [{ label: 'Version', value: '0.9.0, the first Workshop release.' }],
      body: [{ __component: 'sections.callout', tone: 'note', title: 'Early release', body: para('Costs can still change.') }],
      seo: { metaDescription: 'Server racks for Space Engineers 2.' },
    },
    publishedAt: '2026-10-22T04:00:00Z',
    milestones: [
      { label: 'First mockups', phase: 'done', date: '2026-10-17', status: 'published', visibility: 'public', updatedAt: '2026-10-23' },
      { label: 'Fixes from players', phase: 'next', date: null, status: 'published', visibility: 'public', updatedAt: '2026-10-23' },
    ],
    releases: [{ version: '0.9.0', releasedAt: '2026-10-21', channel: 'stable', status: 'published', visibility: 'public' }],
    posts: [{ title: 'Release: Data Center v0.9.0', date: '2026-10-22', status: 'published', visibility: 'public', category: { name: 'Release notes' } }],
    home: { status: 'published', featuredSlug: 'data-center' },
    settingsMentions: [],
    counts: { timelineFamilies: 6, blocks: 4 },
  };
}
const warn = (d: ModStatusData) => modWarnings(d);
const one = (d: ModStatusData, re: RegExp) => {
  const w = warn(d);
  expect(w.filter((x) => re.test(x)), w.join('\n')).toHaveLength(1);
};

describe('versions', () => {
  it('parses and compares', () => {
    expect(parseVersion('v0.9.1')).toEqual([0, 9, 1]);
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('')).toBeNull();
    expect(cmpVersion([0, 9, 0], [0, 10, 0])).toBeLessThan(0);
  });
});

describe('modWarnings', () => {
  it('a mod in sync has no warnings', () => {
    expect(warn(released())).toEqual([]);
  });

  it('published without a Workshop link, and a link on an unreleased mod', () => {
    const a = released();
    a.mod.steamWorkshopUrl = null;
    one(a, /steamWorkshopUrl is empty/);
    const b = released();
    b.mod.modStatus = 'wip';
    b.mod.stage = 'testing';
    b.milestones[1].phase = 'now';
    one(b, /steamWorkshopUrl is set but modStatus is wip/);
  });

  it('currentVersion without a mod-release entry', () => {
    const d = released();
    d.releases = [];
    one(d, /0\.9\.0 has no mod-release entry/);
  });

  it('now/next milestones that mention a shipped version or pre-release wording', () => {
    const d = released();
    d.milestones.push(
      { label: 'Getting 0.9.0 ready', phase: 'now', note: 'The first public release.', status: 'published', visibility: 'public', updatedAt: '2026-10-23' },
      { label: 'Testing in game', phase: 'now', note: 'Building halls.', status: 'published', visibility: 'public', updatedAt: '2026-10-23' },
      { label: 'Version 0.10', phase: 'next', note: 'More servers.', status: 'published', visibility: 'public', updatedAt: '2026-10-23' },
    );
    const w = warn(d);
    expect(w.some((x) => /"Getting 0\.9\.0 ready".*v0\.9\.0, which is already out/.test(x))).toBe(true);
    expect(w.some((x) => /"Testing in game".*says "testing in game"/.test(x))).toBe(true);
    expect(w.some((x) => /Version 0\.10/.test(x))).toBe(false);
  });

  it('pre-release wording in specs, callouts and text fields of a released mod', () => {
    const d = released();
    d.mod.specs.push({ label: 'Status', value: 'Not on the Workshop yet.' });
    d.mod.body.push({ __component: 'sections.callout', tone: 'caution', title: 'Heads up', body: para('This build is not stable.') });
    d.mod.tagline = 'Coming soon: server racks.';
    const w = warn(d);
    expect(w.some((x) => /specs "Status" says "not on the workshop"/.test(x))).toBe(true);
    expect(w.some((x) => /callout "Heads up" says "not stable"/.test(x))).toBe(true);
    expect(w.some((x) => /tagline says "coming soon"/.test(x))).toBe(true);
  });

  it('a Version spec row that does not match currentVersion', () => {
    const d = released();
    d.mod.specs[0].value = '0.8.0 preview';
    one(d, /specs "Version" says "0\.8\.0 preview"/);
  });

  it('an idea with work on the roadmap', () => {
    const d = released();
    Object.assign(d.mod, { modStatus: 'idea', steamWorkshopUrl: null, currentVersion: null, specs: [], body: [] });
    d.releases = [];
    d.posts = [];
    d.milestones.push({ label: 'Testing in game', phase: 'now', status: 'published', visibility: 'public', updatedAt: '2026-10-23' });
    one(d, /modStatus is idea but 2 milestone\(s\) are done\/now/);
  });

  it('done milestones without a date', () => {
    const d = released();
    d.milestones[0].date = null;
    one(d, /"First mockups" is done but has no date/);
  });

  it('unpublished changes on the mod and its milestones, and public entries never published', () => {
    const d = released();
    d.mod.status = 'modified';
    d.milestones[0].status = 'modified';
    d.milestones.push({ label: 'New thing', phase: 'later', status: 'draft', visibility: 'public', updatedAt: '2026-10-23' });
    const w = warn(d);
    expect(w.some((x) => /^mod entry has unpublished changes/.test(x))).toBe(true);
    expect(w.some((x) => /"First mockups" has unpublished changes/.test(x))).toBe(true);
    expect(w.some((x) => /"New thing" is public but was never published/.test(x))).toBe(true);
  });

  it('a missing release post for x.y.0, and a patch without an updatedNote on the minor post', () => {
    const a = released();
    a.posts = [];
    one(a, /no "Release: Data Center v0\.9\.0" post/);
    const b = released();
    b.mod.currentVersion = '0.9.1';
    b.mod.specs[0].value = '0.9.1';
    b.releases.push({ version: '0.9.1', releasedAt: '2026-10-22', status: 'published', visibility: 'public' });
    one(b, /0\.9\.1 is a patch but "Release: Data Center v0\.9\.0" has no updatedNote/);
    b.posts[0].updatedNote = 'Updated for v0.9.1: two fixes';
    expect(warn(b)).toEqual([]);
  });

  it('roadmap items not edited since the last release', () => {
    const d = released();
    d.milestones[1].updatedAt = '2026-10-20T10:00:00Z';
    one(d, /1 now\/next milestone\(s\) not edited since the last release \(2026-10-22\): "Fixes from players"/);
  });

  it('a stale stage and blocked without a reason', () => {
    const a = released();
    a.mod.stage = 'testing';
    one(a, /stage is "testing" on a released mod/);
    const b = released();
    Object.assign(b.mod, { modStatus: 'wip', stage: 'blocked', steamWorkshopUrl: null });
    b.milestones[1].phase = 'now';
    one(b, /stage is blocked but blockedReason is empty/);
  });
});

// --- the whole command on a mocked Content Manager ------------------------------------------------------------------

function fakeCms() {
  const calls: { method: string; path: string; query: URLSearchParams }[] = [];
  const mod = { ...released().mod, releases: { count: 0 } };
  const lists: Record<string, any[]> = {
    'api::mod.mod': [mod, { documentId: 'mod2', slug: 'secret-idea', visibility: 'private', sortOrder: 5 }],
    'api::milestone.milestone': [
      { label: 'Getting 0.9.0 ready', phase: 'now', status: 'published', visibility: 'public', updatedAt: '2026-10-21', sortOrder: 60 },
      { label: 'First mockups', phase: 'done', date: '2026-10-17', status: 'published', visibility: 'public', updatedAt: '2026-10-21', sortOrder: 10 },
    ],
    'api::mod-release.mod-release': [],
    'api::blog-post.blog-post': [{ title: 'Release: Data Center v0.9.0', date: '2026-10-22', status: 'published', visibility: 'public', category: { name: 'Release notes' } }],
    'api::timeline-family.timeline-family': [{}, {}],
    'api::block-3d-model.block-3d-model': [{}],
  };
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname);
    calls.push({ method: init.method ?? 'GET', path: p, query: u.searchParams });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const list = p.match(/^\/content-manager\/collection-types\/([^/]+)$/);
    if (list) {
      let rows = lists[list[1]] ?? [];
      const slug = u.searchParams.get('filters[$and][0][slug][$eq]');
      if (slug) rows = rows.filter((r) => r.slug === slug);
      const vis = u.searchParams.get('filters[$and][0][visibility][$eq]');
      if (vis) rows = rows.filter((r) => r.visibility === vis);
      return ok({ results: rows, pagination: { page: 1, pageCount: 1, total: rows.length } });
    }
    if (p === '/content-manager/collection-types/api::mod.mod/mod1') return ok({ data: mod, meta: { availableStatus: [{ publishedAt: '2026-10-22T04:00:00Z' }] } });
    if (p === '/content-manager/single-types/api::home-page.home-page') return ok({ data: { status: 'published', featuredMod: { slug: 'data-center' }, teaserTitle: null } });
    if (p === '/content-manager/single-types/api::site-settings.site-settings') return ok({ data: { footerPitch: 'Mods like Data Center.', siteName: 'Rioku Labs' } });
    return new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404 });
  };
  return { calls, client: new AdminClient('http://localhost:1337', 'tok', fetchImpl as any) };
}

async function run(argv: string[], cms = fakeCms()) {
  const lines: string[] = [];
  const code = await runCommand(parseCli(argv), { client: cms.client, out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`), readText: () => '' });
  return { code, out: lines.join('\n'), cms };
}

describe('mod-status command', () => {
  it('needs a slug or --all, not both', () => {
    expect(() => parseCli(['mod-status'])).toThrow(/slug or --all/);
    expect(() => parseCli(['mod-status', 'x', '--all'])).toThrow(/slug or --all/);
    expect(parseCli(['mod-status', '--all']).flags.all).toBe(true);
  });

  it('gathers every content type with GETs only and prints the report with warnings', async () => {
    const { code, out, cms } = await run(['mod-status', 'data-center']);
    expect(code).toBe(0);
    expect(cms.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(cms.calls.some((c) => c.path.endsWith('api::milestone.milestone') && c.query.get('filters[$and][0][mod][slug][$eq]') === 'data-center')).toBe(true);
    expect(cms.calls.some((c) => c.path.endsWith('api::blog-post.blog-post') && c.query.get('filters[$and][0][relatedMods][slug][$eq]') === 'data-center')).toBe(true);
    expect(out).toMatch(/# Data Center \(data-center\)/);
    expect(out).toMatch(/Version: 0\.9\.0/);
    expect(out).toMatch(/1 callout note "Early release"/);
    expect(out.indexOf('First mockups')).toBeLessThan(out.indexOf('Getting 0.9.0 ready')); // by sortOrder
    expect(out).toMatch(/release post for v0\.9\.0: yes/);
    expect(out).toMatch(/home: featured on home/);
    expect(out).toMatch(/site settings mentions: footerPitch/);
    expect(out).toMatch(/timeline families: 2 {2}3D blocks: 1/);
    expect(out).toMatch(/! currentVersion 0\.9\.0 has no mod-release entry/);
    expect(out).toMatch(/! milestone "Getting 0\.9\.0 ready" \(now\) mentions v0\.9\.0/);
  });

  it('--all covers public mods only', async () => {
    const { out } = await run(['mod-status', '--all']);
    expect(out).toMatch(/^data-center\s+published/m);
    expect(out).not.toMatch(/secret-idea/);
  });

  it('an unknown slug lists the real ones', async () => {
    await expect(run(['mod-status', 'nope'])).rejects.toThrow(/no mod with slug "nope"/);
  });
});
