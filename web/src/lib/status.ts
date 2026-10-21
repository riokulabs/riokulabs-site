/** One status vocabulary for tiles, mod heads and the roadmap: a filled state plus an optional detail ("Testing | v0.9.0"). */
import type { Mod } from './types';
export type Tone = 'amber' | 'blue' | 'live' | 'mute';
const STAGE: Record<string, string> = { researching: 'Researching', prototype: 'Prototype', testing: 'Testing', beta: 'Beta', blocked: 'Blocked', paused: 'Paused' };
export function modState(m: Pick<Mod, 'status' | 'stage' | 'currentVersion' | 'releases'>): { label: string; detail?: string; tone: Tone } {
  const v = m.currentVersion ?? m.releases?.[0]?.version;
  const detail = v ? `v${v.replace(/^v/, '')}` : undefined;
  if (m.status === 'published') return { label: 'Released', detail, tone: 'live' };
  if (m.status === 'wip') return { label: (m.stage && STAGE[m.stage]) || 'In progress', detail, tone: m.stage === 'blocked' || m.stage === 'paused' ? 'mute' : 'amber' };
  return { label: m.stage === 'researching' ? 'Early days' : 'Drawing board', tone: 'mute' };
}
