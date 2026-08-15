/**
 * Typed prompt sections — the assembly model for the system/human containers.
 *
 * Named, tier-tagged parts mirroring the `QueryPart` pattern in
 * `SearchQueryBuilder.ts` (name + text + offset diagnostics). The tier carries
 * the stability class from the prompt-assembly architecture
 * (`docs/proposals/backlog/prompt-assembly-architecture.md` §2.1) and drives
 * placement: S0/S1 sections form the cacheable system-message prefix, H
 * follows it, and V-tier sections render into the volatile prefix of the
 * current user message.
 *
 * `render()` returns a BARE block — no leading/trailing separator; the
 * assembler owns the joining. An empty string means "omit this section
 * entirely" (no separator is emitted for it — every section is uniformly
 * conditional, unlike the pre-section-model template which hardcoded the
 * first separators unconditionally). Phase 3 (provider cache markers) is
 * expected to widen `render()` to content-parts arrays; string is the
 * deliberate simpler shape while both containers are single strings.
 */

/**
 * Stability tier per the accepted architecture:
 * - S0: static across ALL personas (platform/output constraints)
 * - S1: stable-prefix sections — static per persona (identity, identity
 *   constraints, protocol) plus the per-channel location and the roster,
 *   whose active-flag/collision note still track the current speaker
 * - H: frozen conversation history (grows per turn)
 * - V: per-request volatile (datetime, retrieval output, references)
 *
 * Keep in lockstep with common-types' DiagnosticPromptSection.tier — the two
 * are structurally compatible mirrors with no compiler tie (the diagnostic
 * payload is untyped Json at the wire).
 */
export type SectionTier = 'S0' | 'S1' | 'H' | 'V';

/** One named contributor to an assembled prompt container, in append order. */
export interface PromptSection {
  /** Stable id, used in logs, diagnostics, and prefix-diff annotation. */
  id: string;
  tier: SectionTier;
  /** Bare block without separators; '' = omit the section. */
  render(): string;
}

/** The separator between rendered sections (matches the historical assembly). */
export const SECTION_SEPARATOR = '\n\n';

/** One rendered section's placement inside the assembled container. */
export interface SectionDescription {
  id: string;
  tier: SectionTier;
  /** Rendered length in chars (bare block, separators excluded). */
  chars: number;
  /** Offset of the block's first char in the assembled string. */
  offset: number;
}

/** A container's assembled text plus its section placement map. */
export interface SectionLayout {
  text: string;
  descriptions: SectionDescription[];
}

/**
 * Render every section ONCE and derive both the assembled string and the
 * per-section placement map from that single pass. `render()` therefore has a
 * single-call contract — load-bearing once Phase 3 widens renders to
 * content-parts arrays (and a hard requirement should any render ever grow a
 * side effect). Omitted (empty) sections produce no text, no separator, and
 * no description entry — an absent id in the map is itself signal.
 */
export function layoutSections(sections: PromptSection[]): SectionLayout {
  const descriptions: SectionDescription[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const section of sections) {
    const text = section.render();
    if (text.length === 0) {
      continue;
    }
    if (parts.length > 0) {
      offset += SECTION_SEPARATOR.length;
    }
    descriptions.push({ id: section.id, tier: section.tier, chars: text.length, offset });
    parts.push(text);
    offset += text.length;
  }
  return { text: parts.join(SECTION_SEPARATOR), descriptions };
}
