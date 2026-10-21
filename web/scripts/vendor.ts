/**
 * Self-host the 3D viewer's runtime (BLOCK-VIEWER §6): copies model-viewer's single-file build (three.js included)
 * and the meshopt decoder from node_modules into public/vendor/ (gitignored). Nothing is fetched from a CDN at
 * runtime. Runs with fetch-content (predev/prebuild).
 */
import fs from 'node:fs';
import path from 'node:path';
const NM = path.resolve('node_modules');
const pkg = (name: string) => JSON.parse(fs.readFileSync(path.join(NM, name, 'package.json'), 'utf8'));
const out = path.resolve('public', 'vendor');
fs.mkdirSync(out, { recursive: true });
const mvPkg = pkg('@google/model-viewer');
const moPkg = pkg('meshoptimizer');
const files: [string, string][] = [
  [path.join(NM, '@google/model-viewer/dist/model-viewer.min.js'), `model-viewer-${mvPkg.version}.min.js`],
  [path.join(NM, 'meshoptimizer/meshopt_decoder.cjs'), `meshopt-decoder-${moPkg.version}.js`],
];
for (const f of fs.readdirSync(out)) if (!files.some(([, n]) => n === f)) fs.unlinkSync(path.join(out, f));
for (const [src, name] of files) fs.copyFileSync(src, path.join(out, name));
fs.writeFileSync(path.resolve('src', 'data', 'vendor.json'), JSON.stringify({ modelViewer: `/vendor/${files[0][1]}`, meshoptDecoder: `/vendor/${files[1][1]}` }, null, 1) + '\n');
console.log(`vendor: ${files.map(([, n]) => n).join(', ')}`);
