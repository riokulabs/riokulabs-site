import type { APIRoute } from 'astro';
import { site } from '../lib/site';
/** Web app manifest (LOGO-BRIEF W4): icons from the installed logo family (scripts/brand.ts). */
export const GET: APIRoute = () => {
  const s = site().settings;
  return new Response(JSON.stringify({
    name: s.siteName, short_name: s.shortName, description: s.description, start_url: '/', display: 'browser',
    background_color: '#05070B', theme_color: '#05070B',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 1), { headers: { 'Content-Type': 'application/manifest+json' } });
};
