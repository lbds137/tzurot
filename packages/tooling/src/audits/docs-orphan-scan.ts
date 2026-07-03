/**
 * Docs-Orphan Scan (health-report section, no CLI command)
 *
 * Finds `docs/reference/**\/*.md` files with zero inbound markdown links:
 * nothing else in the repo's markdown (any `*.md` outside node_modules,
 * excluding the file itself) mentions the file's basename. Same matching
 * style as `check-proposal-orphans.ts` — a word-boundary regex over the
 * basename-without-extension — but report-only: `pnpm ops health` prints
 * the count + list; nothing fails on it.
 *
 * Why report-only: reference docs are allowed to exist "for the future
 * reader" in a way proposals are not, so an orphan here is a review nudge
 * ("is this doc still reachable from anywhere?") rather than a defect. The
 * proposal check stays a hard gate; this is its softer sibling for the much
 * larger reference tree.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/** Where orphan candidates live (repo-relative). */
const DOCS_REFERENCE_ROOT = 'docs/reference';

/**
 * Directory names never traversed when collecting the repo-wide markdown
 * haystack. Build artifacts and vendored trees would only add noise (and
 * node_modules alone would multiply the scan cost by orders of magnitude).
 */
const SKIPPED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo']);

export interface DocsOrphanResult {
  /** Total `docs/reference/**\/*.md` files scanned. */
  totalDocs: number;
  /** Repo-relative paths of docs with zero inbound links. */
  orphans: string[];
}

/** Recursively collect every `.md` file under `dir`, skipping vendored trees. */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIR_NAMES.has(entry.name)) {
        results.push(...findMarkdownFiles(join(dir, entry.name)));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Dirent predicates don't follow symlinks, so cycles are impossible
      // (same rationale as check-proposal-orphans's lstatSync walk).
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

/**
 * Word-boundary regex for a doc slug, mirroring check-proposal-orphans: the
 * basename must appear as a standalone token (markdown link, bare mention),
 * not as a substring of a longer identifier. Case-insensitive because the
 * reference tree mixes SCREAMING_SNAKE_CASE and kebab-case names.
 */
function buildSlugMatcher(slug: string): RegExp {
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9_-])${escapedSlug}([^a-zA-Z0-9_-]|$)`, 'i');
}

/**
 * Pure scan. Reads every markdown file once, then tests each reference
 * doc's slug against every OTHER file's content (self-mentions don't count
 * as inbound links), short-circuiting on the first match.
 *
 * Precision caveat (accepted for a report-only signal): a single-segment
 * basename like `WHY.md` can be "rescued" by unrelated prose containing the
 * bare word. The proposal check hard-fails on such names; here a false
 * rescue merely under-reports, which is the safe direction for a nudge.
 */
export function scanDocsOrphans(repoRoot: string): DocsOrphanResult {
  const docs = findMarkdownFiles(join(repoRoot, DOCS_REFERENCE_ROOT));
  if (docs.length === 0) {
    // Nothing to check — skip the repo-wide haystack read entirely.
    return { totalDocs: 0, orphans: [] };
  }
  const allMarkdown = findMarkdownFiles(repoRoot);

  const haystack = allMarkdown.map(file => {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      content = '';
    }
    return { file, content };
  });

  const orphans: string[] = [];
  for (const doc of docs) {
    const matcher = buildSlugMatcher(basename(doc, '.md'));
    const hasInboundLink = haystack.some(
      entry => entry.file !== doc && matcher.test(entry.content)
    );
    if (!hasInboundLink) {
      orphans.push(relative(repoRoot, doc));
    }
  }

  return { totalDocs: docs.length, orphans: orphans.sort() };
}
