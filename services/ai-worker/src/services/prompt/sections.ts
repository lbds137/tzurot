/**
 * Typed prompt sections — the assembly model for the system/human containers.
 *
 * Replaces the single template-literal concatenation in `buildFullSystemPrompt`
 * with named, tier-tagged parts, mirroring the `QueryPart` pattern in
 * `SearchQueryBuilder.ts` (name + text + offset diagnostics). The tier tags the
 * stability class from the prompt-assembly architecture
 * (`docs/proposals/backlog/prompt-assembly-architecture.md` §2.1); placement
 * decisions keyed on tier arrive with the Phase-1 restructure — until then the
 * tier is descriptive metadata carried by the composition log and the
 * diagnostic payload (which the prefix-diff tool annotates against).
 *
 * `render()` returns a BARE block — no leading/trailing separator; the
 * assembler owns the joining. An empty string means "omit this section
 * entirely" (no separator is emitted for it). Phase 3 (provider cache markers)
 * is expected to widen `render()` to content-parts arrays; string is the
 * deliberate simpler shape while both containers are single strings.
 */

/**
 * Stability tier per the accepted architecture:
 * - S0: static across ALL personas (platform/output constraints)
 * - S1: static per persona (identity, identity constraints, protocol)
 * - H: frozen conversation history (grows per turn)
 * - V: per-request volatile (datetime, participants, retrieval output, references)
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

/**
 * Join the non-empty sections with the separator, in order.
 */
export function assembleSections(sections: PromptSection[]): string {
  return sections
    .map(section => section.render())
    .filter(text => text.length > 0)
    .join(SECTION_SEPARATOR);
}

/**
 * Describe each RENDERED section's size and offset in the assembled string.
 * Omitted (empty) sections produce no entry — an absent id in the description
 * is itself signal. The offsets index into `assembleSections`' output exactly;
 * the composition log and the prefix-diff tool both key on that property.
 */
export function describeSections(sections: PromptSection[]): SectionDescription[] {
  const descriptions: SectionDescription[] = [];
  let offset = 0;
  for (const section of sections) {
    const text = section.render();
    if (text.length === 0) {
      continue;
    }
    if (descriptions.length > 0) {
      offset += SECTION_SEPARATOR.length;
    }
    descriptions.push({ id: section.id, tier: section.tier, chars: text.length, offset });
    offset += text.length;
  }
  return descriptions;
}
