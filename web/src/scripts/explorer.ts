/**
 * Block explorer viewer (mod pages). One renderer, swappable GLBs (the catalogue in src/data/models/<mod>.json):
 * intact / damaged / fracture (Frac_* nodes, pulled apart) / construction stages (Stage_1..N in one file, one shown).
 * Looks: shaded or wireframe, switched with a "weld" sweep (a clip plane with a scan line). Paint recolours WEB_Paint
 * only; Power lights lamps/screens and runs *Run loops. Bloom only above HDR 2.2, i.e. lamps.
 * Every block's front is local -z, so the default camera sits on the -z side. Renders on demand, pauses off-screen.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const CYAN = '#4fb8ff';

export interface Explorer {
  readonly mode: 'shaded' | 'wire';
  readonly info: { tris: number; dims: number[]; parts: number; fracture: boolean } | null;
  readonly clips: string[];
  readonly explode: number;
  readonly zoom: number;
  onSweep?: (on: boolean) => void;
  onFrame?: () => void;
  sweepY?: number;
  load(url: string, opts?: { keepView?: boolean }): Promise<void>;
  setMode(m: 'shaded' | 'wire'): Promise<void>;
  setPaint(hex: string): void;
  setPower(on: boolean): void;
  setExplode(to: number, dur?: number): Promise<void>;
  setExplodeNow(v: number): void;
  showStage(n: number): void;
  setView(v: { yaw?: number; pitch?: number }): void;
  getView(): { yaw: number; pitch: number };
  setZoom(z: number): void;
  setAutoRotate(v: number): void;
  play(name: string): void;
  screenY(y: number): number;
}

export function createExplorer(canvas: HTMLCanvasElement, reduced: boolean): Explorer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 5, -4); scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(CYAN), 1.2); rim.position.set(-4, 2, 3); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 100);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const grid = new THREE.PolarGridHelper(1.2, 8, 6, 64, CYAN, CYAN);
  (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.14; scene.add(grid);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.25, 2.2));
  composer.addPass(new OutputPass());

  const solidClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  const edgeMat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7, depthWrite: false });
  const fillMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });

  let model: any = null, mode: 'shaded' | 'wire' = 'shaded', paint: string | null = null, power = false, explode = 0, height = 1, scale = 1;
  let yaw = Math.PI - 0.7, pitch = 0.2, dist = 2.4, targetY = 0.5, autoRotate = 0, zoom = 1;
  let visible = true, raf = 0, last = performance.now(), busy = 0;
  const tweens = new Set<{ t0: number; dur: number; fn: (t: number) => void; done: () => void }>();

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); loop();
  };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }).observe(canvas);

  const place = () => {
    const d = dist * zoom;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, targetY + Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
    camera.lookAt(0, targetY, 0);
  };
  function loop() {
    if (raf) return;
    raf = requestAnimationFrame(function tick(now) {
      raf = 0;
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const spinning = autoRotate && !reduced;
      if (spinning) yaw += autoRotate * dt;
      for (const tw of tweens) { const t = Math.min(1, (now - tw.t0) / tw.dur); tw.fn(ease(t)); if (t >= 1) { tweens.delete(tw); tw.done(); } }
      const anim = model && (busy > 0 || (power && model.loops.length));
      if (anim) model.mixer.update(dt);
      if (model && power) { const p = reduced ? 1 : 0.8 + 0.2 * Math.sin(now / 380); model.lamps.forEach((m: any) => (m.emissiveIntensity = m.userData.on * p)); }
      if (model) { place(); composer.render(); api.onFrame?.(); }
      if (visible && (spinning || tweens.size || anim || (power && !reduced))) loop();
    });
  }
  const tween = (dur: number, fn: (t: number) => void) => new Promise<void>((res) => {
    if (reduced || !dur) { fn(1); loop(); return res(); }
    tweens.add({ t0: performance.now(), dur, fn, done: res }); loop();
  });
  const applyMode = (m: string) => {
    if (!model) return;
    for (const p of model.parts) { p.mesh.material = m === 'wire' ? fillMat : p.mats; p.edges.visible = m === 'wire' || m === 'sweep'; }
  };
  const applyPower = () => {
    if (!model) return;
    model.lamps.forEach((m: any) => (m.emissiveIntensity = power ? m.userData.on : 0));
    for (const a of model.loops) power ? a.reset().play() : a.stop();
    if (power && model.actions.FansSpinUp && model.loops.length === 0) model.actions.FansSpinUp.reset().play();
    loop();
  };
  const applyExplode = () => {
    if (!model) return;
    for (const n of model.movers) {
      n.position.copy(n.userData.p0).addScaledVector(n.userData.dir, explode * n.userData.k);
      n.quaternion.copy(n.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(n.userData.axis, explode * n.userData.spin));
    }
    loop();
  };
  const cache = new Map<string, Promise<any>>();
  const fetchGltf = (url: string) => { if (!cache.has(url)) cache.set(url, loader.loadAsync(url)); return cache.get(url)!; };

  const api: Explorer = {
    get mode() { return mode; },
    get info() { return model ? model.info : null; },
    get clips() { return model ? model.clips : []; },
    get explode() { return explode; },
    get zoom() { return zoom; },
    async load(url, { keepView = false } = {}) {
      const gltf = await fetchGltf(url);
      const root = gltf.scene.clone(true);
      if (model) { scene.remove(model.pivot); model.mixer.stopAllAction(); }
      const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
      if (!keepView) scale = 1 / Math.max(size.x, size.y, size.z);
      const c = box.getCenter(new THREE.Vector3());
      root.scale.setScalar(scale); root.position.set(-c.x * scale, -box.min.y * scale, -c.z * scale);
      height = size.y * scale;
      const pivot = new THREE.Group(); pivot.add(root); scene.add(pivot);
      const parts: any[] = [], paintMats = new Set<any>(), lamps = new Set<any>();
      let tris = 0;
      root.traverse((n: any) => {
        if (!n.isMesh) return;
        // materials are cloned per load so paint and power never leak between cached models
        const cl = (m: any) => {
          const k = m.clone(); k.clippingPlanes = [solidClip];
          if (k.metalness > 0.8) k.roughness = Math.max(k.roughness, 0.5);
          if (k.name === 'WEB_Paint') paintMats.add(k);
          if ((k.name.startsWith('WEB_Lamp') && k.name !== 'WEB_LampOff') || k.name === 'WEB_Screen') { k.userData.on = k.name === 'WEB_Screen' ? 1.6 : 3; k.emissiveIntensity = 0; lamps.add(k); }
          return k;
        };
        n.material = Array.isArray(n.material) ? n.material.map(cl) : cl(n.material);
        const g = n.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), edgeMat);
        edges.renderOrder = 2; n.add(edges); parts.push({ mesh: n, mats: n.material, edges });
      });
      // pull-apart moves the fracture zones only (sub-parts like a KVM drawer just drift off oddly)
      root.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
      const movers: any[] = []; root.traverse((n: any) => { if (/^Frac_/i.test(n.name)) movers.push(n); });
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (const n of movers) {
        const dir = new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3()).sub(center); dir.y *= 0.6;
        if (dir.lengthSq() < 1e-6) dir.set(rnd() - 0.5, 0.3, rnd() - 0.5);
        dir.normalize().transformDirection(new THREE.Matrix4().copy(n.parent.matrixWorld).invert());
        Object.assign(n.userData, { p0: n.position.clone(), q0: n.quaternion.clone(), dir, k: ((0.14 + rnd() * 0.2) / scale) * 0.6,
          axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: (rnd() - 0.5) * 2.4 });
      }
      const mixer = new THREE.AnimationMixer(root), actions: Record<string, any> = {}, loops: any[] = [];
      for (const a of gltf.animations) {
        const act = mixer.clipAction(a); actions[a.name] = act;
        if (/Run$/.test(a.name)) { act.setLoop(THREE.LoopRepeat, Infinity); loops.push(act); } else { act.clampWhenFinished = true; act.setLoop(THREE.LoopOnce, 1); }
      }
      model = { pivot, root, parts, paintMats: [...paintMats], lamps: [...lamps], mixer, actions, loops, movers, clips: gltf.animations.map((a: any) => a.name),
        info: { tris: Math.round(tris), dims: [size.x, size.y, size.z], parts: movers.length || parts.length, fracture: movers.length > 0 } };
      if (paint) model.paintMats.forEach((m: any) => m.color.set(paint));
      if (!keepView) { pitch = 0.2; zoom = 1; dist = 2.35 + height * 0.75; targetY = height * 0.5; }
      grid.scale.setScalar(Math.max(size.x, size.z) * scale * 0.9 + 0.1);
      solidClip.constant = 10;
      applyMode(mode); applyPower(); applyExplode(); resize();
      canvas.dataset.ready = '1';
    },
    async setMode(m) {
      if (!model || m === mode) { mode = m; applyMode(m); loop(); return; }
      mode = m;
      if (reduced) { applyMode(m); loop(); return; }
      applyMode('sweep'); const h = height * 1.02; api.onSweep?.(true);
      await tween(900, (t) => { const y = m === 'shaded' ? t * h : (1 - t) * h; solidClip.constant = y; api.sweepY = y; });
      api.onSweep?.(false); api.sweepY = undefined; solidClip.constant = 10; applyMode(m); loop();
    },
    setPaint(hex) { paint = hex; model?.paintMats.forEach((m: any) => m.color.set(hex)); loop(); },
    setPower(on) { power = on; applyPower(); },
    async setExplode(to, dur = 700) { const from = explode; await tween(dur, (t) => { explode = from + (to - from) * t; applyExplode(); }); },
    setExplodeNow(v) { explode = v; applyExplode(); },
    showStage(n) { model?.root.traverse((o: any) => { const m = /^Stage_(\d+)$/.exec(o.name); if (m) o.visible = Number(m[1]) === n; }); loop(); },
    setView(v) { if (v.yaw != null) yaw = v.yaw; if (v.pitch != null) pitch = v.pitch; loop(); },
    getView() { return { yaw, pitch }; },
    setZoom(z) { zoom = Math.min(1.8, Math.max(0.45, z)); loop(); },
    setAutoRotate(v) { autoRotate = v; loop(); },
    play(name) {
      const a = model?.actions[name]; if (!a) return;
      for (const k in model.actions) if (k !== name && !model.loops.includes(model.actions[k])) model.actions[k].stop();
      a.reset().play(); busy++; last = performance.now();
      setTimeout(() => { busy = Math.max(0, busy - 1); }, a.getClip().duration * 1000 + 150); loop();
    },
    screenY(y) { const v = new THREE.Vector3(0, y, 0).project(camera); return ((1 - v.y) / 2) * canvas.clientHeight; },
  };
  return api;
}

/** Drag (mouse/touch), wheel/pinch to zoom, arrow keys to orbit, +/- to zoom. Stops the idle spin on first touch. */
export function orbitControls(el: HTMLElement, api: Explorer, onTouch: () => void) {
  const pts = new Map<number, [number, number]>(); let pinch0 = 0, zoom0 = 1;
  el.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, [e.clientX, e.clientY]); el.setPointerCapture(e.pointerId); api.setAutoRotate(0); onTouch();
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = api.zoom; }
  });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    const [x, y] = p; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; api.setZoom((zoom0 * pinch0) / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]))); return; }
    const v = api.getView();
    api.setView({ yaw: v.yaw - (e.clientX - x) * 0.008, pitch: Math.min(1.2, Math.max(-0.2, v.pitch + (e.clientY - y) * 0.005)) });
  });
  const up = (e: PointerEvent) => pts.delete(e.pointerId);
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); api.setZoom(api.zoom * (1 + Math.sign(e.deltaY) * 0.08)); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { api.setZoom(api.zoom * 0.9); return; }
    if (e.key === '-') { api.setZoom(api.zoom * 1.1); return; }
    const k = ({ ArrowLeft: [0.15, 0], ArrowRight: [-0.15, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] } as Record<string, [number, number]>)[e.key];
    if (!k) return; e.preventDefault(); api.setAutoRotate(0); onTouch();
    const v = api.getView(); api.setView({ yaw: v.yaw + k[0], pitch: Math.min(1.2, Math.max(-0.2, v.pitch + k[1])) });
  });
}
