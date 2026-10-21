/**
 * Seed content for the Rioku Labs site: the single source for both the Strapi seed (scripts/seed.ts) and the web fixtures
 * (scripts/build-fixtures.ts). Written from the allow-listed sources only (the allowlist's `public` and
 * `privateDraft` parts): mods/DataCenter/README.md, resources/showcase/shots.json and resources/history/timeline.json
 * (public families). Plain voice, no private projects, no third-party IP terms.
 *
 * Private entries (unannounced idea cards and their roadmap teasers) are NOT in this file: they live in the gitignored
 * seed/private.ts, loaded below only when it exists. The seed creates them locally; the fixtures never contain them.
 *
 * Media paths are relative to cms/seed/media/ (staged by `npm run prepare-media`).
 *
 * Visibility here is the INTENDED launch visibility. `confirm: true` items are seeded as private until the user
 * approves them (`npm run seed -- --approve=data-center,history`), per HANDOFF §2.5.
 */
import fs from 'node:fs';
import path from 'node:path';
import { md, type Block } from './md';

export type Vis = 'public' | 'unlisted' | 'private';
export interface Img { file: string; alt: string; caption?: string; focalX?: number; focalY?: number }
export interface Vid { mp4: string; poster: string; caption?: string; durationSec?: number }
export type Visual = { kind: 'image'; image: Img } | { kind: 'video'; video: Vid };
export interface GalleryItem { kind: 'image' | 'loop'; image?: Img; video?: Vid; title?: string; caption?: string }
export type Section =
  | { __component: 'sections.rich-text'; content: Block[] }
  | { __component: 'sections.image'; image: Img; size?: 'inline' | 'wide' | 'full' }
  | { __component: 'sections.gallery'; items: GalleryItem[]; layout?: 'grid' | 'strip' }
  | { __component: 'sections.loop-video'; video: Vid; size?: 'inline' | 'wide' | 'full' }
  | { __component: 'sections.compare'; before: Img; after: Img; beforeLabel?: string; afterLabel?: string; caption?: string }
  | { __component: 'sections.code'; language: string; code: string; filename?: string; caption?: string }
  | { __component: 'sections.callout'; tone: 'note' | 'tip' | 'caution'; title?: string; body: Block[] }
  | { __component: 'sections.quote'; text: string; attribution?: string }
  | { __component: 'sections.model-embed'; model: string; caption?: string }
  | { __component: 'sections.mod-card'; mod: string }
  | { __component: 'sections.timeline-embed'; family: string; fromStage?: number; toStage?: number }
  | { __component: 'sections.stat-grid'; stats: { value: string; label: string }[] };

interface Base { visibility: Vis; confirm?: boolean; publish: boolean }

const SEED = __dirname;
/** The studio identity (one value each), shared with the site: web/src/config/identity.json. */
export const IDENTITY: { name: string; domain: string; githubOrg: string; redirectDomains: string[] } = JSON.parse(
  fs.readFileSync(path.join(SEED, '..', '..', 'web', 'src', 'config', 'identity.json'), 'utf8'),
);
const STUDIO = IDENTITY.name;
const shots = JSON.parse(fs.readFileSync(path.join(SEED, 'shots.json'), 'utf8'));
export const timeline = JSON.parse(fs.readFileSync(path.join(SEED, 'timeline.public.json'), 'utf8'));

/** Alt text says what is in the frame; the caption (from shots.json, verbatim) says what the part does. */
const ALT: Record<string, string> = {
  'datacenter-cold-aisle': 'Looking down a contained cold aisle between two rows of gray server racks under a lit roof.',
  'datacenter-hall-overhead': 'Overhead view of a server hall: three rows of racks, aisle roofs, coolers and cable trays.',
  'containment-doors-and-aisle-signs': 'Sliding aisle doors with a blue cold-aisle sign and a red hot-aisle sign above them.',
  'rack-42u-front-loaded': 'A tall rack with its split front doors open, full of different server modules.',
  'rack-42u-rear-power-strips': 'The back of an open rack with two vertical power strips and server rear panels.',
  'kvm-console-open': 'A rack-mounted keyboard drawer pulled out with its screen folded up.',
  'server-lineup': 'Ten server blocks lined up in two rows on a gray floor.',
  'overhead-cable-trays': 'Wire-basket cable trays hanging from rods above a row of racks, with cables dropping into the racks.',
  'in-row-cooler-front': 'A cooling unit between two racks with three large round fans and a control panel.',
  'in-row-cooler-rear': 'The back of the cooling unit with filters on top and capped service ports below.',
  'power-distribution-cabinet': 'A power distribution cabinet next to the back of a rack fitted with two power strips.',
  'raised-floor': 'Racks and a cooler standing on raised floor tiles, some solid and some perforated.',
  'aisle-signs-and-rack-labels': 'An aisle sign over a door, a hanging aisle sign and small labels on top of the racks.',
  'server-damage': 'An intact compute server next to a dented, damaged one.',
  'half-racks-24u': 'Three half-height racks side by side: open, with front doors, and with front and rear doors.',
  'datacenter-cold-aisle-black-racks': 'The same cold aisle with every rack painted black.',
};

const shotByFile = (f: string) => shots.shots.find((s: any) => s.file === `img/${f}.jpg`);

/**
 * Caption corrections (controller ruling 2026-10-20): two shots.json captions overstate what the blocks do. The
 * workspace file stays as it is (outside this repo's scope); the site uses these corrected texts instead.
 */
const CAPTION_FIX: Record<string, string> = {
  // Copy pass 2026-10-20: plainer wording, no "like a real ..." flourishes or claims the blocks can't back up.
  'datacenter-cold-aisle':
    "Looking down the contained cold aisle of a two-aisle hall built only from the mod's blocks. The layout follows real data centers: cold air comes in through the floor and the in-row cooler, and hot air leaves through the backs of the racks.",
  'datacenter-hall-overhead':
    'Three rows of racks with a cold aisle and a hot aisle, each closed off with roof panels and sliding doors. In-row coolers, power cabinets and overhead cable trays fill out the room.',
  'containment-doors-and-aisle-signs':
    'The sliding doors at the end of each aisle, with blue (cold) and red (hot) aisle signs above them. The doors open and close in game.',
  'rack-42u-rear-power-strips':
    "The same rack from the back with the rear doors open: two vertical power strips (feed A and feed B, for redundant power) and the servers' rear panels.",
  'kvm-console-open':
    'The KVM drawer pulled out with its screen folded up. With scripts on, the drawer slides out first and then the screen lifts.',
  'overhead-cable-trays':
    'Cable trays hung from ceiling rods over a row of racks: a tee branching off, reducers stepping the bundle down, and drops that run cables down into each rack.',
  'datacenter-cold-aisle-black-racks':
    "The same cold aisle with the racks painted black. Every block takes the player's paint color.",
  'in-row-cooler-rear':
    "The cooler's back: the return-air filters on top and, below them, the oxygen and coolant service ports. They are decorative and blanked off for now, reserved for when the game adds air systems.",
  'power-distribution-cabinet':
    'A PDU (power distribution unit) cabinet beside a rack seen from behind, its two power strips in place. The cabinet is decorative: it gives the row the look of a real hall, and a cable tray drop over it lands in its top brush plates.',
};
export const captionOf = (name: string): string => CAPTION_FIX[name] ?? shotByFile(name).caption;
const animByName = (n: string) => shots.anims.find((a: any) => a.mp4 === `anim/${n}.mp4`);
/** Loop caption corrections (copy pass 2026-10-20), same idea as CAPTION_FIX. */
const LOOP_CAPTION_FIX: Record<string, string> = {
  'kvm-drawer': 'The KVM drawer slides out, the screen lifts and settles with a small spring, then it folds away and the drawer slides back in. This is the scripted motion.',
};

export function still(name: string, focal?: [number, number]): Img {
  const s = shotByFile(name);
  if (!s) throw new Error(`no shot ${name}`);
  return { file: `showcase/img/${name}.jpg`, alt: ALT[name], caption: captionOf(name), ...(focal ? { focalX: focal[0], focalY: focal[1] } : {}) };
}
export function loop(name: string): Vid & { title: string } {
  const a = animByName(name);
  if (!a) throw new Error(`no anim ${name}`);
  return { mp4: `showcase/anim/${name}.mp4`, poster: `showcase/anim/${name}.jpg`, caption: LOOP_CAPTION_FIX[name] ?? a.caption, title: a.title };
}
const shotTitle = (name: string) => shotByFile(name).title as string;

export const STILLS = shots.shots.map((s: any) => s.file.replace(/^img\/|\.jpg$/g, '')) as string[];
export const LOOPS = shots.anims.map((a: any) => a.mp4.replace(/^anim\/|\.mp4$/g, '')) as string[];

// ---------------------------------------------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------------------------------------------
export const categories = [
  { name: 'Dev log', slug: 'dev-log', description: 'Progress updates.' },
  { name: "How it's made", slug: 'how-its-made', description: 'Modeling, animation and testing.' },
  { name: 'Release notes', slug: 'release-notes', description: 'What changed in each mod release.' },
  { name: 'Ideas', slug: 'ideas', description: 'Mod ideas being researched, and what blocks them.' },
].map((c) => ({ ...c, visibility: 'public' as Vis, publish: true }));

export const tags = [
  { name: 'Data Center', slug: 'data-center' },
  { name: 'Blender', slug: 'blender' },
  { name: 'Procedural modeling', slug: 'procedural-modelling' },
  { name: 'Animation', slug: 'animation' },
  { name: 'Scripting', slug: 'scripting' },
  { name: 'SE2 4.0', slug: 'se2-4-0' },
].map((t) => ({ ...t, visibility: 'public' as Vis, publish: true }));

// Display name and avatar are the user's call (HANDOFF §4): a neutral studio byline until then, kept private.
export const author = {
  name: STUDIO, slug: 'studio', bio: 'A small team making game mods, starting with Space Engineers 2.',
  visibility: 'private' as Vis, confirm: true, publish: true,
};

// ---------------------------------------------------------------------------------------------------------------
// Games (2026-10-20: the site covers game mods in general, structured by game; Space Engineers 2 first)
// ---------------------------------------------------------------------------------------------------------------
export interface LinkSeed { label: string; url: string; kind?: string }
export interface GameSeed extends Base {
  name: string; slug: string; shortName: string; tagline: string; summary?: string; art?: Img; links: LinkSeed[];
  platformNotes?: Block[]; legalNotice?: string; featured?: boolean; sortOrder?: number;
}
export const SE2 = 'space-engineers-2';
export const games: GameSeed[] = [
  {
    name: 'Space Engineers 2', slug: SE2, shortName: 'SE2', featured: true, sortOrder: 10,
    tagline: 'A space building game by Keen Software House.',
    summary: 'Our mods for this game. The blocks are modeled in Blender and tested in game.',
    // Our own render (never the publisher's key art): game art on this site is always our renders or captures.
    art: { file: 'showcase/img/datacenter-hall-overhead.jpg', alt: 'Overhead view of a server hall built from Data Center blocks: rows of racks, aisle roofs, coolers and cable trays.', focalX: 0.5, focalY: 0.45 },
    links: [{ label: 'Space Engineers 2 on Steam', url: 'https://store.steampowered.com/app/1133870/', kind: 'steam' }],
    platformNotes: md(`
- **Getting mods:** SE2 mods are published to the Steam Workshop through Keen's Mod HUB. Nothing is released yet. Each mod page will link to its Workshop item.
- **Scripts:** some mods here have optional C# scripts. The game runs mod scripts only when it is started with \`-loadScripts\` (Steam → Properties → Launch Options). Saves are identical with or without them.
- **Platforms:** tested on Windows, and on Linux through Proton.
- **Game versions:** every mod page says which version it was tested on in game and which version it was built for.
`),
    legalNotice: `Space Engineers is a trademark of Keen Software House. ${STUDIO} is not affiliated with or endorsed by Keen Software House.`,
    visibility: 'public', confirm: true, publish: true,
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Mods
// ---------------------------------------------------------------------------------------------------------------
export interface ModSeed extends Base {
  name: string; slug: string; game: string; tagline: string; summary?: string; modStatus: 'published' | 'wip' | 'idea';
  stage?: string; blockedReason?: string; feasibility?: string; featured?: boolean; sortOrder?: number;
  gameVersionTested?: string; gameVersionBuilt?: string; requiresScripts?: 'no' | 'optional' | 'required'; requirements?: Block[]; license?: string;
  currentVersion?: string; heroMedia?: Visual; heroCaption?: string; cardImage?: Img; stats?: { value: string; label: string; note?: string }[]; specs?: { label: string; value: string }[];
  features?: { title: string; body: string; visual?: Visual }[]; gallery?: GalleryItem[]; body?: Section[];
  tags?: string[];
}

const kvm = loop('kvm-drawer');
const coldWalk = loop('cold-aisle-walk');

export const dataCenter: ModSeed = {
  name: 'Data Center',
  slug: 'data-center',
  game: SE2,
  tagline: 'Server racks, rack servers, cable trays and the room around them.',
  summary:
    '19-inch racks in 24U and 42U, ten rack servers (six are working automation blocks), 38 overhead cable-tray blocks and 19 room pieces: raised floor, an in-row cooler, aisle doors and roof panels, power and signs.',
  modStatus: 'wip',
  stage: 'testing',
  currentVersion: '0.9.0',
  visibility: 'public',
  confirm: true,
  publish: true,
  featured: true,
  sortOrder: 10,
  gameVersionTested: '2.4.0.95',
  gameVersionBuilt: '4.0.0.3151',
  requiresScripts: 'optional',
  license: 'GPL-3.0',
  heroMedia: { kind: 'video', video: { mp4: coldWalk.mp4, poster: coldWalk.poster, caption: coldWalk.caption } },
  heroCaption: 'Walking into the cold aisle of a hall built only from the mod’s blocks.',
  cardImage: still('datacenter-cold-aisle', [0.5, 0.55]),
  // "What's in it": one stat per block family; the count drives the bar width on the mod page.
  stats: [
    { value: '6', label: 'Server racks', note: 'Open frame, split front doors, or doors front and back. 24U or 42U.' },
    { value: '10', label: 'Rack servers', note: 'Compute, storage, a network switch, a UPS you can swap cells in, a KVM console.' },
    { value: '38', label: 'Cable trays', note: 'Straights, turns, tees, drops into the racks, and hanger rods to hold them up.' },
    { value: '19', label: 'The room', note: 'Raised floor, chilled-water in-row coolers, power cabinets, containment doors and roofs, aisle signs.' },
  ],
  specs: [
    { label: 'Version', value: '0.9.0, in testing. Not stable yet; not on the Workshop yet.' },
    { label: 'License', value: 'GPL-3.0. The source goes public at release.' },
    { label: 'Scripts', value: 'Optional. Everything works without them; with them, the KVM drawer gets its full motion.' },
    { label: 'Build menu', value: 'Automation, then Data Center. Size variants share a name.' },
    { label: 'Racks', value: '24U holds 4 servers. 42U holds 8, plus an overhead tray and fans.' },
    { label: 'Layout', value: 'Rows on a 1 m pitch. Containment for 1.0, 1.5 and 2.0 m aisles.' },
    { label: 'Building', value: 'Construction stages with scaffolding on every block.' },
    { label: 'Damage', value: 'Blocks break apart by zone and switch to proper damaged models.' },
    { label: 'Signs', value: 'Aisle signs and rack labels are editable LCDs.' },
  ],
  features: [
    {
      title: 'Server racks',
      body: 'Two heights: 24U with 4 server slots, and 42U with 8 slots, a fan tray and an overhead cable-tray mount. Each comes as an open frame, with split front doors, or with front and rear doors. The perforated doors swing 85° toward the aisle.',
      visual: { kind: 'video', video: { ...loop('rack-doors') } },
    },
    {
      title: 'Working rack servers',
      body: 'The Timer, Event Controller, Status Display (an LCD), UPS (a battery with two swappable Power Cell bays) and Programmable servers work like the vanilla blocks. The KVM console is the sixth working server. Compute, Storage, Network Switch and Blanking Panel are there to fill the rack.',
      visual: { kind: 'image', image: still('server-lineup') },
    },
    {
      title: 'Cable trays',
      body: 'Overhead wire-basket trays in four cable densities. The set has straights, turns, tees, crosses, reducers, and drops that run cables down into the racks. Cable lanes match at every joint. The data cables take the block paint.',
      visual: { kind: 'image', image: still('overhead-cable-trays') },
    },
    {
      title: 'Room pieces',
      body: 'Raised floor tiles, an in-row cooler whose fans spin up when powered, a PDU cabinet, rack power strips, sliding containment doors, roof panels, and aisle signs and rack labels with editable text. With them you can build a contained cold aisle like the ones in real data centers.',
      visual: { kind: 'video', video: { ...loop('containment-door') } },
    },
    {
      title: 'KVM console',
      body: 'Switch the KVM server on and its keyboard drawer slides out and the screen folds up. With scripts on, the drawer slides first and then the screen lifts with a small spring. It waits for the rack doors to open, and if you switch it mid-motion it reverses from where it is.',
      visual: { kind: 'video', video: { mp4: kvm.mp4, poster: kvm.poster, caption: kvm.caption } },
    },
    {
      title: 'Damage models',
      body: 'Every block has fracture zones, a dented model for when it is damaged and a broken one for when it is destroyed. They follow the vanilla fracture rules.',
      visual: { kind: 'image', image: still('server-damage') },
    },
  ],
  gallery: [
    ...STILLS.map((n) => ({ kind: 'image' as const, image: still(n), title: shotTitle(n), caption: captionOf(n) })),
    ...LOOPS.map((n) => {
      const l = loop(n);
      return { kind: 'loop' as const, video: { mp4: l.mp4, poster: l.poster, caption: l.caption }, title: l.title, caption: l.caption };
    }),
  ],
  requirements: md(`
The mod works **without scripts**. Its C# scripts add three things: the sequenced KVM motion, a KVM that waits for the rack doors, and the Programmable server's script editor. Space Engineers 2 runs mod scripts only when the game is started with \`-loadScripts\`.

- **Steam (Windows, or Linux through Proton):** Library → Space Engineers 2 → Properties → Launch Options, add \`-loadScripts\`. Remove it to go back.
- **Saves are identical** with and without scripts, so you can switch at any time.
- **Multiplayer:** every player and the server should use the same setting. The differences are visual only.
`),
  body: [
    {
      __component: 'sections.rich-text',
      content: md(`
## Build a hall in this order

1. **Lay the raised floor first.** Racks, the cooler, the PDU cabinet and the doors all stand on the tiles. Put perforated tiles where the cold air comes up.
2. **Set out the rows.** Racks, the in-row cooler and the PDU cabinet share one footprint (1.0 m wide, 1.25 m deep, 2.5 m tall), so a row stays on a 1.0 m pitch.
3. **Pick the aisle widths:** 1.0, 1.5 or 2.0 m. Doors and roof panels come in each width.
4. **Close the aisles** with the sliding containment doors at the row ends and roof panels along the top.
5. **Hang the cable trays** on hanger rods 0.5 m above the rack tops and drop cables into each rack.
6. **Sign it.** Aisle signs and rack labels are LCDs: type your own text, and paint the frame blue (cold) or red (hot).
`),
    },
    {
      __component: 'sections.callout',
      tone: 'caution',
      title: 'In testing',
      body: md('Data Center is being tested in game. Block names, costs and PCU may change before the first release, so don’t build anything you can’t rebuild.'),
    },
  ],
  tags: ['data-center', 'blender', 'procedural-modelling', 'animation', 'scripting'],
};

/** Private seed entries (seed/private.ts, gitignored): absent in a fresh clone and in CI, so everything below works without it. */
export interface PrivateSeed {
  ideaMods?: ModSeed[];
  milestones?: (Omit<RoadmapSeed, 'sortOrder'> & { sortOrder: number })[];
  retiredSeedEntries?: [string, string][];
}
const PRIVATE_FILE = path.join(SEED, 'private.ts');
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const privateSeed: PrivateSeed = fs.existsSync(PRIVATE_FILE) ? require(PRIVATE_FILE) : {};

/** Idea cards (privateDraft): created as private drafts; the user flips each to public. Teasers only: a name and one
 *  vague line, never the mechanism, the feasibility or anything another modder could build from. From seed/private.ts. */
export const ideaMods: ModSeed[] = privateSeed.ideaMods ?? [];

// ---------------------------------------------------------------------------------------------------------------
// History (from timeline.public.json: allow-listed families and milestones only)
// ---------------------------------------------------------------------------------------------------------------
const FAMILY_SHORT: Record<string, string> = {
  rack42: '42U rack', servers: 'Servers', trays: 'Cable trays', 'room-shell': 'Room shell', 'room-equipment': 'Room equipment', 'hero-hall': 'Hero hall',
};
const toIso = (d: string) => new Date(d.replace(' ', 'T') + ':00Z').toISOString();

/**
 * History note clean-up (copy pass 2026-10-20). timeline.public.json is generated from the workspace timeline and keeps
 * its internal references; the site drops them: design-ruling numbers ("Ruling 6", "Ruling P2-21") and commit hashes
 * mean nothing to a reader. A few notes whose wording depended on a ruling are rewritten in NOTE_FIX (keyed by the
 * original note's first words). Nothing is added that the original note didn't say.
 */
const NOTE_FIX: [string, string][] = [
  ['Tee turns in grouped bundles (a real tray tee, Ruling P2-18)', 'Tee turns in grouped bundles, like a real tray tee, and a cross saddle; still a plan sheet.'],
  ['KVM with a pop-out drawer and screen driven by a Working-state animation; Ruling 15', 'KVM with a pop-out drawer and screen driven by a Working-state animation; an On/Off toggle was added so it follows the player.'],
  ['Style calibration against vanilla blocks; "SE-ified"', 'Styled to match vanilla blocks; every mockup re-rendered in the game’s look.'],
  ['The first play-test failed to load the world', 'The first play-test failed to load the world because the breakable-block validator rejected servers and trays; a hotfix made them non-breakable.'],
];
export function cleanNote(note: string | undefined): string | undefined {
  if (!note) return note;
  const fix = NOTE_FIX.find(([start]) => note.startsWith(start));
  if (fix) return fix[1];
  return note
    .replace(/\s*\((?:Ruling [^)]*|[0-9a-f]{7,8}(?:, [0-9a-f]{7,8})*)\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const families = timeline.families.map((f: any, i: number) => ({
  familyId: f.id,
  name: f.name,
  shortName: FAMILY_SHORT[f.id] ?? f.name,
  slug: f.id,
  summary: cleanNote(f.summary),
  mod: 'data-center',
  sortOrder: (i + 1) * 10,
  visibility: 'public' as Vis,
  confirm: true,
  publish: true,
  stages: f.stages.map((s: any) => ({
    date: toIso(s.date),
    label: s.label,
    note: cleanNote(s.note),
    image: { file: `history/${s.img}`, alt: `${f.name}: ${s.label}` },
    thumb: { file: `history/${s.thumb}`, alt: `${f.name}: ${s.label} (thumbnail)` },
  })),
}));

// ---------------------------------------------------------------------------------------------------------------
// Roadmap (milestone collection). One plain line per item. "done" items are a handful of high-level steps, not the
// per-task log (that lives in the build-history renders). Future items follow the teaser rule: a name and one vague
// line, never how something works. Nothing private goes here (no unreleased mod names): private teasers are in seed/private.ts.
// ---------------------------------------------------------------------------------------------------------------
export type Phase = 'done' | 'now' | 'next' | 'later';
export interface RoadmapSeed extends Base { phase: Phase; date?: string; label: string; note?: string; mod?: string; sortOrder: number }
const rm = (phase: Phase, label: string, note: string, extra: Partial<RoadmapSeed> = {}): Omit<RoadmapSeed, 'sortOrder'> => ({
  phase, label, note, visibility: 'public', confirm: true, publish: true, ...extra,
});
/** The committed roadmap items (the web fixtures use only these). */
export const publicMilestones: RoadmapSeed[] = [
  // Data Center
  rm('done', 'First mockups', 'Racks, servers, cable trays and the room roughed out, then matched to the game’s look.', { mod: 'data-center', date: '2026-10-17T16:00:00.000Z' }),
  rm('done', 'Racks and servers in game', 'Both rack heights, all ten servers and the KVM drawer, placed and working in a test world.', { mod: 'data-center', date: '2026-10-18T22:00:00.000Z' }),
  rm('done', 'Cable trays', '38 tray blocks in four cable densities, lined up at every joint.', { mod: 'data-center', date: '2026-10-18T23:00:00.000Z' }),
  rm('done', 'The server room', 'Raised floor, cooling, aisle doors, power and signs, plus a two-aisle hall to test it all in.', { mod: 'data-center', date: '2026-10-19T02:00:00.000Z' }),
  rm('now', 'Testing in game', 'Building halls, fixing what breaks, settling costs and PCU.', { mod: 'data-center' }),
  rm('now', 'Getting 0.9.0 ready', 'The first public release, on the Steam Workshop.', { mod: 'data-center' }),
  rm('next', 'Source on GitHub', 'The generators, scripts and tests, so anyone can read them or send a fix.', { mod: 'data-center' }),
  rm('next', 'Fixes from players', 'Whatever turns up once people start building with it.', { mod: 'data-center' }),
  rm('later', 'Add-ons', 'A few ideas that build on Data Center. More when they’re ready.', { mod: 'data-center' }),
  // Studio-wide (no mod)
  rm('now', 'Another Space Engineers 2 mod', 'In the works. Not ready to show yet.'),
  rm('next', 'More people building mods', 'We’d like more hands on the next ones. Anyone can join in.'),
  rm('later', 'Other games', 'One game at a time. Space Engineers 2 comes first.'),
].map((m, i) => ({ ...m, sortOrder: (i + 1) * 10 }));

/** Everything the seed writes: the public items plus the private teasers from seed/private.ts, in sortOrder. */
export const milestones: RoadmapSeed[] = [...publicMilestones, ...(privateSeed.milestones ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

// ---------------------------------------------------------------------------------------------------------------
// Blog posts (privateDraft: drafts, private; the user edits and publishes)
// ---------------------------------------------------------------------------------------------------------------
export interface PostSeed extends Base {
  title: string; slug: string; subtitle?: string; excerpt: string; cover?: Img; date: string; category: string; tags: string[];
  relatedMods: string[]; games?: string[]; body: Section[];
  /** Spoiler post: unfinished content from the game files; readers accept a warning before the body shows. */
  spoiler?: boolean;
}

const famStages = (id: string) => families.find((f: any) => f.familyId === id)!.stages;
const stageImg = (id: string, n: number) => famStages(id)[n - 1].image as Img;

export const posts: PostSeed[] = [
  {
    title: `Hello from ${STUDIO}`,
    slug: 'hello-from-the-studio',
    subtitle: 'What this site is for and what we’re working on.',
    excerpt: `${STUDIO} is a small team making game mods, starting with Space Engineers 2. The first mod, Data Center, is in testing.`,
    cover: still('datacenter-hall-overhead', [0.5, 0.45]),
    date: '2026-10-19',
    category: 'dev-log',
    tags: ['data-center'],
    relatedMods: ['data-center'],
    games: [SE2],
    visibility: 'private',
    publish: false,
    body: [
      {
        __component: 'sections.rich-text',
        content: md(`
${STUDIO} is a small team making game mods. The first game is Space Engineers 2.

## What we make

Blocks based on real hardware, where every moving part does its job in the game. The first mod, **Data Center**, is in testing.

## What's next

Progress goes in this dev log, plans go on the [roadmap](/roadmap), and if you'd like to help build mods, [say hi](/about).
`),
      },
      { __component: 'sections.mod-card', mod: 'data-center' },
    ],
  },
  {
    title: 'How the Data Center was made',
    slug: 'how-the-data-center-was-made',
    subtitle: 'The saved renders, from the first mockup to the finished hall.',
    excerpt: 'The saved renders from the Data Center build, in order: racks, servers, cable trays, room shell, room equipment and the finished hall, with a note on what changed at each step.',
    cover: stageImg('hero-hall', famStages('hero-hall').length),
    date: '2026-10-19',
    category: 'how-its-made',
    tags: ['data-center', 'blender', 'procedural-modelling'],
    relatedMods: ['data-center'],
    games: [SE2],
    visibility: 'private',
    publish: false,
    body: [
      {
        __component: 'sections.rich-text',
        content: md(`
Data Center went from a first mockup to a finished hall in about three days. The generators saved a render at most steps. This post goes through them by family.

## Mockups first

The first images were quick mockups to settle proportions: how wide a 42U rack is next to a vanilla block, how deep a server is, how a door leaf hangs. They were never meant to ship. The second round switched them to the game's material roles so they matched vanilla blocks.
`),
      },
      {
        __component: 'sections.compare',
        before: stageImg('rack42', 1),
        after: stageImg('rack42', famStages('rack42').length),
        beforeLabel: 'Mockup v1',
        afterLabel: 'Final',
        caption: 'The 42U rack, first mockup against the final block.',
      },
      { __component: 'sections.timeline-embed', family: 'rack42' },
      {
        __component: 'sections.rich-text',
        content: md(`
## The rack had to be 1.0 m wide

The first rack export came out 4 cells (1.0 m) wide so a 2-cell server could be centered with mountable sides. That set the pitch for the rest of the hall: racks, the in-row cooler and the PDU cabinet all share the same 1.0 m by 1.25 m footprint, so rows stay on a 1.0 m grid.

## Servers

Six of the ten servers are working automation blocks (timer, event controller, status display, UPS, programmable and KVM). The other four are there to fill the rack. Each server got layered bezels, LEDs and rear panels, because a rack of flat boxes looked cheap.
`),
      },
      { __component: 'sections.timeline-embed', family: 'servers' },
      {
        __component: 'sections.rich-text',
        content: md(`
## Trays, room and hall

The cable trays have their own post. The room came last: raised floor, containment doors, the cooler, PDUs and signs, then the two-aisle hall used for the screenshots.
`),
      },
      { __component: 'sections.timeline-embed', family: 'room-shell' },
      { __component: 'sections.timeline-embed', family: 'hero-hall' },
      {
        __component: 'sections.code',
        language: 'bash',
        filename: 'Steam launch options',
        code: '-loadScripts',
        caption: 'The launch option that turns on the optional scripts. The mod works without it.',
      },
      {
        __component: 'sections.gallery',
        layout: 'strip',
        items: ['datacenter-cold-aisle', 'datacenter-hall-overhead', 'datacenter-cold-aisle-black-racks'].map((n) => ({
          kind: 'image' as const, image: still(n), title: shotTitle(n), caption: captionOf(n),
        })),
      },
    ],
  },
  {
    title: 'Making a KVM drawer feel right',
    slug: 'making-a-kvm-drawer-feel-right',
    subtitle: 'Moving the drawer and the screen one after the other.',
    excerpt: 'Without scripts, the KVM drawer slides and the screen folds at the same time, and it looks wrong. With scripts, the drawer slides first, pauses, and then the screen lifts with a small spring.',
    cover: still('kvm-console-open', [0.5, 0.5]),
    date: '2026-10-19',
    category: 'how-its-made',
    tags: ['data-center', 'animation', 'scripting'],
    relatedMods: ['data-center'],
    games: [SE2],
    visibility: 'private',
    publish: false,
    body: [
      {
        __component: 'sections.rich-text',
        content: md(`
A rack-mounted KVM is a keyboard and a fold-down monitor on a sliding drawer. In a real rack you pull the drawer out until it stops, then lift the screen. Two motions, one after the other.

The game's animation data can only move parts at the same time. Without scripts, the drawer slides and the screen folds together. It works, but it doesn't look like the real thing.
`),
      },
      { __component: 'sections.loop-video', video: { mp4: kvm.mp4, poster: kvm.poster, caption: kvm.caption }, size: 'wide' },
      {
        __component: 'sections.rich-text',
        content: md(`
## The sequence

With scripts on, a small sequencer runs the motion:

1. The drawer slides out.
2. A short pause, like a real drawer stopping at the end of its rails.
3. The screen folds up and settles with a small spring at the top.

Switching it off runs the same steps backwards: fold first, then slide in. Switch it halfway through and it reverses from where it is instead of snapping.

## Rack doors

A KVM behind closed rack doors would push straight through them, so the script waits. The KVM stays stowed while the doors are closed, comes out shortly after they are fully open, and stows quickly as soon as they start to close. Only a door on the KVM's side counts.
`),
      },
      {
        __component: 'sections.callout',
        tone: 'note',
        title: 'Scripts are optional',
        body: md('Everything here needs the game to be started with `-loadScripts`. Without it, the KVM uses the plain data-only motion, and nothing breaks. Saves are identical either way.'),
      },
      { __component: 'sections.image', image: still('kvm-console-open'), size: 'wide' },
    ],
  },
  {
    title: 'Cable trays that always line up',
    slug: 'cable-trays-that-always-line-up',
    subtitle: '38 blocks in four cable densities, with lanes that match at every joint.',
    excerpt: 'How the 38 cable-tray blocks keep each cable bundle in the same lane across joints, and what reducers and drops do.',
    cover: still('overhead-cable-trays', [0.5, 0.4]),
    date: '2026-10-19',
    category: 'how-its-made',
    tags: ['data-center', 'procedural-modelling', 'blender'],
    relatedMods: ['data-center'],
    games: [SE2],
    visibility: 'private',
    publish: false,
    body: [
      {
        __component: 'sections.rich-text',
        content: md(`
Cable trays look wrong when the cables don't line up: a bundle jumps lanes at a joint, or ends in mid-air. So we designed the trays around fixed lanes first and shapes second.

## Four densities, fixed lanes

Each tray comes in four densities: **Empty** (just the basket), **Low** (two data bundles), **Moderate** (adds yellow fiber and gray power) and **Full** (adds a second data layer and black power). Every density puts its bundles in the same lanes, so a Low straight joined to a Low turn always matches.

## Reducers and mismatched joints

A **Reducer** steps the density down one level, and reducers chain. You can also join two densities directly: the shared lanes match and the extra lanes end cleanly at the joint.

## Drops into the racks

A **Drop** carries two waterfalls of cable down into a full rack's front cable managers. Over a 24U half rack, a Long Drop Chute under the Drop makes up the height.
`),
      },
      { __component: 'sections.image', image: still('overhead-cable-trays'), size: 'full' },
      { __component: 'sections.timeline-embed', family: 'trays' },
      {
        __component: 'sections.stat-grid',
        stats: [
          { value: '38', label: 'tray blocks' },
          { value: '4', label: 'cable densities' },
          { value: '0.5 m', label: 'cost unit of run length' },
          { value: '5', label: 'PCU per tray block' },
        ],
      },
      {
        __component: 'sections.callout',
        tone: 'tip',
        title: 'Hanging height',
        body: md('Hanger rods snap only onto the tray’s rod plates. Hang a run 0.5 m above the rack tops, centered 0.125 m in front of the rack center, and the drops land in the cable managers.'),
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Single types (published; public pages by nature)
// ---------------------------------------------------------------------------------------------------------------
export const NOT_AFFILIATED =
  `${STUDIO} is an independent game-mod studio. It is not affiliated with or endorsed by the developers or publishers of the games it mods; game names are trademarks of their owners.`;

export const siteSettings = {
  // The site takes its display name from web/src/config/identity.json; the CMS copy is informational.
  siteName: STUDIO,
  shortName: STUDIO,
  description: `Game mods by ${STUDIO}, starting with Space Engineers 2: the mods, a dev log and the roadmap.`,
  defaultSeo: { metaTitle: STUDIO, metaDescription: 'Game mods for Space Engineers 2: the Data Center mod, a dev log and the roadmap.' },
  socialLinks: [{ label: 'RSS', url: '/rss.xml', kind: 'rss' }],
  notAffiliatedText: NOT_AFFILIATED,
  analyticsEnabled: false,
};

export const navigation = {
  header: [
    { label: 'Home', url: '/', kind: 'internal' },
    { label: 'Mods', url: '/mods', kind: 'internal' },
    { label: 'Roadmap', url: '/roadmap', kind: 'internal' },
    { label: 'Dev log', url: '/blog', kind: 'internal' },
    { label: 'About', url: '/about', kind: 'internal' },
  ],
  footer: [
    { title: 'Site', links: [{ label: 'Games', url: '/games' }, { label: 'Mods', url: '/mods' }, { label: 'Dev log', url: '/blog' }, { label: 'Roadmap', url: '/roadmap' }, { label: 'About', url: '/about' }] },
    { title: 'Studio', links: [{ label: 'Brand kit', url: '/brand' }, { label: 'Legal', url: '/legal' }, { label: 'RSS', url: '/rss.xml', kind: 'rss' }, { label: 'Releases feed', url: '/mods/releases.xml', kind: 'rss' }] },
    // Elsewhere (GitHub, Steam Workshop, mod.io): added when the user has public profiles (HANDOFF §4, M5).
  ],
};

export const homePage = {
  heroTagline: 'Game mods that work the way they look.',
  heroSubline: 'We’re a small team making mods for Space Engineers 2: blocks that look like they belong in the game, and work the way you’d expect.',
  heroMedia: { kind: 'video', video: { mp4: coldWalk.mp4, poster: coldWalk.poster, caption: coldWalk.caption } } as Visual,
  ctaPrimary: { label: 'Browse our mods', url: '/mods', kind: 'internal' },
  ctaSecondary: { label: 'See the roadmap', url: '/roadmap', kind: 'internal' },
  featuredMod: 'data-center',
  historyFamily: 'rack42',
  // The hero's two scroll beats (home page): title is the big line, body the one under it.
  principles: [
    { title: 'Every door opens.', body: 'Fans spin up, screens wake, and broken blocks come apart properly. We build everything to that standard.' },
    { title: 'Have a look inside.', body: 'Every mod gets its own page where you can pick up any block, paint it, power it and break it.' },
  ],
  seo: { metaTitle: `${STUDIO} · game mods`, metaDescription: 'Game mods for Space Engineers 2. The first, Data Center, adds server racks, rack servers, cable trays and room pieces.' },
};

export const aboutPage = {
  title: `About ${STUDIO}`,
  intro: `${STUDIO} is a small team making mods for Space Engineers 2. We build the blocks we want to play with, test them in the game, and share the source.`,
  body: [
    {
      __component: 'sections.rich-text',
      content: md(`
## What we care about

- **It works.** If something looks like it opens, it opens. Doors, drawers, fans and screens do their job in the game, not only in a render.
- **It fits.** Blocks should sit next to the game's own without standing out: same scale, same build stages, and damage that breaks them apart properly.
- **It's ours.** We model and texture everything ourselves. Scripts are always optional, so a mod still works on servers that turn them off.
- **It's open.** Our mods are GPL-3.0. The source goes public when a mod is released.

## How we work

Plans go on the [roadmap](/roadmap), progress goes in the [dev log](/blog), and nothing ships until it has been built, broken and rebuilt in a test world.
`),
    },
    { __component: 'sections.callout', tone: 'note', title: 'Not affiliated', body: md(NOT_AFFILIATED) },
  ] as Section[],
  seo: { metaTitle: 'About', metaDescription: `Who ${STUDIO} is, what we care about and how to help build mods.` },
};

export const brandPage = {
  boilerplateShort: `${STUDIO} is a small team making mods for Space Engineers 2. Its first mod, Data Center, adds server racks, rack servers, cable trays and server-room pieces.`,
  boilerplateLong:
    `${STUDIO} is a small, independent team making game mods, one game at a time, starting with Space Engineers 2. Its first mod, Data Center, adds 24U and 42U server racks, ten rack servers, 38 cable-tray pieces and 19 room pieces, with working doors, drawers and fans, construction stages and proper damage. ${STUDIO} mods are GPL-3.0. ${STUDIO} is not affiliated with the developers or publishers of the games it mods.`,
  body: [
    {
      __component: 'sections.rich-text',
      content: md(`
## Using the name and logo

- Write it as **${STUDIO}**: two words, capital R and L. The GitHub organization is **${IDENTITY.githubOrg}** (one word, lower case).
- Use the logo files from this page as they are: don't recolor, stretch, rotate, outline or add effects, and don't re-typeset the wordmark.
- Leave clear space around the logo of at least the height of the mark's letters.
- Don't use the logo in a way that suggests ${STUDIO} endorses something it doesn't.

The logo is a lab flask with a ringed planet inside it. Below 48 px, use the favicon mark (a simplified flask with one ember bubble).
`),
    },
  ] as Section[],
  seo: { metaTitle: 'Brand and press kit', metaDescription: `${STUDIO} name, logo, colors, typefaces and boilerplate text.` },
};

export const legalPage = {
  body: [
    {
      __component: 'sections.rich-text',
      content: md(`
## Not affiliated

${NOT_AFFILIATED}

Images and videos on this site are renders and in-game captures of ${STUDIO}'s own mods. No game asset files are distributed here. Each game's own trademark notice is listed below and on its game page.

## Licenses

Each mod's license is shown on its page and links to the LICENSE file in its source repository once that repository is public.

## Privacy and analytics

This site sets no cookies and has no accounts, comments or forms. If analytics are enabled, they use Cloudflare Web Analytics, which is cookieless and records page views, referrers, country and page-load performance, without personal data.

## Credits

- Typefaces: **Barlow**, **Barlow Condensed** (SIL Open Font License) and **JetBrains Mono** (SIL Open Font License).
- Built with Astro and Strapi. Code highlighting by Shiki.
`),
    },
  ] as Section[],
  seo: { metaTitle: 'Legal', metaDescription: `Not-affiliated notice, licenses, privacy and credits for ${IDENTITY.domain}.` },
};

// ---------------------------------------------------------------------------------------------------------------
// 3D block models (M7): GLBs built by tools/export-glb (our geometry + flat web materials only), validated `clean`.
// The manifest (web/src/data/models.json) is written by tools/export-glb/finish.mjs.
// ---------------------------------------------------------------------------------------------------------------
const MODELS = JSON.parse(fs.readFileSync(path.join(SEED, '..', '..', 'web', 'src', 'data', 'models.json'), 'utf8'));
const PROV_DIR = path.join(SEED, '..', '..', 'tools', 'export-glb', 'provenance');
const provenanceOf = (slug: string) => {
  try { return JSON.parse(fs.readFileSync(path.join(PROV_DIR, `${slug}.provenance.json`), 'utf8')); } catch { return null; }
};
export const PAINT_PRESETS = [
  { label: 'Keen gray', hex: '#AAACAF' }, { label: 'Black', hex: '#292A2D' }, { label: 'Blue', hex: '#3561AD' },
  { label: 'Orange', hex: '#E18130' }, { label: 'White', hex: '#E1E2E5' }, { label: 'Teal', hex: '#279590' },
];
export interface BlockSeed extends Base {
  slug: string; name: string; mod: string; description: string; poster: Img; fallbackLoop?: Vid;
  animations: { clip: string; label: string; loop?: boolean }[]; cameraOrbit: string; dimensionsCells: string;
  glbPath: string; fileSizeBytes: number; triangles: number; provenance: 'clean' | 'needs-review'; provenanceNote: string;
}
const block = (slug: string, b: Omit<BlockSeed, 'slug' | 'glbPath' | 'fileSizeBytes' | 'triangles' | 'provenance' | 'provenanceNote' | 'mod' | 'visibility' | 'confirm' | 'publish'>): BlockSeed => {
  const m = MODELS[slug];
  if (!m) throw new Error(`no built model ${slug}: run tools/export-glb`);
  const prov = provenanceOf(slug);
  const v = prov?.validation;
  return {
    slug, mod: 'data-center', visibility: 'public', confirm: true, publish: true, ...b,
    glbPath: m.glbPath, fileSizeBytes: m.bytes, triangles: m.triangles,
    provenance: prov?.status === 'clean' ? 'clean' : 'needs-review',
    provenanceNote: v
      ? `Validated ${v.at.slice(0, 10)}: ${v.triangles} tris, ${v.materials} web materials, ${prov.kitPartsReplaced.length} Keen kit part(s) replaced with our own frames, ${prov.glyphQuadsRemapped} stencil glyphs on our own atlas, Keen decals dropped: ${JSON.stringify(prov.decalsDropped)}.`
      : 'Not validated yet.',
  };
};
const rackLoop = loop('rack-42u-turntable');
const kvmLoop = loop('kvm-drawer');
const fanLoop = loop('cooler-fans-spin-up');
export const blocks3d: BlockSeed[] = [
  block('dc-rack42-splitfront', {
    name: '42U rack, split front doors',
    description: 'A full-height 42U server rack, 1.0 m wide, 1.25 m deep and 2.5 m tall, with split perforated front doors that swing 85 degrees, a fan tray and an overhead cable-tray mount. Shown empty.',
    poster: still('rack-42u-front-loaded'), fallbackLoop: { mp4: rackLoop.mp4, poster: rackLoop.poster, caption: rackLoop.caption },
    animations: [{ clip: 'DoorsOpen', label: 'Open doors' }, { clip: 'DoorsClose', label: 'Close doors' }],
    cameraOrbit: '200deg 78deg 5.2m', dimensionsCells: '4 × 5 × 10 cells (1.0 × 1.25 × 2.5 m)',
  }),
  block('dc-srv-kvm', {
    name: 'KVM console server',
    description: 'A 6U rack server with a keyboard drawer that slides out and a screen that folds up, with the same slide-then-lift motion as the game script.',
    poster: still('kvm-console-open'), fallbackLoop: { mp4: kvmLoop.mp4, poster: kvmLoop.poster, caption: kvmLoop.caption },
    animations: [{ clip: 'KvmOpen', label: 'Open drawer' }, { clip: 'KvmClose', label: 'Stow drawer' }],
    cameraOrbit: '210deg 70deg 1.6m', dimensionsCells: '6U, one rack slot (about 0.9 × 1.05 × 0.25 m)',
  }),
  block('dc-crac', {
    name: 'In-row cooler (CRAC)',
    description: 'The in-row cooling unit: three large fans that ramp up over a two-second soft start when it is switched on, and decorative service ports on the back.',
    poster: still('in-row-cooler-front'), fallbackLoop: { mp4: fanLoop.mp4, poster: fanLoop.poster, caption: fanLoop.caption },
    animations: [{ clip: 'FansSpinUp', label: 'Switch on' }, { clip: 'FansRun', label: 'Run', loop: true }],
    cameraOrbit: '20deg 78deg 5m', dimensionsCells: '4 × 5 × 10 cells (1.0 × 1.25 × 2.5 m)',
  }),
  block('dc-tray-straight-full', {
    name: 'Cable tray, long straight, full',
    description: 'A 1.5 m wire-basket cable tray at full density: data bundles, yellow fiber, gray and black power, each in a fixed lane so runs line up across joints.',
    poster: still('overhead-cable-trays'),
    animations: [], cameraOrbit: '30deg 65deg 2.6m', dimensionsCells: '6 × 1 × 2 cells (1.5 × 0.25 × 0.5 m)',
  }),
];
