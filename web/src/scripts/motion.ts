/**
 * Small shared motion helpers (SPEC §5.4):
 * - .reveal fallback where CSS scroll-driven animations aren't supported (adds .is-in once in view);
 * - in-view loop videos: play only while visible, never under reduced motion, one at a time, paused when hidden.
 */
export const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = () => !!(navigator as any).connection?.saveData;

if (!CSS.supports('animation-timeline: view()')) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

// Loop videos: <video data-loop> inside .loop (components/LoopVideo.astro)
const loops = [...document.querySelectorAll<HTMLVideoElement>('video[data-loop]')];
let playing: HTMLVideoElement | null = null;
const userPaused = new WeakSet<HTMLVideoElement>();
const setBtn = (v: HTMLVideoElement) => {
  const btn = v.closest('.loop')?.querySelector<HTMLButtonElement>('[data-loop-toggle]');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(!v.paused));
  btn.querySelector('span')!.textContent = v.paused ? 'Play loop' : 'Pause loop';
};
const play = (v: HTMLVideoElement) => {
  if (playing && playing !== v) playing.pause();
  if (v.preload !== 'auto') v.preload = 'auto';
  v.play().then(() => { playing = v; setBtn(v); }).catch(() => setBtn(v));
};
if (loops.length) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting && e.intersectionRatio > 0.5) {
        if (!reducedMotion() && !saveData() && !userPaused.has(v)) play(v);
      } else if (!v.paused) { v.pause(); setBtn(v); }
    }
  }, { threshold: [0, 0.5, 0.75] });
  for (const v of loops) {
    io.observe(v);
    v.addEventListener('pause', () => setBtn(v));
    v.addEventListener('play', () => setBtn(v));
    v.addEventListener('playing', () => v.classList.add('is-playing'), { once: true });
    v.closest('.loop')?.querySelector('[data-loop-toggle]')?.addEventListener('click', () => {
      if (v.paused) { userPaused.delete(v); play(v); } else { userPaused.add(v); v.pause(); }
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) playing?.pause(); });
  document.addEventListener('site:motion', (e) => { if ((e as CustomEvent).detail.reduced) loops.forEach((v) => v.pause()); });
}
