/**
 * YouTube video ids for the embedded player (sections.youtube-embed). The CMS field takes whatever an editor
 * pastes: a watch URL, a youtu.be short link, a /shorts/, /embed/ or /live/ URL (youtube.com or youtube-nocookie.com),
 * or a bare id. Only https URLs on those hosts are accepted, and the id must be exactly 11 URL-safe characters; anything
 * else returns undefined and the section is dropped.
 */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const EMBED_HOSTS = new Set([...WATCH_HOSTS, 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

export function youtubeId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const s = input.trim();
  if (YOUTUBE_ID.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (SHORT_HOSTS.has(host)) id = parts.length === 1 ? parts[0] : undefined;
  else if (WATCH_HOSTS.has(host) && u.pathname === '/watch') id = u.searchParams.get('v');
  else if (EMBED_HOSTS.has(host) && parts.length === 2 && (parts[0] === 'embed' || (WATCH_HOSTS.has(host) && (parts[0] === 'shorts' || parts[0] === 'live')))) id = parts[1];
  return id && YOUTUBE_ID.test(id) ? id : undefined;
}

/** The privacy-enhanced player URL (youtube-nocookie.com). */
export const youtubeEmbedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
/** The plain YouTube page (the "Watch on YouTube" link). */
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
