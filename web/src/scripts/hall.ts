/**
 * Home hero: a cold aisle built from the mod's own blocks (our exported GLBs).
 * Sequence: blueprint edges draw in bottom-up, then a weld front runs down the aisle turning edges into shaded blocks
 * (status lamps light behind it). Page scroll then walks the camera down the aisle to the rack at the end, whose doors
 * open on arrival. Bloom only on lamps and the weld front (HDR threshold above anything lit by the room).
 * Every block's front is local -z. Renders only while visible; reduced motion shows the finished aisle, no walk.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface HallModels { rack: string; crac: string; tray: string; servers: Record<string, string> }
export interface Hall { state: { draw: number; weld: number; scroll: number; lamp: number }; intro(): Promise<void>; setScroll(v: number): void; dispose(): void }

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const CYAN = new THREE.Color('#4fb8ff');

export async function createHall(canvas: HTMLCanvasElement, models: HallModels, { reduced = false, small = innerWidth < 700 } = {}): Promise<Hall> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.localClippingEnabled = true;
  renderer.setClearColor('#05070a');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#05070a', 0.075);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(2, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(CYAN, 1.4); rim.position.set(-3, 3, -8); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 80);

  // Weld front at z = zF: shaded keeps z >= zF (already welded, nearer the camera); edges keep z <= zF and y <= draw.
  const shadedClip = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e3);
  const edgeFront = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e3);
  const edgeHeight = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const edgeMat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.26, depthWrite: false, clippingPlanes: [edgeFront, edgeHeight] });
  const lamps: THREE.MeshStandardMaterial[] = [];

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const serverNames = Object.keys(models.servers);
  const [rackG, cracG, trayG, ...srvG] = await Promise.all([models.rack, models.crac, models.tray, ...serverNames.map((n) => models.servers[n])].map((u) => loader.loadAsync(u)));

  const seen = new Set<THREE.Material>();
  const prep = (g: { scene: THREE.Object3D }, edges = true) => {
    g.scene.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
        if (seen.has(m)) continue; seen.add(m);
        m.clippingPlanes = [shadedClip];
        m.roughness = Math.max(m.roughness ?? 0.5, 0.55); // no mirror specular down a long aisle: it blooms into glare
        if (m.name === 'WEB_LampGreen' || m.name === 'WEB_Screen') { m.emissiveIntensity = 0; lamps.push(m); }
        if (m.name === 'WEB_Paint') m.color.set('#3a3d42');
      }
      if (edges) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 45), edgeMat); e.renderOrder = 2; mesh.add(e); }
    });
    const box = new THREE.Box3().setFromObject(g.scene);
    return { g, box, size: box.getSize(new THREE.Vector3()) };
  };
  const rack = prep(rackG), crac = prep(cracG), tray = prep(trayG);
  const srv = Object.fromEntries(serverNames.map((n, i) => [n, prep(srvG[i], false)]));

  const W = rack.size.x, D = rack.size.z, H = rack.size.y, AISLE = 1.5, N = small ? 7 : 10;
  const place = (src: ReturnType<typeof prep>, x: number, z: number, ry: number) => {
    const o = src.g.scene.clone(true), c = src.box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group(); o.position.set(-c.x, -src.box.min.y, -c.z); holder.add(o);
    holder.position.set(x, 0, z); holder.rotation.y = ry; scene.add(holder); return o;
  };
  // Servers seat in 0.25 m slots; slot k's floor is 0.25 + 0.25 (k - 1) above the rack base; handles stand 3.7 cm proud
  // of the slot front plane (z = -0.375).
  const fill = (rackObj: THREE.Object3D, layout: string[]) => {
    const holder = rackObj.parent!; let k = 1;
    for (const name of layout) {
      const sv = srv[name]; if (!sv) { k++; continue; }
      const o = sv.g.scene.clone(true), c = sv.box.getCenter(new THREE.Vector3());
      o.position.set(-c.x, 0.25 + 0.25 * (k - 1) - sv.box.min.y, -0.412 + sv.size.z / 2 - c.z);
      holder.add(o); k++;
    }
  };
  const LAYOUTS = [
    ['storage', 'compute', 'compute', 'switch', 'kvm', 'programmable', 'status', 'eventctl'],
    ['storage', 'storage', 'compute', 'compute', 'switch', 'blank', 'eventctl', 'timer'],
    ['compute', 'storage', 'blank', 'compute', 'switch', 'timer', 'status', 'blank'],
  ];
  const xRow = AISLE / 2 + D / 2;
  for (let i = 0; i < N; i++) {
    const z = -i * W, isCrac = i % 4 === 3;
    const l = place(isCrac ? crac : rack, -xRow, z, -Math.PI / 2); // fronts (-z) turned to face the aisle
    const r = place(isCrac ? crac : rack, xRow, z, Math.PI / 2);
    if (!isCrac && i >= N - 3) { fill(l, LAYOUTS[(i + 1) % 3]); fill(r, LAYOUTS[i % 3]); }
  }
  const tLen = Math.max(tray.size.x, tray.size.z), alongX = tray.size.x >= tray.size.z;
  for (const sx of [-1, 1]) for (let z = W / 2; z > -N * W + W / 2; z -= tLen) {
    const o = place(tray, sx * xRow, z - tLen / 2, alongX ? Math.PI / 2 : 0); o.parent!.position.y = H + 0.32;
  }
  const endZ = -N * W - D / 2 + W / 2 - 0.2;
  const endRack = place(rack, 0, endZ, Math.PI);
  fill(endRack, LAYOUTS[0]);
  const mixer = new THREE.AnimationMixer(endRack);
  const clip = (name: string) => { const c = rackG.animations.find((a) => a.name === name); const a = c ? mixer.clipAction(c, endRack) : null; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } return a; };
  const doorsOpen = clip('DoorsOpen'), doorsClose = clip('DoorsClose');

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), new THREE.MeshStandardMaterial({ color: '#0a0e13', roughness: 0.35, metalness: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = -8; scene.add(floor);
  const grid = new THREE.GridHelper(40, 66, CYAN, CYAN); (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.14; grid.position.set(0, 0.002, -8); scene.add(grid);

  const span = xRow * 2 + D, top = H + 0.45;
  const frontMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 3.6, 7), toneMapped: false, transparent: true, opacity: 0 });
  const front = new THREE.Line(new THREE.BufferGeometry().setFromPoints([[-span / 2, 0], [-span / 2, top], [span / 2, top], [span / 2, 0]].map(([x, y]) => new THREE.Vector3(x, y, 0))), frontMat);
  scene.add(front);
  const sheetMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.7, 1.4), toneMapped: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(span, top), sheetMat); sheet.position.y = top / 2; front.add(sheet);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.35, 2.4));
  composer.addPass(new OutputPass());

  const zNear = 2.2, zFar = endZ + D / 2 + 3.4;
  const s = { draw: reduced ? 1 : 0, weld: reduced ? 1 : 0, scroll: 0, lamp: reduced ? 1 : 0 };
  let visible = true, raf = 0, last = performance.now(), opened = false, disposed = false;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.fov = w / h < 0.8 ? 62 : 46; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }); io.observe(canvas);

  const apply = (now: number) => {
    edgeHeight.constant = s.draw * (top + 0.1);
    const zF = THREE.MathUtils.lerp(zNear + 0.5, endZ - D, s.weld);
    shadedClip.constant = -zF; edgeFront.constant = zF + 0.04; front.position.z = zF;
    const on = s.weld > 0 && s.weld < 1 ? 1 : 0;
    frontMat.opacity = on; sheetMat.opacity = on * 0.05;
    const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(now / 420);
    for (const m of lamps) m.emissiveIntensity = s.lamp * (m.name === 'WEB_Screen' ? 1.5 : 2.4) * pulse;
    const p = ease(s.scroll), z = THREE.MathUtils.lerp(zNear, zFar, p);
    const sway = reduced ? 0 : Math.sin(now / 2600) * 0.05 * (1 - p);
    camera.position.set(sway + 0.18 * (1 - p), THREE.MathUtils.lerp(1.55, 1.25, p), z);
    camera.lookAt(0, THREE.MathUtils.lerp(1.15, 1.2, p), z - 4);
    if (s.scroll > 0.9 && !opened) { opened = true; doorsClose?.stop(); doorsOpen?.reset().play(); }
    if (s.scroll < 0.8 && opened) { opened = false; doorsOpen?.stop(); doorsClose?.reset().play(); }
  };
  function loop() {
    if (raf || disposed) return;
    raf = requestAnimationFrame(function tick(now) {
      raf = 0; const dt = Math.min((now - last) / 1000, 0.05); last = now;
      mixer.update(dt); apply(now); composer.render();
      if (visible && !document.hidden) loop();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
  const tween = (k: keyof typeof s, to: number, dur: number) => new Promise<void>((res) => {
    if (reduced) { s[k] = to; return res(); }
    const from = s[k], t0 = performance.now();
    const step = (now: number) => { const t = Math.min(1, (now - t0) / dur); s[k] = from + (to - from) * ease(t); if (t < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
  loop();
  return {
    state: s,
    async intro() { await tween('draw', 1, 2200); void tween('lamp', 1, 2600); await tween('weld', 1, 2600); },
    setScroll(v) { s.scroll = v; },
    dispose() { disposed = true; ro.disconnect(); io.disconnect(); renderer.dispose(); },
  };
}
