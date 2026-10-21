/**
 * Per-mod 3D block catalogues written by tools/export-glb (`node build.mjs --all --variants`): one JSON per mod in
 * src/data/models/<mod>.json, GLBs under public/models/<mod>/. Only files that passed validate.mjs are listed.
 */
export interface CatalogBlock {
  id: string; slug: string; displayName: string; family: 'rack' | 'server' | 'tray' | 'room'; subfamily?: string;
  sizeLabel: string | null; dims_m: [number, number, number]; tris: number; bytes: number; clips: string[];
  files: { intact: string; damaged?: string; fracture?: string; stages?: string };
  paintable: boolean; variants?: { stages?: { nodes: { node: string; build_ratio: number }[] } }; missing?: Record<string, string>;
}
const all = import.meta.glob<CatalogBlock[]>('../data/models/*.json', { eager: true, import: 'default' });
export function catalog(mod: string): CatalogBlock[] {
  return all[`../data/models/${mod}.json`] ?? [];
}
/** The blocks the home hall is built from, as GLB URLs (undefined if the catalogue isn't exported yet). */
export function hallModels() {
  const c = catalog('data-center'), url = (slug: string) => c.find((b) => b.slug === slug)?.files.intact;
  const servers = Object.fromEntries(['storage', 'compute', 'kvm', 'switch', 'programmable', 'status', 'eventctl', 'timer', 'blank']
    .map((n) => [n, url(`dc-srv-${n}`)]).filter(([, u]) => u));
  const rack = url('dc-rack42-splitfront'), crac = url('dc-crac'), tray = url('dc-tray-straight-full');
  return rack && crac && tray ? { rack, crac, tray, servers } : undefined;
}
