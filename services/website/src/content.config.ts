/**
 * Content collections. The legal documents' single source of truth is
 * `docs/legal/` at the repo root — the glob loader reads them in place, so the
 * site can never drift from the committed policies. (The website Dockerfile
 * builds from the repo-root context for exactly this reason.)
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Entry ids are the glob loader's default: the filename slugified to
// lowercase — TERMS_OF_SERVICE.md → 'terms_of_service'. The pages look
// entries up by those ids and THROW when missing, so a docs/legal rename
// fails the (static) build loudly rather than shipping a broken page.
const legal = defineCollection({
  loader: glob({ pattern: '*.md', base: '../../docs/legal' }),
});

export const collections = { legal };
