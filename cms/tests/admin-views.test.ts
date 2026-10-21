import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_VIEWS, CONTENT_TYPE_VIEWS } from '../src/admin-views-data';
import { fingerprint, mergeConfiguration, specProblems, type Model } from '../src/admin-views';

const SRC = path.resolve(__dirname, '..', 'src');
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** The schema files, shaped like the Content Manager sees them (timestamps added, relations typed). */
function contentTypeModels(): Record<string, Model> {
  const out: Record<string, Model> = {};
  for (const t of fs.readdirSync(path.join(SRC, 'api'))) {
    const f = path.join(SRC, 'api', t, 'content-types', t, 'schema.json');
    if (!fs.existsSync(f)) continue;
    const s = read(f);
    const uid = `api::${t}.${t}`;
    out[uid] = {
      uid,
      attributes: {
        id: { type: 'integer' },
        ...s.attributes,
        createdAt: { type: 'datetime' },
        updatedAt: { type: 'datetime' },
        documentId: { type: 'string' },
      },
    };
  }
  return out;
}
function componentModels(): Record<string, Model> {
  const out: Record<string, Model> = {};
  for (const cat of fs.readdirSync(path.join(SRC, 'components'))) {
    for (const f of fs.readdirSync(path.join(SRC, 'components', cat))) {
      const uid = `${cat}.${f.replace(/\.json$/, '')}`;
      out[uid] = { uid, attributes: { id: { type: 'integer' }, ...read(path.join(SRC, 'components', cat, f)).attributes } };
    }
  }
  return out;
}

const types = contentTypeModels();
const comps = componentModels();

describe('admin view specs match the schema', () => {
  it('every content type and component has a spec, and no spec is orphaned', () => {
    expect(Object.keys(CONTENT_TYPE_VIEWS).sort()).toEqual(Object.keys(types).sort());
    expect(Object.keys(COMPONENT_VIEWS).sort()).toEqual(Object.keys(comps).sort());
  });

  for (const [uid, spec] of Object.entries(CONTENT_TYPE_VIEWS)) {
    it(`${uid}: valid, every field placed and labelled`, () => {
      const m = types[uid];
      expect(specProblems(spec, m)).toEqual([]);
      const unlabelled = Object.keys(m.attributes).filter(
        (f) => !['id', 'documentId', 'createdAt', 'updatedAt'].includes(f) && !spec.fields?.[f]?.label,
      );
      expect(unlabelled).toEqual([]);
    });
  }
  for (const [uid, spec] of Object.entries(COMPONENT_VIEWS)) {
    it(`${uid}: valid, every field labelled`, () => {
      const m = comps[uid];
      expect(specProblems(spec, m, { component: true })).toEqual([]);
      expect(Object.keys(m.attributes).filter((f) => f !== 'id' && !spec.fields?.[f]?.label)).toEqual([]);
    });
  }

  it('collection types show visibility in the list view', () => {
    for (const [uid, m] of Object.entries(types)) {
      if ('visibility' in m.attributes) expect(CONTENT_TYPE_VIEWS[uid].list, uid).toContain('visibility');
    }
  });

  it('visible text has no internal references', () => {
    const text = JSON.stringify([CONTENT_TYPE_VIEWS, COMPONENT_VIEWS]);
    expect(text).not.toMatch(/\b(Plan|Task|M\d|HANDOFF|SPEC|CONTENT-MODEL)\b|§|TODO/);
  });
});

describe('mergeConfiguration', () => {
  const m = types['api::mod.mod'];
  const spec = CONTENT_TYPE_VIEWS['api::mod.mod'];
  const current = {
    settings: { bulkable: true, filterable: false, searchable: true, pageSize: 50, mainField: 'slug', defaultSortBy: 'slug', defaultSortOrder: 'ASC' },
    metadatas: {
      name: { edit: { label: 'name', description: '', placeholder: '', visible: true, editable: true }, list: { label: 'name', searchable: true, sortable: true } },
      license: { edit: { label: 'Licence (custom)', visible: true, editable: false }, list: { label: 'license', searchable: true, sortable: true } },
    },
    layouts: { list: ['id', 'name'], edit: [[{ name: 'name', size: 6 }]] },
  };

  it('sets only the owned keys and keeps the rest', () => {
    const out = mergeConfiguration(current, spec, m, (uid) => CONTENT_TYPE_VIEWS[uid]?.mainField);
    expect(out.settings).toMatchObject({ pageSize: 50, filterable: false, mainField: 'name', defaultSortBy: 'updatedAt', defaultSortOrder: 'DESC' });
    expect(out.metadatas.name.edit).toMatchObject({ label: 'Name', placeholder: 'Data Center', visible: true, editable: true });
    expect(out.metadatas.name.list).toMatchObject({ label: 'Name', searchable: true, sortable: true });
    // An editor's non-owned choice (editable: false) survives; the label is owned.
    expect(out.metadatas.license.edit).toMatchObject({ label: 'License', editable: false });
    expect(out.metadatas.game.edit.mainField).toBe('name');
    expect(out.metadatas.updatedAt.list.label).toBe('Updated');
    expect(out.layouts.list).toEqual(spec.list);
    expect(out.layouts.edit[0]).toEqual([{ name: 'name', size: 6 }, { name: 'slug', size: 6 }]);
    expect(current.settings.mainField).toBe('slug'); // input not mutated
  });

  it('never hides a field: anything missing from the spec is appended', () => {
    const partial = { ...spec, edit: [[['name', 6]] as [string, number][]] };
    const out = mergeConfiguration(current, partial, m);
    const placed = out.layouts.edit.flat().map((e) => e.name);
    const editable = Object.keys(m.attributes).filter((f) => !['id', 'documentId', 'createdAt', 'updatedAt'].includes(f));
    expect(placed.sort()).toEqual(editable.sort());
    for (const row of out.layouts.edit) expect(row.reduce((s, e) => s + e.size, 0)).toBeLessThanOrEqual(12);
  });

  it('skips invalid parts instead of writing them', () => {
    const bad = {
      mainField: 'body',
      list: ['body', 'name'],
      edit: [[['body', 6], ['nope', 6]], [['name', 6], ['slug', 8]]] as [string, number][][],
      fields: { nope: { label: 'x' } },
    };
    const out = mergeConfiguration(current, bad, m);
    expect(out.settings.mainField).toBe('slug');
    expect(out.layouts.list).toEqual(['name']);
    expect(out.metadatas.nope).toBeUndefined();
    const body = out.layouts.edit.flat().find((e) => e.name === 'body');
    expect(body?.size).toBe(12);
    for (const row of out.layouts.edit) expect(row.reduce((s, e) => s + e.size, 0)).toBeLessThanOrEqual(12);
  });

  it('is idempotent', () => {
    const once = mergeConfiguration(current, spec, m);
    expect(mergeConfiguration(once, spec, m)).toEqual(once);
  });

  it('fingerprint changes with the spec', () => {
    expect(fingerprint(spec)).toBe(fingerprint(JSON.parse(JSON.stringify(spec))));
    expect(fingerprint({ ...spec, mainField: 'slug' })).not.toBe(fingerprint(spec));
  });
});
