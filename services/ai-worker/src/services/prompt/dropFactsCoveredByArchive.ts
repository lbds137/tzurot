/**
 * D10 (memory-archive-format.md): a fact must not render twice — once inside
 * the split memory archive's "Recorded about this exchange" list and again in
 * the separate `<facts>` block. Pure; applied by `PromptBuilder.buildVolatilePrefix`
 * ONLY in split-render turns (verbatim mode leaves `options.facts` untouched).
 *
 * The dedup key is the fact id actually rendered inside a SURVIVING note, not
 * source-memory overlap. `stampArchiveRenderMode` attributes a fact linked to
 * several memories to exactly one of them (the most relevant, before budget
 * selection ever runs), and budget selection is not a prefix cut — it can
 * drop that one memory while keeping a smaller sibling later in the list. A
 * fact whose owning note got dropped is not rendered anywhere, even though a
 * sibling source memory it was ALSO extracted from survived — so overlap with
 * the surviving memory-id set is the wrong signal; only "is this fact's id
 * inside a note that actually made it into the prompt" is correct.
 */

import type { FactForPrompt, MemoryDocument } from '../ConversationalRAGTypes.js';

/**
 * Drop any fact whose `id` appears in a surviving split note's
 * `archiveRender.linkedFacts` — that fact is already surfaced inside the
 * archive note for its source memory. A fact with `id` absent is KEPT (there
 * is nothing to match it against).
 */
// @spec MEM-ARCH-008 — D10 dedup applies in split mode only (caller-gated)
export function dropFactsCoveredByArchive(
  facts: FactForPrompt[],
  memories: MemoryDocument[]
): FactForPrompt[] {
  const renderedFactIds = new Set(
    memories.flatMap(doc => doc.metadata?.archiveRender?.linkedFacts ?? []).map(f => f.id)
  );
  return facts.filter(fact => fact.id === undefined || !renderedFactIds.has(fact.id));
}
