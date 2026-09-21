/**
 * Entity tag vocabulary for memory facts.
 *
 * An entity tag is a free-form label attached to an extracted memory fact
 * (the `entity_tags` string array column) that names what KIND of thing the
 * fact captures about a conversation participant — a promise, a decision, an
 * address, a piece of advice. Extraction assigns these tags; UI surfaces
 * (autocomplete, filters) need a fixed vocabulary to offer as suggestions
 * even though the underlying column accepts any string.
 *
 * This is the UI-facing vocabulary for the "commitment" family of tags —
 * the kinds a user is most likely to want to filter facts by. It is a
 * separate copy from the model-facing extraction prompt's vocabulary by
 * design: the prompt is tuned for what the model should emit, while this
 * list is tuned for what a human picks from an autocomplete menu. The
 * sibling copy is the "commitment:*" kind list in
 * services/ai-worker/src/services/extraction/extractionPrompt.ts —
 * adding a kind means editing both.
 */
export const COMMITMENT_TAG_KINDS = [
  'commitment:promise',
  'commitment:decision',
  'commitment:address',
  'commitment:advice',
] as const;
