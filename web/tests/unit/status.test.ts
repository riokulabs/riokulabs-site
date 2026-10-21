import { describe, expect, it } from 'vitest';
import { BUCKETS, bucketCounts, modBucket, modState } from '../../src/lib/status';
import type { Mod } from '../../src/lib/types';

type M = Pick<Mod, 'status' | 'stage'>;
const label = (k: string) => BUCKETS.find((b) => b.key === k)!.label;

describe('mod status buckets (lib/status.ts)', () => {
  it('counts a prototype under Prototype, the same word as its badge (not "In testing")', () => {
    const limpet: M = { status: 'wip', stage: 'prototype' };
    expect(modState(limpet).label).toBe('Prototype');
    expect(modBucket(limpet)).toBe('prototype');
    expect(label(modBucket(limpet))).toBe('Prototype');
  });
  it.each([
    [{ status: 'published' }, 'released'],
    [{ status: 'wip', stage: 'testing' }, 'testing'],
    [{ status: 'wip', stage: 'beta' }, 'testing'],
    [{ status: 'wip', stage: 'prototype' }, 'prototype'],
    [{ status: 'wip' }, 'progress'],
    [{ status: 'wip', stage: 'blocked' }, 'progress'],
    [{ status: 'idea' }, 'works'],
    [{ status: 'idea', stage: 'researching' }, 'works'],
  ] as [M, string][])('%j → %s', (m, want) => expect(modBucket(m)).toBe(want));
  it('leaves out empty buckets and keeps the display order', () => {
    const mods: M[] = [{ status: 'idea' }, { status: 'wip', stage: 'prototype' }, { status: 'wip', stage: 'testing' }, { status: 'idea' }];
    expect(bucketCounts(mods).map((b) => [b.label, b.count])).toEqual([['In testing', 1], ['Prototype', 1], ['Drawing board', 2]]);
  });
});
