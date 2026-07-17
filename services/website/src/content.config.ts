/**
 * Content collections. Every rendered document's single source of truth is
 * repo markdown — `docs/legal/`, `docs/commands.md`, `docs/guides/` — read in
 * place by the glob loader, so the site can never drift from the committed
 * docs. (The website Dockerfile builds from the repo-root context for exactly
 * this reason.)
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Entry ids are the glob loader's default: the filename slugified to
// lowercase — TERMS_OF_SERVICE.md → 'terms_of_service'. The pages look
// entries up by those ids and THROW when missing, so a source-file rename
// fails the (static) build loudly rather than shipping a broken page.
const legal = defineCollection({
  loader: glob({ pattern: '*.md', base: '../../docs/legal' }),
});

// The user-facing slash-command reference (docs/commands.md is also the
// in-repo reference, hence the single-file pattern at the docs root).
const reference = defineCollection({
  loader: glob({ pattern: 'commands.md', base: '../../docs' }),
});

// User guides written for the website (and readable in-repo).
const guides = defineCollection({
  loader: glob({ pattern: '*.md', base: '../../docs/guides' }),
});

export const collections = { legal, reference, guides };
