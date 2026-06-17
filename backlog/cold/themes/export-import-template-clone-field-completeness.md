### Theme: Export/Import/Template/Clone Field Completeness — schema-derived, not hard-coded

_Focus: kill hard-coded field lists across every serialize/deserialize surface — derive from the Zod schema so a new field defaults to included, not silently dropped. Overlaps the Character Portability theme (export/import) but is broader (presets, config templates, clones)._

**Surfaced 2026-06-11 (user)** while editing presets. `/preset export` builds its JSON from a **hard-coded** `EXPORT_FIELDS` list (`services/bot-client/src/commands/preset/export.ts:20`), plus hard-coded `SAMPLING_PARAMS` and `REASONING_PARAMS`. Add a field to the llm-config schema and it **silently won't export** unless someone manually updates the list → drift-prone data loss.

**Scope** — enumerate every serialize/deserialize/template/clone surface and check whether its field set is **schema-derived (single source of truth)** or hand-listed:

1. Preset export/import/clone: `export.ts` (`EXPORT_FIELDS`/`SAMPLING_PARAMS`/`REASONING_PARAMS`), the import counterpart, `createClonedPreset` (`cloneName.ts`).
2. Any other export/import/template: personality export/import, shapes import, config templates/defaults, TTS-config equivalents.
3. For each hand-listed set: prefer deriving from the Zod schema (co-located "exportable projection" or `schema.keyof`) so a new field defaults to **included**. Where exclusion is deliberate (computed/server-side fields, `isGlobal`), make it an explicit **deny-list against the schema's full key set** — fail-open-to-completeness, not fail-closed-to-silent-omission.

**Confirmed cross-surface inconsistency (the real lead)**: **characters round-trip visibility, presets don't.** `character/export.ts` `EXPORT_FIELDS` **includes `isPublic`** and `character/import.ts` reads it back; preset export **excludes `isGlobal`**. Same concept, opposite handling — reconcile to one policy (lean: match characters — round-trip visibility for presets too). **Why a theme**: cross-cutting (export/import/template/clone surfaces + possibly the schema layer); the per-surface fix is small but needs the full enumeration first.
