/**
 * Brand-aware robots.txt — the preview brand disallows crawling outright
 * (belt to the per-page noindex meta's braces), while prod advertises the
 * sitemap. Static endpoint: evaluated once at build time per deployment.
 */

import type { APIRoute } from 'astro';
import { BRAND, CANONICAL_ORIGIN } from '../brand';

export const GET: APIRoute = () =>
  new Response(
    BRAND.noindex
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\n\nSitemap: ${CANONICAL_ORIGIN}/sitemap-index.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
