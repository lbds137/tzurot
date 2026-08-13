---
id: TASK-565
title: >-
  Character export omits empty tags so re-import cannot restore the untagged
  state
status: To Do
assignee: []
created_date: '2026-08-12 22:34'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 565000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: buildExportData omits tags when the array is empty (deliberate, the list-valued analogue of empty-string omission) and buildImportPayload maps absent -> undefined -> gateway leaves stored tags untouched. Consequence: export an untagged character, tag it later, re-import the old JSON as a restore - the tags silently survive. The clear form ([] clears) exists in the update schema; the export just never emits it. Related: CHARACTER_JSON_TEMPLATE ships realistic-looking "tags": ["fantasy","sci-fi"] where every other template value is self-describing placeholder prose - a user ignoring that line imports two tags they never chose.

Fix shape: export tags: [] explicitly (it IS meaningful), or document the asymmetry; make template values placeholder-shaped.

Acceptance: export/import round-trip restores the untagged state. Source: 2026-08-12 review (tags reviewer F6/F8, CONFIRMED).

GROUNDING (2026-08-13, corrects the scope above; owner approved the wider fix):

Tags is one member of a class of 11, not a standalone bug. buildExportData omits any null/undefined/empty-string/empty-array value, and every field whose update-schema form treats empty as a CLEAR has the same broken round-trip. The class: the 9 nullableString fields (displayName, personalityTone, personalityAge, personalityAppearance, personalityLikes, personalityDislikes, conversationalGoals, conversationalExamples, errorMessage - shared.ts nullableString converts empty string to null, which clears), plus customFields and tags. NOT in the class: name/characterInfo/personalityTraits (min(1), never empty), slug (required), isPublic/definitionPublic (booleans; false is not omitted by the export filter).

The fix is EXPORT-SIDE ONLY, but only if the right clearing form is chosen - and the wrong choice looks equally correct at the export site. buildImportPayload maps every optional field through `data.field ?? undefined`, so the exported value has to survive `??` to reach the gateway at all. Probed against both schemas: `''` and `[]` each parse to a clear (tone -> null, tags -> []) on PersonalityUpdateSchema AND PersonalityCreateSchema, and neither is nullish, so both pass `??` untouched. `null` also parses to a clear but is nullish, so exporting null would be collapsed back to undefined at the `??` and change nothing - an export-side fix that silently does not work.

So: export emits `''` for the 9 nullableString fields and `[]` for tags. No import-side change needed, and `''` is already the form the dashboard sends. The CREATE path is covered by the same probe, which matters because a re-import into a NEW slug validates against PersonalityCreateSchema (validatePayloadFields), not the update schema.

customFields is the one member not settled: its clear is `null` (nullish, so it would be collapsed), and `{}` sets an empty object rather than null. Decide at build time whether `{}` is an acceptable equivalent or whether this single field needs import-side handling.

Also fix CHARACTER_JSON_TEMPLATE's `"tags": ["fantasy","sci-fi"]` to be placeholder-shaped like every other line.

BUILD OUTCOME (2026-08-13) - two members dropped from the class after reading the gateway routes:

- displayName is NOT clearable. Both user routes rewrite an empty displayName to the character's `name` (create.ts:46-52, update.ts:79-82), so there is no cleared state to restore; emitting `''` would overwrite a stored null instead of preserving it. Omitting it, as today, round-trips correctly.
- customFields is NOT fixable here. Neither user route writes the column at all - create.ts buildCreateData has no customFields key and update.ts buildUpdateData omits it from simpleFields - so the value is dropped gateway-side whatever the export emits. Filed as TASK-590 (owner call: forward it or stop advertising it).

Shipped class: the 8 nullableString fields in the update route's simpleFields (personalityTone, personalityAge, personalityAppearance, personalityLikes, personalityDislikes, conversationalGoals, conversationalExamples, errorMessage) emit `''`, plus tags emitting `[]`. Template tags became `[]` rather than illustrative: a left-untouched example imports tags the user never chose, and a `"(optional)"` hint fails TAG_PATTERN and 400s the whole import (probed). Rider: getImportedFieldsList now excludes empty strings/arrays, or the success embed would list every cleared field as imported.
<!-- SECTION:DESCRIPTION:END -->
