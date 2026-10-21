import { describe, expect, it } from 'vitest';
import {
  assertFiltersSafe,
  assertSortSafe,
  GuardRejection,
  hardenPopulate,
  normalizePopulate,
  stripEntry,
  type SchemaLookup,
} from '../src/utils/visibility-query';

const vis = { type: 'enumeration' };
const S: Record<string, any> = {
  'api::mod.mod': {
    name: { type: 'string' }, visibility: vis,
    posts: { type: 'relation', target: 'api::blog-post.blog-post' },
    stats: { type: 'component', component: 'blocks.stat' },
    body: { type: 'dynamiczone', components: ['sections.mod-card'] },
    cover: { type: 'media' },
  },
  'api::blog-post.blog-post': {
    title: { type: 'string' }, visibility: vis,
    relatedMods: { type: 'relation', target: 'api::mod.mod' },
    category: { type: 'relation', target: 'api::nocheck.nocheck' },
  },
  'api::nocheck.nocheck': { name: { type: 'string' }, owner: { type: 'relation', target: 'api::mod.mod' } },
  'api::home-page.home-page': { featuredMod: { type: 'relation', target: 'api::mod.mod' } },
  'blocks.stat': { value: { type: 'string' } },
  'sections.mod-card': { mod: { type: 'relation', target: 'api::mod.mod' } },
};
const schema: SchemaLookup = (uid) => S[uid];
const guard = { visibility: { $in: ['public'] } };

describe('populate hardening', () => {
  it('expands * and filters visibility-bearing relations', () => {
    const p = hardenPopulate('*', 'api::mod.mod', schema, ['public']);
    expect(p.posts).toEqual({ filters: guard });
    expect(p.stats).toBe(true);
    expect(p.cover).toBe(true);
  });
  it('forces visibility into fields that omit it (finding 1)', () => {
    const p = hardenPopulate({ posts: { fields: ['title'] } }, 'api::mod.mod', schema, ['public']);
    expect(p.posts.fields).toEqual(['title', 'visibility']);
    expect(p.posts.filters).toEqual(guard);
  });
  it('recurses into nested populate, dotted strings and DZ fragments', () => {
    const p = hardenPopulate('posts.relatedMods', 'api::mod.mod', schema, ['public']);
    expect(p.posts.filters).toEqual(guard);
    expect(p.posts.populate.relatedMods).toEqual({ filters: guard });
    const dz = hardenPopulate({ body: { on: { 'sections.mod-card': { populate: { mod: { fields: ['name'] } } } } } }, 'api::mod.mod', schema, ['public']);
    expect(dz.body.on['sections.mod-card'].populate.mod).toEqual({ fields: ['name', 'visibility'], filters: guard });
  });
  it('keeps caller filters but ANDs the guard', () => {
    const p = hardenPopulate({ posts: { filters: { title: { $eq: 'x' } } } }, 'api::mod.mod', schema, ['public']);
    expect(p.posts.filters).toEqual({ $and: [{ title: { $eq: 'x' } }, guard] });
  });
  it('normalises string lists', () => {
    expect(normalizePopulate('posts,stats', 'api::mod.mod', schema)).toEqual({ posts: true, stats: true });
  });
});

describe('filter / sort oracle (finding 3)', () => {
  it('rejects filters through a relation into a visibility-bearing type', () => {
    expect(() => assertFiltersSafe({ posts: { title: { $eq: 'Secret' } } }, 'api::mod.mod', schema)).toThrow(GuardRejection);
    expect(() => assertFiltersSafe({ $or: [{ name: { $eq: 'a' } }, { posts: { title: 'b' } }] }, 'api::mod.mod', schema)).toThrow(GuardRejection);
    expect(() => assertFiltersSafe({ category: { owner: { name: 'x' } } }, 'api::blog-post.blog-post', schema)).toThrow(GuardRejection);
  });
  it('allows scalar filters and relations into unguarded types', () => {
    expect(() => assertFiltersSafe({ name: { $eq: 'a' }, $and: [{ visibility: 'public' }] }, 'api::mod.mod', schema)).not.toThrow();
    expect(() => assertFiltersSafe({ category: { name: { $eq: 'Dev log' } } }, 'api::blog-post.blog-post', schema)).not.toThrow();
  });
  it('rejects filters hidden inside populate', () => {
    expect(() => hardenPopulate({ posts: { filters: { relatedMods: { name: 'x' } } } }, 'api::mod.mod', schema, ['public'])).toThrow(GuardRejection);
  });
  it('rejects sorts through guarded relations', () => {
    expect(() => assertSortSafe('posts.title:asc', 'api::mod.mod', schema)).toThrow(GuardRejection);
    expect(() => assertSortSafe(['name:asc'], 'api::mod.mod', schema)).not.toThrow();
  });
});

describe('fail-closed strip', () => {
  it('removes guarded relations without a visibility field', () => {
    const entry: any = { name: 'DC', visibility: 'public', posts: [{ title: 'no vis field' }, { title: 'ok', visibility: 'public' }] };
    expect(stripEntry(entry, 'api::mod.mod', schema, ['public'])).toBe(1);
    expect(entry.posts).toEqual([{ title: 'ok', visibility: 'public' }]);
  });
  it('nulls a private single relation on a single type and walks DZ components', () => {
    const home: any = { featuredMod: { name: 'secret', visibility: 'private' } };
    expect(stripEntry(home, 'api::home-page.home-page', schema, ['public'])).toBe(1);
    expect(home.featuredMod).toBeNull();
    const mod: any = { visibility: 'public', body: [{ __component: 'sections.mod-card', mod: { name: 'x' } }] };
    expect(stripEntry(mod, 'api::mod.mod', schema, ['public'])).toBe(1);
    expect(mod.body[0].mod).toBeNull();
  });
});

describe('security review round 2', () => {
  it('rejects a dynamic-zone object populate without on-fragments', () => {
    expect(() => hardenPopulate({ body: { populate: { mod: true } } }, 'api::mod.mod', schema, ['public'])).toThrow(/on-fragments/);
    expect(() => hardenPopulate({ body: { on: { 'sections.mod-card': true }, filters: { x: 1 } } }, 'api::mod.mod', schema, ['public'])).toThrow(/on-fragments/);
    expect(hardenPopulate({ body: true }, 'api::mod.mod', schema, ['public']).body).toBe(true);
  });
  it('hardens on-fragments: nested relations get the guard, unknown components are rejected', () => {
    const p = hardenPopulate({ body: { on: { 'sections.mod-card': { populate: { mod: true } } } } }, 'api::mod.mod', schema, ['public']);
    expect(p.body).toEqual({ on: { 'sections.mod-card': { populate: { mod: { filters: guard } } } } });
    expect(() => hardenPopulate({ body: { on: { 'sections.nope': true } } }, 'api::mod.mod', schema, ['public'])).toThrow(GuardRejection);
    expect(() => hardenPopulate({ body: { on: { 'sections.mod-card': { filters: { mod: { name: 'x' } } } } } }, 'api::mod.mod', schema, ['public'])).toThrow(GuardRejection);
  });
  it('a private entry inside an on-fragment stays hidden in the response', () => {
    const mod: any = { visibility: 'public', body: [{ __component: 'sections.mod-card', mod: { name: 'secret', visibility: 'private' } }] };
    expect(stripEntry(mod, 'api::mod.mod', schema, ['public'])).toBe(1);
    expect(mod.body[0].mod).toBeNull();
  });
  it('rejects unknown populate keys and unknown node options', () => {
    expect(() => hardenPopulate({ nope: true }, 'api::mod.mod', schema, ['public'])).toThrow(/Unknown populate key/);
    expect(() => hardenPopulate('nope', 'api::mod.mod', schema, ['public'])).toThrow(GuardRejection);
    expect(() => hardenPopulate({ posts: { count: true } }, 'api::mod.mod', schema, ['public'])).toThrow(GuardRejection);
    expect(() => hardenPopulate({ name: true }, 'api::mod.mod', schema, ['public'])).toThrow(GuardRejection);
  });
  it('media allows only true or fields', () => {
    expect(hardenPopulate({ cover: { fields: ['url'] } }, 'api::mod.mod', schema, ['public']).cover).toEqual({ fields: ['url'] });
    expect(() => hardenPopulate({ cover: { filters: { name: 'x' } } }, 'api::mod.mod', schema, ['public'])).toThrow(/Media/);
    expect(() => hardenPopulate({ cover: { populate: '*' } }, 'api::mod.mod', schema, ['public'])).toThrow(/Media/);
  });
});
