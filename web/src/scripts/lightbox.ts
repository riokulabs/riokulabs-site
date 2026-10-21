/**
 * Wires a Lightbox.astro <dialog> to its triggers. The root holds the dialog, a <script type="application/json"
 * data-items> with the item list, and links marked [data-lightbox-index]. Each link keeps a real href (the full image,
 * or a page) so it still works without JS or with a modifier key; a plain click opens the viewer in place instead.
 */
import { reducedMotion } from './motion';

export type LightboxItem = { kind: 'image' | 'loop'; full: string; video?: string; alt: string; title: string; meta?: string; caption: string; w: number; h: number };

export function bindLightbox(root: HTMLElement): void {
  const data = root.querySelector('[data-items]');
  const dlg = root.querySelector('dialog');
  if (!data || !dlg) return;
  const items: LightboxItem[] = JSON.parse(data.textContent ?? '[]');
  if (!items.length) return;
  const stage = dlg.querySelector('.lightbox__stage')!;
  let index = 0;
  const show = (i: number) => {
    index = (i + items.length) % items.length;
    const it = items[index];
    stage.replaceChildren();
    if (it.kind === 'loop' && it.video) {
      const v = document.createElement('video');
      Object.assign(v, { src: it.video, poster: it.full, muted: true, loop: true, playsInline: true, controls: true, autoplay: !reducedMotion() });
      v.setAttribute('aria-label', it.alt || it.title);
      v.width = it.w; v.height = it.h;
      stage.append(v);
    } else {
      const img = new Image(it.w, it.h);
      img.src = it.full; img.alt = it.alt; img.decoding = 'async';
      stage.append(img);
    }
    dlg.querySelector('.lightbox__title')!.textContent = it.title;
    dlg.querySelector('.lightbox__meta')!.textContent = it.meta ?? '';
    dlg.querySelector('.lightbox__text')!.textContent = it.caption;
    dlg.querySelector('.lightbox__count')!.textContent = `${index + 1} / ${items.length}`;
  };
  root.querySelectorAll<HTMLAnchorElement>('[data-lightbox-index]').forEach((a) =>
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      show(Number(a.dataset.lightboxIndex));
      dlg.showModal();
    }),
  );
  dlg.querySelector('[data-close]')!.addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-prev]')!.addEventListener('click', () => show(index - 1));
  dlg.querySelector('[data-next]')!.addEventListener('click', () => show(index + 1));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => stage.replaceChildren());
  let x0: number | null = null;
  stage.addEventListener('pointerdown', (e) => { x0 = (e as PointerEvent).clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = (e as PointerEvent).clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
  });
}
