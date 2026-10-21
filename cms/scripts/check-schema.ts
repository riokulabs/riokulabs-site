/**
 * CI schema lint (CONTENT-MODEL §6.1, ARCHITECTURE §9.1). Fails when:
 * - any content-type lacks draftAndPublish: true or isn't i18n-localized: false;
 * - any collection type lacks `visibility` (enum public|unlisted|private, required, default private);
 * - any schema/component JSON doesn't parse;
 * - a uid field has no targetField; a media.image `alt` isn't required;
 * - an API content type is missing from the folders file (src/content-structure/groups.json) or is in two folders.
 * Run: npm run check:schema
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const errors: string[] = [];
const fail = (m: string) => errors.push(m);

const apiDir = path.join(root, 'src', 'api');
const types = fs.readdirSync(apiDir).filter((d) => fs.existsSync(path.join(apiDir, d, 'content-types')));
let collections = 0;
let singles = 0;
for (const t of types) {
  const file = path.join(apiDir, t, 'content-types', t, 'schema.json');
  let s: any;
  try {
    s = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${t}: schema.json does not parse (${(e as Error).message})`);
    continue;
  }
  if (s.options?.draftAndPublish !== true) fail(`${t}: draftAndPublish must be true`);
  if (s.pluginOptions?.i18n?.localized !== false) fail(`${t}: pluginOptions.i18n.localized must be false in v1`);
  for (const [name, a] of Object.entries<any>(s.attributes)) {
    if (a.type === 'uid' && !a.targetField) fail(`${t}.${name}: uid needs a targetField`);
  }
  if (s.kind === 'collectionType') {
    collections++;
    const v = s.attributes.visibility;
    if (!v) fail(`${t}: collection type has no visibility field`);
    else {
      if (v.type !== 'enumeration') fail(`${t}.visibility: must be an enumeration`);
      if (JSON.stringify(v.enum) !== JSON.stringify(['public', 'unlisted', 'private'])) fail(`${t}.visibility: enum must be public|unlisted|private`);
      if (v.default !== 'private') fail(`${t}.visibility: default must be private (got ${v.default})`);
      if (v.required !== true) fail(`${t}.visibility: must be required`);
    }
    const routes = path.join(apiDir, t, 'routes', `${t}.ts`);
    const r = fs.existsSync(routes) ? fs.readFileSync(routes, 'utf8') : '';
    if (!r.includes('global::visibility-guard') || !r.includes(`uid: 'api::${t}.${t}'`)) fail(`${t}: routes must attach global::visibility-guard with its uid`);
  } else singles++;
}

const compDir = path.join(root, 'src', 'components');
let comps = 0;
for (const cat of fs.readdirSync(compDir)) {
  for (const f of fs.readdirSync(path.join(compDir, cat))) {
    comps++;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(compDir, cat, f), 'utf8'));
      if (cat === 'media' && f === 'image.json' && c.attributes.alt?.required !== true) fail('media.image.alt must be required');
    } catch (e) {
      fail(`components/${cat}/${f}: does not parse`);
    }
  }
}

// Content-type folders (Strapi 5.55+): src/content-structure/groups.json. Every API type sits in exactly one folder of
// the right section, so nothing ends up loose in the admin sidebar. Strapi drops bad entries with a warning; fail here.
const groupsFile = path.join(root, 'src', 'content-structure', 'groups.json');
let folders = 0;
try {
  const g = JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
  if (g.version !== 1) fail('groups.json: version must be 1');
  const kinds = Object.fromEntries(
    types.map((t) => [`api::${t}.${t}`, JSON.parse(fs.readFileSync(path.join(apiDir, t, 'content-types', t, 'schema.json'), 'utf8')).kind]),
  );
  const placed = new Map<string, string>();
  const ids = new Set<string>();
  for (const [section, kind] of [['collectionTypes', 'collectionType'], ['singleTypes', 'singleType']] as const) {
    const groups: any[] = g.sections?.[section]?.groups ?? [];
    for (const grp of groups) {
      folders++;
      if (ids.has(grp.id)) fail(`groups.json: duplicate group id ${grp.id}`);
      ids.add(grp.id);
      if (typeof grp.name !== 'string' || !grp.name.trim()) fail(`groups.json: group ${grp.id} has no name`);
      if (grp.parent !== null && !groups.some((p) => p.id === grp.parent)) fail(`groups.json: group ${grp.id} has an unknown parent`);
      for (const c of grp.children ?? []) {
        if (c.type !== 'contentType') continue;
        if (!(c.uid in kinds)) fail(`groups.json: ${c.uid} is not a content type`);
        else if (kinds[c.uid] !== kind) fail(`groups.json: ${c.uid} is a ${kinds[c.uid]}, not in ${section}`);
        if (placed.has(c.uid)) fail(`groups.json: ${c.uid} is in two folders`);
        placed.set(c.uid, grp.id);
      }
    }
  }
  for (const uid of Object.keys(kinds)) if (!placed.has(uid)) fail(`groups.json: ${uid} is not in any folder`);
} catch (e) {
  fail(`groups.json: ${(e as Error).message}`);
}

if (errors.length) {
  console.error(`check-schema: ${errors.length} problem(s)\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log(`check-schema: OK (${collections} collection types, ${singles} single types, ${comps} components, ${folders} folders)`);
