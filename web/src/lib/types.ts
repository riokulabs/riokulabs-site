/**
 * The site's normalised content model (what pages render). Produced by lib/load.ts from either the Strapi REST API
 * or web/fixtures/content.json, after the visibility filter and the build assertion. Only public and unlisted entries
 * ever reach this shape.
 */
export type Visibility = 'public' | 'unlisted';
export type ModStatus = 'published' | 'wip' | 'idea';

/** Strapi "blocks" rich text (kept as-is; rendered by components/RichText.astro). */
export type RichBlocks = any[];

export interface Img {
  /** Key under src/assets/cms/ (resolved to an Astro ImageMetadata by components/Picture.astro). */
  src: string;
  alt: string;
  caption?: string;
  focalX: number;
  focalY: number;
  width: number;
  height: number;
  /** The CMS file's MIME type (e.g. image/png), when known: RSS enclosures use it. */
  mime?: string;
  /** Preview Worker only: the CMS URL of the original (drafts' media isn't in the static build). */
  remote?: string;
}

export interface Video {
  /** Public URL under /media/. */
  mp4: string;
  webm?: string;
  poster: Img;
  caption?: string;
}

export type Visual = { kind: 'image'; image: Img } | { kind: 'video'; video: Video };

export interface GalleryItem {
  kind: 'image' | 'loop';
  image?: Img;
  video?: Video;
  title?: string;
  caption?: string;
}

export interface Stat { value: string; label: string; note?: string }
export interface Spec { label: string; value: string }
export interface Link { label: string; url: string; kind: string; newTab: boolean }
export interface Seo { metaTitle?: string; metaDescription?: string; ogImage?: Img; noindex?: boolean; canonicalOverride?: string }

export type Section =
  | { type: 'rich-text'; content: RichBlocks }
  | { type: 'image'; image: Img; size: 'inline' | 'wide' | 'full' }
  | { type: 'gallery'; items: GalleryItem[]; layout: 'grid' | 'strip' }
  | { type: 'loop-video'; video: Video; size: 'inline' | 'wide' | 'full' }
  | { type: 'compare'; before: Img; after: Img; beforeLabel: string; afterLabel: string; caption?: string }
  | { type: 'code'; language: string; code: string; filename?: string; caption?: string }
  | { type: 'callout'; tone: 'note' | 'tip' | 'caution'; title?: string; body: RichBlocks }
  | { type: 'quote'; text: string; attribution?: string }
  | { type: 'model-embed'; block: string; caption?: string }
  | { type: 'mod-card'; mod: string }
  | { type: 'timeline-embed'; family: string; fromStage?: number; toStage?: number }
  | { type: 'stat-grid'; stats: Stat[] };

export interface Release {
  id: string;
  mod: string;
  version: string;
  releasedAt: string;
  channel?: string;
  gameVersion?: string;
  highlights: string[];
  notes?: RichBlocks;
  changeNoteUrl?: string;
  visibility: Visibility;
}

export interface Game {
  id: string;
  slug: string;
  name: string;
  /** Short label for chips ("SE2"); falls back to the name. */
  shortName: string;
  tagline: string;
  summary?: string;
  art?: Img;
  links: Link[];
  platformNotes?: RichBlocks;
  /** Trademark / not-affiliated line for this game (footer + /legal). */
  legalNotice?: string;
  featured: boolean;
  sortOrder: number;
  visibility: Visibility;
  seo?: Seo;
}

export interface Mod {
  id: string;
  slug: string;
  /** Slug of the mod's game. Every built mod has one (mods whose game isn't visible are dropped by lib/load.ts). */
  game: string;
  name: string;
  tagline: string;
  summary?: string;
  status: ModStatus;
  stage?: string;
  /** The version players can get (or are testing), e.g. 0.9.0. */
  currentVersion?: string;
  blockedReason?: string;
  feasibility?: string;
  visibility: Visibility;
  featured: boolean;
  sortOrder: number;
  /** Last version the mod was tested on in game. */
  gameVersionTested?: string;
  /** Version the mod was last built against (may be newer than tested). */
  gameVersionBuilt?: string;
  requiresScripts?: 'no' | 'optional' | 'required';
  requirements?: RichBlocks;
  steamWorkshopUrl?: string;
  modioUrl?: string;
  githubUrl?: string;
  license?: string;
  hero?: Visual;
  heroCaption?: string;
  card?: Img;
  stats: Stat[];
  specs: Spec[];
  features: { title: string; body?: string; visual?: Visual }[];
  gallery: GalleryItem[];
  body: Section[];
  tags: string[];
  releases: Release[];
  families: string[];
  updatedAt: string;
  seo?: Seo;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  excerpt: string;
  /** Unfinished content from the game files: the page asks the reader before showing the body. */
  spoiler: boolean;
  cover?: Img;
  date: string;
  updatedAt: string;
  updatedNote?: string;
  author?: string;
  category?: string;
  tags: string[];
  relatedMods: string[];
  /** Game slugs the post is about (explicit, plus the games of its related mods). */
  games: string[];
  body: Section[];
  visibility: Visibility;
  readingMinutes: number;
  seo?: Seo;
}

export interface Stage { date: string; label: string; note?: string; image?: Img; thumb?: Img }
export interface Family {
  id: string;
  familyId: string;
  slug: string;
  name: string;
  shortName: string;
  summary?: string;
  mod?: string;
  sortOrder: number;
  stages: Stage[];
  visibility: Visibility;
}
/** Roadmap phases, in display order. */
export const PHASES = ['done', 'now', 'next', 'later'] as const;
export type Phase = (typeof PHASES)[number];
/** One roadmap line (the CMS "milestone" collection). `date` is set on done items; `mod` empty = studio-wide. */
export interface Milestone { id: string; phase: Phase; date?: string; label: string; note?: string; mod?: string; sortOrder: number }
export interface Tag { slug: string; name: string; description?: string }
export interface Category { slug: string; name: string; description?: string }
export interface Author { slug: string; name: string; bio?: string; avatar?: Img; links: Link[] }
export interface Block3D {
  id: string;
  slug: string;
  name: string;
  mod?: string;
  glbPath?: string;
  fileSizeBytes?: number;
  poster: Img;
  fallbackLoop?: Video;
  description: string;
  dimensionsCells?: string;
  provenance: 'clean' | 'needs-review';
  triangles?: number;
  cameraOrbit?: string;
  animations: { clip: string; label: string; loop: boolean }[];
  paints: { label: string; hex: string }[];
  defaultPaint?: string;
}

export interface Site {
  generatedAt: string;
  source: 'fixtures' | 'strapi';
  settings: {
    siteName: string;
    shortName: string;
    description: string;
    defaultSeo?: Seo;
    socialLinks: Link[];
    notAffiliatedText: string;
    analyticsEnabled: boolean;
  };
  nav: { header: Link[]; footer: { title: string; links: Link[] }[] };
  home: {
    heroTagline: string;
    heroSubline?: string;
    heroMedia?: Visual;
    ctaPrimary?: Link;
    ctaSecondary?: Link;
    featuredMod?: string;
    historyFamily?: string;
    principles: { title: string; body?: string }[];
    seo?: Seo;
  };
  about: { title: string; intro?: string; body: Section[]; seo?: Seo };
  brand: { body: Section[]; boilerplateShort?: string; boilerplateLong?: string; seo?: Seo };
  legal: { body: Section[]; seo?: Seo };
  games: Game[];
  mods: Mod[];
  posts: Post[];
  families: Family[];
  milestones: Milestone[];
  tags: Tag[];
  categories: Category[];
  authors: Author[];
  blocks: Block3D[];
  redirects: { from: string; to: string; permanent: boolean }[];
  /** Every media key the pages may use: images (src/assets/cms) and videos (public/media). */
  media: { images: string[]; videos: string[] };
}
