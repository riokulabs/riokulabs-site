/** One status vocabulary for tiles, mod heads and the roadmap: a filled state plus an optional detail ("Testing | v0.9.0"). */
import type { Mod, ModStatus } from './types';
export type Tone = 'amber' | 'blue' | 'live' | 'mute';
const STAGE: Record<string, string> = { researching: 'Researching', prototype: 'Prototype', testing: 'Testing', beta: 'Beta', blocked: 'Blocked', paused: 'Paused' };
export function modState(m: Pick<Mod, 'status' | 'stage'> & Partial<Pick<Mod, 'currentVersion' | 'releases'>>): { label: string; detail?: string; tone: Tone } {
  const v = m.currentVersion ?? m.releases?.[0]?.version;
  const detail = v ? `v${v.replace(/^v/, '')}` : undefined;
  if (m.status === 'published') return { label: 'Released', detail, tone: 'live' };
  if (m.status === 'wip') return { label: (m.stage && STAGE[m.stage]) || 'In progress', detail, tone: m.stage === 'blocked' || m.stage === 'paused' ? 'mute' : 'amber' };
  return { label: m.stage === 'researching' ? 'Early days' : 'Drawing board', tone: 'mute' };
}

/**
 * Filter buckets for the mod browser and the game counts. Stage-aware, so the bucket a mod is counted in always matches
 * the word on its badge (a "Prototype" is never counted "In testing").
 */
export type Bucket = 'released' | 'testing' | 'prototype' | 'progress' | 'works';
export const BUCKETS: { key: Bucket; label: string; lamp: ModStatus }[] = [
  { key: 'released', label: 'Released', lamp: 'published' },
  { key: 'testing', label: 'In testing', lamp: 'wip' },
  { key: 'prototype', label: 'Prototype', lamp: 'wip' },
  { key: 'progress', label: 'In progress', lamp: 'wip' },
  { key: 'works', label: 'Drawing board', lamp: 'idea' },
];
export function modBucket(m: Pick<Mod, 'status' | 'stage'>): Bucket {
  if (m.status === 'published') return 'released';
  if (m.status === 'idea') return 'works';
  if (m.stage === 'testing' || m.stage === 'beta') return 'testing';
  if (m.stage === 'prototype') return 'prototype';
  return 'progress';
}
/** Buckets with at least one mod, in display order, with their counts. */
export const bucketCounts = (mods: Pick<Mod, 'status' | 'stage'>[]) =>
  BUCKETS.map((b) => ({ ...b, count: mods.filter((m) => modBucket(m) === b.key).length })).filter((b) => b.count > 0);
