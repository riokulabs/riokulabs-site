import type { APIRoute, GetStaticPaths } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { renderCard, type CardInput } from '../../og/card';
import brand from '../../data/brand.json';
import { getFamily, listedGames, site, STATUS } from '../../lib/site';
import { STUDIO_NAME } from '../../config/brand';

export const getStaticPaths: GetStaticPaths = () => {
  const s = site();
  const rack = getFamily(s.home.historyFamily)?.stages.at(-1)?.image;
  const c = s.copy;
  const pages: { slug: string; card: CardInput }[] = [
    { slug: 'default', card: { title: STUDIO_NAME, eyebrow: 'Game mods', subtitle: s.home.heroTagline } },
    { slug: 'home', card: { title: STUDIO_NAME, eyebrow: 'Game mods', subtitle: s.home.heroTagline, image: s.mods.find((m) => m.slug === s.home.featuredMod)?.card } },
    { slug: 'games', card: { title: c.gamesIndex.title, eyebrow: 'Index', subtitle: c.gamesIndex.cardText || listedGames().map((g) => g.name).join(' · ') || undefined } },
    ...s.games.map((g) => ({ slug: `games/${g.slug}`, card: { title: g.name, eyebrow: 'Game', subtitle: g.tagline, image: g.art } })),
    { slug: 'mods', card: { title: c.modsIndex.title, eyebrow: 'All games', subtitle: c.modsIndex.cardText || undefined } },
    { slug: 'blog', card: { title: c.blogIndex.title, eyebrow: 'Dev log', subtitle: c.blogIndex.cardText || undefined } },
    { slug: 'roadmap', card: { title: c.roadmapIndex.title, eyebrow: 'Roadmap', subtitle: c.roadmapIndex.cardText || undefined, image: rack } },
    { slug: 'about', card: { title: s.about.title, eyebrow: STUDIO_NAME, subtitle: s.about.intro } },
    { slug: 'brand', card: { title: c.brand.title, eyebrow: 'Press kit', subtitle: s.brand.boilerplateShort } },
    { slug: 'legal', card: { title: c.legal.title, eyebrow: 'Small print' } },
    ...s.mods.map((m) => ({
      slug: `mods/${m.slug}`,
      card: { title: m.name, eyebrow: `${s.games.find((g) => g.slug === m.game)?.shortName ?? 'Game'} mod`, subtitle: m.tagline, status: m.status, statusLabel: STATUS[m.status].label, image: m.card ?? (m.hero?.kind === 'image' ? m.hero.image : m.hero?.video.poster) },
    })),
    ...s.posts.map((p) => ({ slug: `blog/${p.slug}`, card: p.spoiler ? { title: p.title, eyebrow: 'Dev log · spoiler', subtitle: c.spoilerNotice.title } : { title: p.title, eyebrow: 'Dev log', subtitle: p.subtitle ?? p.excerpt, image: p.cover } })),
  ];
  return pages.map((p) => ({ params: { slug: p.slug }, props: { card: p.card } }));
};

export const GET: APIRoute = async ({ props, params }) => {
  // The site default card (LOGO-BRIEF W5) is the logo family's own og-default.png when it ships one.
  if (params.slug === 'default' && brand.ogDefault) {
    return new Response(new Uint8Array(fs.readFileSync(path.resolve('public', brand.ogDefault.slice(1)))), { headers: { 'Content-Type': 'image/png' } });
  }
  const png = await renderCard((props as { card: CardInput }).card);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
