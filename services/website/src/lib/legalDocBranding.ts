/**
 * Legal-document rendering pipeline: brand-name substitution with its two
 * safety guards, then markdown → HTML. Extracted from the Legal layout so the
 * guards are unit-testable and so `marked` is configured exactly ONCE at
 * module scope — a `marked.use()` in component frontmatter re-registers the
 * smartypants hook on every render of the shared singleton.
 */

import { Marked } from 'marked';
import { markedSmartypants } from 'marked-smartypants';

// One instance, configured once per process. Typographic quotes/dashes keep
// parity with the smartypants pass Astro's own markdown pipeline applied
// before the brand-substitution work switched rendering to marked.
const markdown = new Marked({ gfm: true }).use(markedSmartypants());

/**
 * Substitute the brand name into a legal document's markdown and render it.
 *
 * Substitution is CASE-SENSITIVE on purpose: capitalized "Tzurot" is prose
 * (the service name, swappable per deployment brand), while lowercase
 * "tzurot" occurs only inside URLs (tzurot.org, the GitHub repo) that must
 * never change. Pass `substitute: false` (the canonical brand) to render the
 * document verbatim.
 *
 * Throws — failing the static build — when either invariant is violated:
 * a capitalized URL in the source (would be corrupted by the substitution
 * before any post-check could see it), or a post-substitution "tzurot"
 * outside the known URLs (a prose shape replaceAll cannot brand-swap).
 */
export async function renderLegalDocument(
  body: string,
  brandName: string,
  substitute: boolean
): Promise<string> {
  // Brand-independent doc hygiene, checked before any substitution.
  if (/Tzurot\.org|lbds137\/Tzurot/.test(body)) {
    throw new Error(
      'Legal docs must write URLs in lowercase (tzurot.org, lbds137/tzurot) — a capitalized URL would be corrupted by brand substitution'
    );
  }

  const branded = substitute ? body.replaceAll('Tzurot', brandName) : body;

  if (substitute) {
    // Remove the two documentation URLs the name legitimately appears in,
    // then any remaining "tzurot" is un-substituted prose (a shape the
    // capitalized replaceAll above couldn't brand-swap). Strip-then-check
    // rather than an allowlist substring match on each token — the latter is
    // the incomplete-URL-sanitization shape (`token.includes('host')`), and
    // this is not host validation, it's a doc-content assertion.
    const residual = branded.replaceAll('tzurot.org', '').replaceAll('lbds137/tzurot', '');
    if (/tzurot/i.test(residual)) {
      throw new Error(
        'Legal-doc brand substitution left "tzurot" outside the known documentation URLs — check docs/legal for un-substituted prose'
      );
    }
  }

  return markdown.parse(branded, { async: true });
}
