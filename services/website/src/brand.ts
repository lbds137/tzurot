/**
 * Brand registry — one static site codebase, two deployments.
 *
 * The prod Railway service (tracks `main`) builds with SITE_BRAND=tzurot (the
 * default); the dev service (tracks `develop`) builds with SITE_BRAND=rotzot so
 * the two environments are visually unmistakable. Resolved at BUILD time via
 * process.env (Railway passes service variables to Docker builds as args).
 *
 * The dev/Rotzot brand is a preview surface: it sets `noindex` and every page's
 * canonical URL points at the prod domain, so the preview never competes with
 * tzurot.org in search results.
 */

import type { ImageMetadata } from 'astro';
import tzurotLogo from './assets/tzurot-logo.webp';
import rotzotLogo from './assets/rotzot-logo.webp';
import tzurotBanner from './assets/tzurot-banner.webp';
import rotzotBanner from './assets/rotzot-banner.webp';

export interface Brand {
  /** Display name shown in the header, hero, and titles. */
  name: string;
  /** The cube avatar mark. */
  logo: ImageMetadata;
  /** The wide hero/og artwork. */
  banner: ImageMetadata;
  /** True on the dev preview deployment — emits a robots noindex meta tag. */
  noindex: boolean;
}

const BRANDS: Record<string, Brand> = {
  tzurot: {
    name: 'Tzurot',
    logo: tzurotLogo,
    banner: tzurotBanner,
    noindex: false,
  },
  rotzot: {
    name: 'Rotzot',
    logo: rotzotLogo,
    banner: rotzotBanner,
    noindex: true,
  },
};

export const BRAND: Brand = BRANDS[process.env.SITE_BRAND ?? 'tzurot'] ?? BRANDS.tzurot;

/** Canonical home of the legal documents — always the prod domain. */
export const CANONICAL_ORIGIN = 'https://tzurot.org';

export const GITHUB_URL = 'https://github.com/lbds137/tzurot';
