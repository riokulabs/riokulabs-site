/**
 * `npm run cms -- mod-status <slug>` and `mod-status --all`: a read-only audit of one mod across every content type
 * that talks about it (mod entry, roadmap milestones, mod releases, blog posts, home page, site settings, timeline
 * families, 3D blocks), plus consistency warnings for the places that drift apart after a release or a status change.
 *
 * Split in three so tests need no server: gatherModStatus (admin Content Manager reads only), modWarnings (pure rules
 * on the gathered data) and renderModStatus (compact lines).
 */
import { AdminClient, UsageError } from './admin-http';
import { blocksText } from './cms-cli';

const UID = {
  mod: 'api::mod.mod',
  milestone: 'api::milestone.milestone',
  release: 'api::mod-release.mod-release',
  post: 'api::blog-post.blog-post',
  timeline: 'api::timeline-family.timeline-family',
  block: 'api::block-3d-model.block-3d-model',
  home: 'api::home-page.home-page',
  settings: 'api::site-settings.site-settings',
};

export interface ModStatusData {
  mod: any; // the draft, with `status` draft | published | modified
  publishedAt?: string | null; // when the live version was last published
  milestones: any[];
  releases: any[];
  posts: any[]; // with `category` as { name }
  home: { status?: string; featuredSlug?: string; teaserTitle?: string | null; teaserText?: string | null; teaserStatus?: string | null } | null;
  settingsMentions: string[]; // site-settings fields that name the mod
  counts: { timelineFamilies: number; blocks: number };
}

// --- reading --------------------------------------------------------------------------------------------------------

async function listAll(client: AdminClient, uid: string, filters: Record<string, string> = {}): Promise<{ results: any[]; total: number }> {
  const results: any[] = [];
  let total = 0;
  for (let page = 1; page < 50; page++) {
    const r = await client.get(`/content-manager/collection-types/${uid}`, { page, pageSize: 100, sort: 'updatedAt:desc', ...filters });
    results.push(...(r?.results ?? []));
    total = r?.pagination?.total ?? results.length;
    if (page >= (r?.pagination?.pageCount ?? 1)) break;
  }
  return { results, total };
}

const bySlug = (rel: string, slug: string) => ({ [`filters[$and][0][${rel}][slug][$eq]`]: slug });

/** Strings anywhere in a value, with their dotted path, for "does site settings mention this mod". */
function strings(v: unknown, at = ''): [string, string][] {
  if (typeof v === 'string') return [[at, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${at}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => (['id', 'documentId', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'publishedAt', 'url', 'type'].includes(k) ? [] : strings(x, at ? `${at}.${k}` : k)));
  }
  return [];
}

export async function gatherModStatus(client: AdminClient, slug: string): Promise<ModStatusData> {
  const found = await listAll(client, UID.mod, { 'filters[$and][0][slug][$eq]': slug });
  const hit = found.results.find((m) => m.slug === slug);
  if (!hit) {
    const all = await listAll(client, UID.mod);
    throw new UsageError(`no mod with slug "${slug}". Slugs: ${all.results.map((m) => m.slug).sort().join(', ')}`);
  }
  const res = await client.get(`/content-manager/collection-types/${UID.mod}/${encodeURIComponent(hit.documentId)}`, { status: 'draft' });
  const mod = res?.data;
  const live = (res?.meta?.availableStatus ?? []).find((s: any) => s.publishedAt);
  const [milestones, releases, posts, timelines, blocks] = await Promise.all([
    listAll(client, UID.milestone, bySlug('mod', slug)),
    listAll(client, UID.release, bySlug('mod', slug)),
    listAll(client, UID.post, bySlug('relatedMods', slug)),
    listAll(client, UID.timeline, bySlug('mod', slug)),
    listAll(client, UID.block, bySlug('mod', slug)),
  ]);
  const [homeRes, settingsRes] = await Promise.all([
    client.get(`/content-manager/single-types/${UID.home}`).catch(() => null),
    client.get(`/content-manager/single-types/${UID.settings}`).catch(() => null),
  ]);
  const h = homeRes?.data;
  const home = h ? { status: h.status, featuredSlug: h.featuredMod?.slug, teaserTitle: h.teaserTitle, teaserText: h.teaserText, teaserStatus: h.teaserStatus } : null;
  const name = String(mod.name ?? slug).toLowerCase();
  const settingsMentions = settingsRes?.data
    ? [...new Set(strings(settingsRes.data).filter(([, s]) => s.toLowerCase().includes(name)).map(([p]) => p))]
    : [];
  return {
    mod,
    publishedAt: live?.publishedAt ?? null,
    milestones: milestones.results.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    releases: releases.results,
    posts: posts.results.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))),
    home,
    settingsMentions,
    counts: { timelineFamilies: timelines.total, blocks: blocks.total },
  };
}

/** Slugs of the public mods, for --all. */
export async function publicModSlugs(client: AdminClient): Promise<string[]> {
  const r = await listAll(client, UID.mod, { 'filters[$and][0][visibility][$eq]': 'public' });
  return r.results.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((m) => m.slug);
}

// --- rules ----------------------------------------------------------------------------------------------------------

type Version = [number, number, number];
export function parseVersion(s: unknown): Version | null {
  const m = String(s ?? '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}
export const cmpVersion = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const vstr = (v: Version) => v.join('.');
/** Every version-looking token in a text ("0.9.0", "v1.2"). */
const versionsIn = (s: string): Version[] => [...s.matchAll(/\bv?(\d+\.\d+(?:\.\d+)?)\b/g)].map((m) => parseVersion(m[1])!).filter(Boolean);

/** Wording that only fits a mod that is not out yet. */
export const PRE_RELEASE_PHRASES = [
  'not on the workshop', 'coming to the workshop', 'coming soon', 'in testing', 'testing in game', 'not stable', 'not released',
  'not yet released', 'unreleased', 'pre-release', 'prerelease', 'getting ready', 'getting 0.', 'before release', 'once released',
  'when it releases', 'release candidate', 'first public release',
];
const phraseIn = (s: unknown) => {
  const t = String(s ?? '').toLowerCase().replace(/[’']/g, "'");
  return PRE_RELEASE_PHRASES.find((p) => t.includes(p));
};
const RELEASE_TITLE = /^release:\s*(.+?)\s+v(\d+\.\d+\.\d+)\s*$/i;
const day = (s: unknown) => (s ? String(s).slice(0, 10) : '');
const isLive = (e: any) => e?.status === 'published' || e?.status === 'modified';
const isPublic = (e: any) => e?.visibility === 'public';

export function modWarnings(d: ModStatusData): string[] {
  const w: string[] = [];
  const m = d.mod;
  const released = m.modStatus === 'published';
  const cur = parseVersion(m.currentVersion);
  const roadmap = d.milestones.filter(isPublic);
  const active = roadmap.filter((x) => x.phase === 'now' || x.phase === 'next');

  // Status vs links and version.
  if (released && !m.steamWorkshopUrl) w.push('modStatus is published but steamWorkshopUrl is empty: the mod page shows "Coming to the Workshop" instead of a Subscribe button.');
  if (!released && m.steamWorkshopUrl) w.push(`steamWorkshopUrl is set but modStatus is ${m.modStatus}: the page offers a Subscribe button while the badge says it is not released.`);
  if (released && !cur) w.push('modStatus is published but currentVersion is empty: the badge and the Version spec have no version to show.');
  if (released && m.stage && !['blocked', 'paused'].includes(m.stage)) w.push(`stage is "${m.stage}" on a released mod: the site ignores stage once released, so it is stale; clear it so it does not come back if the status changes.`);
  if (m.stage === 'blocked' && !m.blockedReason) w.push('stage is blocked but blockedReason is empty: the page shows no reason.');
  if (m.blockedReason && m.stage !== 'blocked') w.push(`blockedReason is set but stage is "${m.stage ?? '-'}": the reason is hidden; clear it or set stage blocked.`);
  if (released && m.feasibility) w.push('feasibility is set on a released mod: that text is idea-card wording; check it still reads right or clear it.');

  // Releases.
  if (released && cur) {
    const rel = d.releases.find((r) => (parseVersion(r.version) && cmpVersion(parseVersion(r.version)!, cur) === 0));
    if (!rel) w.push(`currentVersion ${vstr(cur)} has no mod-release entry: the version history and "latest release" data miss it.`);
    else {
      if (!isLive(rel)) w.push(`mod-release ${rel.version} is not published (${rel.status}): it is not on the site.`);
      else if (!isPublic(rel)) w.push(`mod-release ${rel.version} is ${rel.visibility}: it is not on the site.`);
      if (!rel.releasedAt) w.push(`mod-release ${rel.version} has no releasedAt date.`);
    }
  }
  for (const r of d.releases) {
    const v = parseVersion(r.version);
    if (v && cur && cmpVersion(v, cur) > 0) w.push(`mod-release ${r.version} is newer than currentVersion ${vstr(cur)}: bump currentVersion or fix the release.`);
  }

  // Roadmap.
  if (released) {
    for (const x of active) {
      const text = `${x.label ?? ''} ${x.note ?? ''}`;
      const old = cur && versionsIn(text).find((v) => cmpVersion(v, cur) <= 0);
      const p = phraseIn(text);
      if (old) w.push(`milestone "${x.label}" (${x.phase}) mentions v${vstr(old)}, which is already out (current ${vstr(cur!)}): move it to done with a date.`);
      else if (p) w.push(`milestone "${x.label}" (${x.phase}) says "${p}" but the mod is released: move it to done or reword it.`);
    }
  }
  if (m.modStatus === 'idea') {
    const started = roadmap.filter((x) => x.phase === 'done' || x.phase === 'now');
    if (started.length) w.push(`modStatus is idea but ${started.length} milestone(s) are done/now: the badge says "Drawing board" while the roadmap shows work; set modStatus wip and a stage.`);
  }
  if (m.modStatus === 'wip' && !roadmap.some((x) => x.phase === 'now')) w.push('modStatus is wip but no public milestone is in "now": the roadmap shows nothing in progress for it.');
  if (isPublic(m) && m.modStatus !== 'idea' && !roadmap.length) w.push('no public milestones: the mod has no roadmap track.');
  for (const x of d.milestones) if (x.phase === 'done' && !x.date) w.push(`milestone "${x.label}" is done but has no date: the roadmap cannot place it.`);

  // Wording that only fits an unreleased mod.
  if (released) {
    const texts: [string, unknown][] = [
      ['tagline', m.tagline], ['summary', m.summary], ['heroCaption', m.heroCaption], ['seo.metaDescription', m.seo?.metaDescription],
      ...((m.specs ?? []) as any[]).map((s): [string, unknown] => [`specs "${s.label}"`, s.value]),
      ...((m.body ?? []) as any[]).flatMap((s, i): [string, unknown][] => {
        if (s.__component === 'sections.callout') return [[`body ${i + 1} callout "${s.title ?? ''}"`, `${s.title ?? ''} ${blocksText(s.body)}`]];
        if (s.__component === 'sections.rich-text') return [[`body ${i + 1} rich-text`, blocksText(s.content)]];
        return [];
      }),
    ];
    for (const [where, t] of texts) {
      const p = phraseIn(t);
      if (p) w.push(`${where} says "${p}" but the mod is released: reword it.`);
    }
  }
  const vrow = ((m.specs ?? []) as any[]).find((s) => /^version$/i.test(String(s.label ?? '').trim()));
  if (vrow && cur) {
    const vs = versionsIn(String(vrow.value ?? ''));
    if (!vs.some((v) => cmpVersion(v, cur) === 0)) w.push(`specs "Version" says "${vrow.value}" but currentVersion is ${vstr(cur)}.`);
  }
  if (released && cur && !vrow) w.push('no "Version" spec row: the specs table does not show the current version.');

  // Release posts (write-devlog: posts only for x.y.0; patches go into the minor post with updatedNote).
  const releasePosts = d.posts
    .map((p) => ({ p, m: String(p.title ?? '').match(RELEASE_TITLE) }))
    .filter((x) => x.m)
    .map((x) => ({ post: x.p, version: parseVersion(x.m![2])! }));
  if (released && cur) {
    const minor: Version = [cur[0], cur[1], 0];
    const post = releasePosts.find((r) => cmpVersion(r.version, minor) === 0);
    if (!post) w.push(`no "Release: ${m.name} v${vstr(minor)}" post linked to the mod (relatedMods): every x.y.0 release gets one.`);
    else {
      if (!isLive(post.post) || !isPublic(post.post)) w.push(`release post "${post.post.title}" is ${post.post.status}/${post.post.visibility}: it is not on the site.`);
      if (cur[2] > 0 && !String(post.post.updatedNote ?? '').includes(vstr(cur))) w.push(`currentVersion ${vstr(cur)} is a patch but "${post.post.title}" has no updatedNote for it: append the patch notes to that post.`);
    }
  }
  for (const r of releasePosts) if (r.version[2] > 0) w.push(`"${r.post.title}" is a post for a patch: patches go into the x.y.0 post instead.`);

  // Unpublished changes.
  const pending = (what: string, e: any) => {
    if (e.status === 'modified') w.push(`${what} has unpublished changes (modified): the site still shows the older version.`);
    else if (e.status === 'draft' && isPublic(e)) w.push(`${what} is public but was never published: it is not on the site.`);
  };
  pending('mod entry', m);
  for (const x of d.milestones) pending(`milestone "${x.label}"`, x);
  for (const r of d.releases) pending(`mod-release ${r.version}`, r);
  for (const p of d.posts) if (p.status === 'modified') pending(`post "${p.title}"`, p);

  // Roadmap not touched since the last release.
  const lastRelease = [...d.releases.map((r) => day(r.releasedAt)), ...releasePosts.filter((r) => isLive(r.post)).map((r) => day(r.post.date))].filter(Boolean).sort().at(-1);
  if (lastRelease) {
    const stale = active.filter((x) => day(x.updatedAt) < lastRelease);
    if (stale.length) w.push(`${stale.length} now/next milestone(s) not edited since the last release (${lastRelease}): ${stale.map((x) => `"${x.label}"`).join(', ')}. Check they are still true.`);
  }

  // Home page.
  if (d.home?.featuredSlug === m.slug && (!isPublic(m) || !isLive(m))) w.push('the home page features this mod but it is not public and published: the home page loses its featured mod.');
  return w;
}

// --- rendering ------------------------------------------------------------------------------------------------------

const clip = (s: unknown, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return !t ? '-' : t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const or = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v));

export function renderModStatus(d: ModStatusData, warnings = modWarnings(d)): string[] {
  const m = d.mod;
  const out: string[] = [];
  out.push(`# ${m.name} (${m.slug})  ${m.documentId}  ${m.status}  ${m.visibility}${m.featured ? '  featured' : ''}`);
  out.push(`  updated ${day(m.updatedAt)}  live version published ${day(d.publishedAt) || '-'}`);
  out.push(`  modStatus=${or(m.modStatus)}  stage=${or(m.stage)}  currentVersion=${or(m.currentVersion)}  requiresScripts=${or(m.requiresScripts)}`);
  out.push(`  gameVersionTested=${or(m.gameVersionTested)}  gameVersionBuilt=${or(m.gameVersionBuilt)}`);
  out.push(`  steam=${or(m.steamWorkshopUrl)}`);
  out.push(`  modio=${or(m.modioUrl)}  github=${or(m.githubUrl)}`);
  out.push(`  tagline: ${clip(m.tagline)}`);
  out.push(`  summary: ${clip(m.summary)}`);
  if (m.feasibility) out.push(`  feasibility: ${clip(m.feasibility)}`);
  if (m.blockedReason) out.push(`  blockedReason: ${clip(m.blockedReason)}`);
  out.push(`  seo: ${clip(m.seo?.metaDescription)}`);
  const specs = (m.specs ?? []) as any[];
  out.push(`specs (${specs.length}):`);
  for (const s of specs) out.push(`  ${s.label}: ${clip(s.value, 80)}`);
  const callouts = ((m.body ?? []) as any[]).map((s, i) => ({ s, i })).filter((x) => x.s.__component === 'sections.callout');
  out.push(`body: ${(m.body ?? []).length} section(s), ${callouts.length} callout(s)`);
  for (const { s, i } of callouts) out.push(`  ${i + 1} callout ${or(s.tone)} "${or(s.title)}" ${clip(blocksText(s.body), 70)}`);
  out.push(`milestones (${d.milestones.length}):`);
  for (const x of d.milestones) out.push(`  ${x.phase.padEnd(5)} ${(day(x.date) || '-').padEnd(10)} ${x.status}/${x.visibility}  "${x.label}"  ${clip(x.note, 60)}  (edited ${day(x.updatedAt)})`);
  out.push(`releases (${d.releases.length}):`);
  for (const r of d.releases) out.push(`  ${r.version}  ${or(day(r.releasedAt))}  ${or(r.channel)}  ${r.status}/${r.visibility}`);
  out.push(`posts (${d.posts.length}):`);
  for (const p of d.posts) {
    out.push(`  ${or(day(p.date))}  ${p.status}/${p.visibility}  [${p.category?.name ?? '-'}]${p.spoiler ? ' spoiler' : ''}  "${clip(p.title, 70)}"${p.updatedNote ? `  updated: ${clip(p.updatedNote, 50)}` : ''}`);
  }
  const cur = parseVersion(m.currentVersion);
  if (cur) {
    const minor = `${cur[0]}.${cur[1]}.0`;
    const has = d.posts.some((p) => RELEASE_TITLE.test(String(p.title ?? '')) && String(p.title).match(RELEASE_TITLE)![2] === minor);
    out.push(`  release post for v${minor}: ${has ? 'yes' : 'no'}`);
  }
  if (d.home) {
    const feat = d.home.featuredSlug === m.slug ? 'featured on home' : `home features ${or(d.home.featuredSlug)}`;
    out.push(`home: ${feat} (${d.home.status})  teaser: ${clip(d.home.teaserTitle, 40)} / ${clip(d.home.teaserStatus, 30)} / ${clip(d.home.teaserText, 50)}`);
  }
  out.push(`site settings mentions: ${d.settingsMentions.length ? d.settingsMentions.join(', ') : 'none'}`);
  out.push(`timeline families: ${d.counts.timelineFamilies}  3D blocks: ${d.counts.blocks}`);
  out.push(warnings.length ? `warnings (${warnings.length}):` : 'warnings: none');
  for (const x of warnings) out.push(`  ! ${x}`);
  return out;
}

/** One line per mod for --all. */
export function summaryLine(d: ModStatusData, warnings = modWarnings(d)): string {
  const m = d.mod;
  const phases = ['done', 'now', 'next', 'later'].map((p) => `${p}=${d.milestones.filter((x) => x.phase === p).length}`).join(' ');
  return `${m.slug.padEnd(22)} ${m.status.padEnd(9)} ${or(m.modStatus).padEnd(9)} ${or(m.stage).padEnd(11)} v${or(m.currentVersion).padEnd(7)} ${phases}  releases=${d.releases.length} posts=${d.posts.length}  warnings=${warnings.length}`;
}
