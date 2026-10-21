/**
 * CI schema lint (CONTENT-MODEL §6.1, ARCHITECTURE §9.1). Fails when:
 * - any content-type lacks draftAndPublish: true or isn't i18n-localized: false;
 * - any collection type lacks `visibility` (enum public|unlisted|private, required, default private);
 * - any schema/component JSON doesn't parse;
 * - a uid field has no targetField; a media.image `alt` isn't required.
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

if (errors.length) {
  console.error(`check-schema: ${errors.length} problem(s)\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log(`check-schema: OK (${collections} collection types, ${singles} single types, ${comps} components)`);
