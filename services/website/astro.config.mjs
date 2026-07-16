// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static site for tzurot.org. The canonical `site` is always the prod domain —
// the Rotzot-branded dev deployment sets noindex + prod-pointing canonicals
// (see src/brand.ts), so the preview never competes with prod in search.
export default defineConfig({
  site: 'https://tzurot.org',
  output: 'static',
  integrations: [sitemap()],
  vite: {
    server: {
      fs: {
        // The legal content collection reads ../../docs/legal (single source
        // of truth lives with the repo docs, not copied into the site).
        // Scoped to exactly that directory — no reason to widen the dev
        // server's file-serving surface to the whole monorepo.
        allow: ['../../docs/legal'],
      },
    },
  },
});
