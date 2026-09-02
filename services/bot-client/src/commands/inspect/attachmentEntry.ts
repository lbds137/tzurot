/**
 * Renders one attachment entry in the `/inspect` Input view: the numbered
 * description plus a `Model:` line naming the vision model that produced it.
 * Extracted from `extendedViews.ts` so that file stays under its line limit.
 */

import type { DiagnosticInputProcessing } from '@tzurot/common-types/types/diagnostic';
import { escapeFenceBreaks } from '../../utils/fenceEscape.js';

type AttachmentEntry = DiagnosticInputProcessing['attachmentDescriptions'][number];

/**
 * Format one attachment's numbered description, plus a second `Model:` line
 * when attribution is known. Mirrors `buildModelFooterText`'s `Model:`
 * prefix and ` → ` routing arrow vocabulary, in plain text (no markdown
 * links — this renders into a fenced/text surface).
 */
export function formatAttachmentEntry(entry: AttachmentEntry | string, index: number): string {
  // Diagnostic rows are read back from JSONB with no runtime validation
  // (a z.unknown() passthrough plus a cast), so a row written under the
  // prior attachmentDescriptions shape can still hand this a bare string
  // instead of the current { description, attribution } object.
  const normalizedEntry: AttachmentEntry =
    typeof entry === 'string' ? { description: entry, attribution: null } : entry;
  const descriptionLine = `${index + 1}. ${escapeFenceBreaks(normalizedEntry.description)}`;
  const { attribution } = normalizedEntry;
  if (attribution === null) {
    return descriptionLine;
  }

  const model = escapeFenceBreaks(attribution.model);
  // A cached entry carrying a routedModel isn't a shape that occurs (the cache
  // records only the producing model) — the cached arm takes priority.
  if (attribution.fromCache) {
    // A legacy cache entry with no recorded model degrades to an empty string;
    // render the description alone rather than an empty `Model:` line.
    return model.length === 0 ? descriptionLine : `${descriptionLine}\n   Model: ${model} (cached)`;
  }

  const { routedModel } = attribution;
  if (routedModel !== undefined && routedModel.length > 0 && routedModel !== attribution.model) {
    return `${descriptionLine}\n   Model: ${model} → ${escapeFenceBreaks(routedModel)} (routed)`;
  }
  return `${descriptionLine}\n   Model: ${model}`;
}
