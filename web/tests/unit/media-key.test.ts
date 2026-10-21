import { describe, expect, it } from 'vitest';
import { mediaHash } from '../../src/lib/load';

describe('mediaHash', () => {
  it('is stable, 16 hex chars, and differs per URL', () => {
    const a = mediaHash('https://x.media.strapiapp.com/history_img_plan_3_task_2_first_room_0079c03130.jpg');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(mediaHash('https://x.media.strapiapp.com/history_img_plan_3_task_2_first_room_0079c03130.jpg')).toBe(a);
    expect(mediaHash('https://x.media.strapiapp.com/other.jpg')).not.toBe(a);
  });
});

