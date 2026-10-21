/** Props of components/Seo.astro (shared with layouts/Base.astro). */
export interface SeoProps {
  title?: string;
  description?: string;
  path: string;
  ogPath?: string;
  ogAlt?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  publishedTime?: string;
  modifiedTime?: string;
}
