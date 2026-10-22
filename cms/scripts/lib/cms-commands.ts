/**
 * The commands of scripts/cms.ts. Each takes the parsed command line and an AdminClient, prints compact lines through
 * `out`, and returns an exit code. Kept apart from the entry point so tests can run whole commands on a mocked fetch.
 */
import { AdminClient, UsageError } from './admin-http';
import {
  blocksToMarkdown,
  type Cli,
  coerce,
  conv,
  csv,
  docPath,
  dzField,
  editSection,
  hasSectionEdits,
  listFlag,
  listQuery,
  loadSchemas,
  move,
  newSection,
  outline,
  outlineLine,
  relationIds,
  resolveType,
  type Schemas,
  sectionNumber,
  sectionOpts,
  shortValue,
  snapshot,
  splitAssign,
  stable,
  statusOf,
  subsetMatch,
  SYSTEM,
  type TypeSchema,
  USAGE,
  writableBody,
  writeAndVerify,
} from './cms-cli';

export interface Deps {
  client: AdminClient;
  out: (line: string) => void;
  err: (line: string) => void;
  readText: (file: string) => string;
  backupDir?: string;
}

const visibilityOf = (d: any) => (d && 'visibility' in d ? d.visibility ?? '-' : '');

export async function runCommand(cli: Cli, deps: Deps): Promise<number> {
  const { client, out } = deps;
  if (cli.cmd === 'help') {
    out(USAGE);
    return 0;
  }
  const schemas = await loadSchemas(client);
  if (cli.cmd === 'types') return types(schemas, cli, out);
  const t = resolveType(cli.pos[0], schemas);
  switch (cli.cmd) {
    case 'list': return list(t, cli, deps);
    case 'get': return get(t, schemas, cli, deps);
    case 'set': return set(t, schemas, cli, deps);
    case 'section': return section(t, schemas, cli, deps);
    case 'section-insert': return sectionInsert(t, schemas, cli, deps);
    case 'section-move': return sectionMove(t, schemas, cli, deps);
    case 'publish':
    case 'unpublish': return publish(t, cli, deps);
    default: throw new UsageError(`unknown command ${cli.cmd}`);
  }
}

function types(schemas: Schemas, cli: Cli, out: Deps['out']) {
  const all = [...schemas.types.values()].sort((a, b) => a.uid.localeCompare(b.uid));
  if (cli.flags.json) out(JSON.stringify(all.map((t) => ({ uid: t.uid, kind: t.kind, name: t.info?.singularName }))));
  else for (const t of all) out(`${t.info?.singularName ?? t.uid}  ${t.kind === 'singleType' ? 'single' : 'collection'}  ${t.uid}`);
  return 0;
}

async function list(t: TypeSchema, cli: Cli, { client, out }: Deps) {
  if (t.kind !== 'collectionType') throw new UsageError(`${t.info?.singularName} is a single type: use get ${t.info?.singularName} single`);
  const query = listQuery({ status: cli.flags.status as string, filters: listFlag(cli.flags.filter), limit: cli.flags.limit as string, sort: cli.flags.sort as string }, t);
  const res = await client.get(`/content-manager/collection-types/${t.uid}`, query);
  if (cli.flags.json) {
    out(JSON.stringify(res));
    return 0;
  }
  const fields = csv(cli.flags.fields) ?? [t.mainField && t.mainField !== 'id' ? t.mainField : 'documentId'].filter((f) => f !== 'documentId');
  for (const f of fields) if (!t.attributes[f] && !SYSTEM.has(f)) throw new UsageError(`${t.info?.singularName} has no field ${f}`);
  for (const d of res?.results ?? []) {
    const vis = visibilityOf(d);
    out([d.documentId, statusOf(d), ...(vis ? [vis] : []), ...fields.map((f) => `${f}=${shortValue(d[f], t.attributes[f])}`)].join('  '));
  }
  const p = res?.pagination ?? {};
  out(`(${(res?.results ?? []).length} of ${p.total ?? '?'})`);
  return 0;
}

async function get(t: TypeSchema, schemas: Schemas, cli: Cli, { client, out }: Deps) {
  const id = cli.pos[1];
  const status = (cli.flags.status as string) ?? 'draft';
  if (!['draft', 'published'].includes(status)) throw new UsageError('get --status must be draft or published');
  const res = await client.get(docPath(t, id), { status });
  const d = res?.data;
  if (!d?.documentId) throw new Error(`${t.info?.singularName} ${id}: not found${status === 'published' ? ' (no published version)' : ''}`);
  if (cli.flags.json) {
    out(JSON.stringify(d));
    return 0;
  }
  const vis = visibilityOf(d);
  out(`${d.documentId}  ${statusOf(d)}${vis ? `  ${vis}` : ''}  updated ${d.updatedAt ?? '-'}`);
  const requested = csv(cli.flags.fields);
  const dz = dzField(t);
  const fields = requested ?? Object.keys(t.attributes).filter((k) => !SYSTEM.has(k) && !(cli.flags.outline && k === dz));
  for (const f of fields) {
    const a = t.attributes[f];
    if (!a && !SYSTEM.has(f)) throw new UsageError(`${t.info?.singularName} has no field ${f}`);
    if (a?.type === 'relation' && requested) out(`${f}: ${(await relationIds(client, t.uid, d.documentId, f)).join(', ') || '-'}`);
    else out(`${f}: ${shortValue(d[f], a)}`);
  }
  if (cli.flags.outline) {
    if (!dz) throw new UsageError(`${t.info?.singularName} has no dynamic zone`);
    const snap = await snapshot(client, schemas, t, id, status);
    out(`${dz}:`);
    for (const line of outline(snap.data[dz] ?? [], snap.sections)) out(`  ${line}`);
  }
  return 0;
}

async function set(t: TypeSchema, schemas: Schemas, cli: Cli, deps: Deps) {
  const { client, out } = deps;
  const id = cli.pos[1];
  const changes = new Map<string, { value: unknown; json: boolean }>();
  const add = (k: string, value: unknown, json: boolean) => {
    if (changes.has(k)) throw new UsageError(`${k} given twice`);
    changes.set(k, { value, json });
  };
  for (const kv of cli.pos.slice(2)) {
    const [k, raw] = splitAssign(kv);
    add(k, raw, false);
  }
  for (const kv of listFlag(cli.flags['json-value'])) {
    const [k, raw] = splitAssign(kv, "field='<json>'");
    try {
      add(k, JSON.parse(raw), true);
    } catch (e) {
      if (e instanceof UsageError) throw e;
      throw new UsageError(`--json-value ${k}: not valid JSON`);
    }
  }
  const dz = dzField(t);
  const payload: Record<string, unknown> = {};
  for (const [k, c] of changes) {
    const a = t.attributes[k];
    if (!a) throw new UsageError(`${t.info?.singularName} has no field ${k}. Fields: ${Object.keys(t.attributes).filter((f) => !SYSTEM.has(f)).join(', ')}`);
    if (SYSTEM.has(k)) throw new UsageError(`${k} is managed by Strapi`);
    if (k === dz) throw new UsageError(`${k} is the section list: use section, section-insert or section-move`);
    // JSON values go as given (media as file ids, relations as set/connect/disconnect); plain values are typed.
    payload[k] = c.json ? c.value : coerce(k, c.value as string, a);
  }

  const before = await snapshot(client, schemas, t, id);
  const changed = Object.keys(payload).filter((k) => {
    const a = t.attributes[k];
    if (a.type === 'relation') return true;
    return stable(conv(before.data[k], a, schemas, 'compare')) !== stable(conv(payload[k], a, schemas, 'compare'));
  });
  if (!changed.length) {
    out('no change: every value is already set');
    return 0;
  }
  const send = Object.fromEntries(changed.map((k) => [k, payload[k]]));
  const after = await writeAndVerify(client, schemas, t, id, before, send, { fields: new Set(changed) }, deps.backupDir);
  const mismatched: string[] = [];
  for (const k of changed) {
    const a = t.attributes[k];
    if (a.type === 'relation') {
      out(`${k}: ${before.top[k]?.join(',') || '-'} → ${after.top[k]?.join(',') || '-'}`);
      continue;
    }
    out(`${k}: ${shortValue(before.data[k], a)} → ${shortValue(after.data[k], a)}`);
    if (!subsetMatch(conv(payload[k], a, schemas, 'compare'), conv(after.data[k], a, schemas, 'compare'))) mismatched.push(k);
  }
  if (mismatched.length) throw new Error(`saved, but ${mismatched.join(', ')} did not come back as sent; check the entry`);
  out(`saved draft ${after.data.documentId}; nothing else changed`);
  return 0;
}

async function loadBody(t: TypeSchema, schemas: Schemas, deps: Deps, id: string) {
  const dz = dzField(t);
  if (!dz) throw new UsageError(`${t.info?.singularName} has no body sections`);
  const before = await snapshot(deps.client, schemas, t, id);
  const body = writableBody(before.data[dz], t.attributes[dz], schemas);
  return { dz, before, body };
}

async function section(t: TypeSchema, schemas: Schemas, cli: Cli, deps: Deps) {
  const { out } = deps;
  const id = cli.pos[1];
  const opts = sectionOpts(cli.flags);
  const { dz, before, body } = await loadBody(t, schemas, deps, id);
  const n = sectionNumber(cli.pos[2], body.length);
  const raw = before.data[dz][n - 1];
  if (!hasSectionEdits(opts)) {
    if (cli.flags.json) {
      out(JSON.stringify(raw));
      return 0;
    }
    out(outlineLine(n, raw, before.sections[n - 1]));
    if (raw.__component === 'sections.rich-text') out(blocksToMarkdown(raw.content));
    if (raw.__component === 'sections.callout') out(blocksToMarkdown(raw.body));
    if (raw.__component === 'sections.code') out(String(raw.code ?? ''));
    if (raw.__component === 'sections.quote') out(String(raw.text ?? ''));
    return 0;
  }
  const r = editSection(body[n - 1], opts, schemas, deps.readText, before.sections[n - 1]);
  if (!r.changes.length) {
    out(`no change: section ${n} already has those values`);
    return 0;
  }
  const sent = body.slice();
  sent[n - 1] = r.section;
  const rels = before.sections.slice();
  rels[n - 1] = r.rels;
  const after = await writeAndVerify(deps.client, schemas, t, id, before, { [dz]: sent }, { fields: new Set(), body: { sent, rels, targets: new Set([n - 1]) } }, deps.backupDir);
  for (const c of r.changes) out(`section ${n}: ${c}`);
  out(`  ${outlineLine(n, after.data[dz][n - 1], after.sections[n - 1])}`);
  out(`saved draft ${after.data.documentId}; the other ${body.length - 1} sections are unchanged`);
  return 0;
}

async function sectionInsert(t: TypeSchema, schemas: Schemas, cli: Cli, deps: Deps) {
  const id = cli.pos[1];
  const { dz, before, body } = await loadBody(t, schemas, deps, id);
  const n = sectionNumber(cli.pos[2], body.length, true);
  const r = newSection(cli.flags.kind as string, sectionOpts(cli.flags), schemas, deps.readText);
  const sent = body.slice();
  sent.splice(n - 1, 0, r.section);
  const rels = before.sections.slice();
  rels.splice(n - 1, 0, r.rels);
  const after = await writeAndVerify(deps.client, schemas, t, id, before, { [dz]: sent }, { fields: new Set(), body: { sent, rels, targets: new Set([n - 1]) } }, deps.backupDir);
  deps.out(`inserted section ${n}:`);
  deps.out(`  ${outlineLine(n, after.data[dz][n - 1], after.sections[n - 1])}`);
  deps.out(`saved draft ${after.data.documentId}; ${after.data[dz].length} sections, the others unchanged`);
  return 0;
}

async function sectionMove(t: TypeSchema, schemas: Schemas, cli: Cli, deps: Deps) {
  const id = cli.pos[1];
  const { dz, before, body } = await loadBody(t, schemas, deps, id);
  const from = sectionNumber(cli.pos[2], body.length);
  const to = sectionNumber(cli.pos[3], body.length);
  if (from === to) {
    deps.out('no change: same position');
    return 0;
  }
  const sent = move(body, from, to);
  const rels = move(before.sections, from, to);
  const after = await writeAndVerify(deps.client, schemas, t, id, before, { [dz]: sent }, { fields: new Set(), body: { sent, rels, targets: new Set() } }, deps.backupDir);
  deps.out(`moved section ${from} to ${to}:`);
  for (const line of outline(after.data[dz], after.sections)) deps.out(`  ${line}`);
  return 0;
}

async function publish(t: TypeSchema, cli: Cli, { client, out }: Deps) {
  const id = cli.pos[1];
  const base = docPath(t, id);
  const action = cli.cmd as 'publish' | 'unpublish';
  const before = (await client.get(base, { status: 'draft' }))?.data;
  if (!before?.documentId) throw new Error(`${t.info?.singularName} ${id}: not found`);
  await client.post(`${base}/actions/${action}`, {});
  const after = (await client.get(base, { status: 'draft' }))?.data;
  const vis = visibilityOf(after);
  out(`${action === 'publish' ? 'published' : 'unpublished'} ${after?.documentId}: ${statusOf(before)} → ${statusOf(after)}${vis ? `, visibility ${vis}` : ''}`);
  if (action === 'publish' && vis && vis !== 'public') out(`note: visibility is ${vis}, so the entry stays off the public site`);
  return 0;
}
