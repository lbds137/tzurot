---
id: doc-97
title: 'Theme: Character voice drift in long conversations'
type: other
created_date: '2026-09-05 17:15'
---

### Theme: Character voice drift in long conversations

_Focus: a character that has talked for months should sound like its card, not like a register that grew in its own history._

**Owner intake 2026-09-05, HIGH priority, the entry point for re-opening the memory overhaul (`doc-8`) as the beta.219 active epic.** Owner's words: none of the other work matters if they feel like they are losing touch with their characters. Backfill is back on the table. Model-parameter changes (thinking level, temperature) are ruled out unless absolutely necessary. beta.218 cuts first.

**Evidence** (owner handoff and debug payload under `docs/local/handoffs/`, gitignored; the drift curve from `voice-drift-curve.ts`, stored under `docs/local/handoffs/` and copied into `scripts/analysis/` to run because workspace packages only resolve from there, run read-only against prod on 2026-09-05, aggregates only):

- The prompt at generation time: ~7.6k tokens of card and protocol in the cached prefix, then ~30k tokens of cross-channel history (half of it the character's own turns), ~12k of channel history, then a ~13k-token memory archive and the current turn in the uncached tail. `cachedPromptTokens` 36,864 of 51,723. The card sits ~45k tokens upstream of the generation point behind the cache boundary, which is a legitimate constraint (prefix-cache hits) that the fix must preserve.
- Per-month stats over the character's memories (assistant side, per 1k chars): exclamation marks ran 1.3–3.8 from 2025-11 through 2026-02, 0.7–1.0 from April to July, then **0.06 in August and 0.01 in September**. The courtroom vocabulary (ledger, verdict, exhibit, archive, filed, ruling) is **zero through July**, then appears in August and doubles or triples in September. A pet name absent from the card runs 0.01 in April, 0.26 in August, 0.53 in September. Average reply length 830 chars in April, 1,652 in September. So this is a slow fade through spring and a **cliff in August 2026**, not a smooth five-month slide. August also carries 529 memories, the heaviest month on record, so the archive's self-reinforcement loop (each retrieval carries the character's own drifted prose verbatim) had the most material exactly when the register crystallised.
- The cross-channel history feature shipped 2026-02-28, so it is not the August trigger by itself. Candidates for what changed in August, unverified: usage volume (the archive loop), a model or preset change on the character (the current preset is `glm-5.3` at temperature 1.0), or both. Check the preset's history before attributing.
- Memory rows store `{user}: …\n{assistant}: …` with the reply verbatim (`services/ai-worker/src/services/LongTermMemoryService.ts` `storeInteraction`); the archive renders each as a `<historical_note>` (`services/ai-worker/src/services/prompt/MemoryFormatter.ts` `formatSingleMemory`). The protocol directives (`Structural Variety`, `Response Length Calibration`, `System Prompt Primacy`) live in the database `characterDirectives` JSON, rendered by `PersonalityFieldsFormatter.ts`; none of the three phrases appears in code.

### Phase 1 — voice anchor in the uncached tail (NEXT)

- [ ] Inject a `<voice_anchor>` block immediately before the current turn, after the memory archive, built at assembly time from the card's `personalityTraits`, `personalityTone`, and `conversationalExamples` (full field first, ~1k tokens worst case at the 4,000-char cap; measure the overhead across the catalog before any subset heuristic), with an instruction that the character's earlier turns are not a style reference and that accumulated pet names, running metaphors, sign-offs, and house structure not on the card are drift. Cache-neutral by placement: the tail is uncached every turn. Target (grounded 2026-09-05): `services/ai-worker/src/services/PromptBuilder.ts` `buildVolatilePrefix` assembles the V-tier sections `context` → `facts` → `memory_archive` → `contextual_references`; the anchor is a new section `voice_anchor` LAST in that array, nearest the turn, and `buildHumanMessage` prepends the prefix to the `<from>`-wrapped user message. The whole V tier is already outside the cached system message (`cacheObservability.ts`, `systemPromptCore`), so cache-neutral by construction. Fields render today through `PersonalityFieldsFormatter.ts` `PERSONALITY_FIELDS` / `formatField` into `system_identity`; reuse `formatField`. ESLint-counted lines: `PromptBuilder.ts` 273 (headroom 127), the formatter 121. The section-order pin lives in `PromptBuilder.test.ts` › `buildSystemMessage / buildVolatilePrefix` › `XML structure and ordering`. Nothing named voice/style anchor exists in ai-worker src (grep clean 2026-09-05). Owner rulings 2026-09-05: this unit precedes the prompt-caching Phase 2 (`doc-17`), and the LID pilot does NOT apply to it (starts at the `doc-8` design pass).
- [ ] Optional in the same block: a `<length_hint>` naming the user's last-message word count. Low confidence on its own; rides because the anchor is where recency helps.
- [ ] Validation: re-run the trigger message from the debug payload and check exclamation marks, reply length against the user message, absence of the pet name and courtroom vocabulary, presence of the card's identity markers; `cachedPromptTokens` unchanged relative to prompt size. Regression check on two or three other long-history characters, including one clinical one, so intentional flatness survives. Candidate instrument: the prompt-caching epic's voice harness (`pnpm ops prompt:mine-voice-probes` → `eval:voice-replay` → `eval:voice-judge` → `eval:voice-verdict`, see `active-epic.md` § doc-17) — its 2026-08-15 run was under-powered (the same-arm control judged 56% inconsistent at n=18), so a re-run needs near-zero generation temperature and more pairs before it can separate the arms.

### Phase 2 — the protocol directive (database edit)

- [ ] Add a `Voice Fidelity` directive beside `Structural Variety` in `characterDirectives`: voice comes from the card, history shows what was said not how to sound, accumulated register is drift. Weaker than the anchor (cached prefix, far from generation) and free. Owner applies the wording; the agent drafts it.

### Phase 3 — memory archive format (inside `doc-8`, the re-opened epic)

- [ ] The assistant side of a stored memory becomes a short third-person summary of what the character did, said, or decided; the user side stays. Removes the stylistic feedback loop and shrinks the archive (~1.3k tokens per memory today, mostly the character's prose). Decide write-time summary (an extra small model call per write, spend to measure) versus render-time treatment, and whether to backfill existing rows — the owner has put backfill back on the table. `Referenced content` blocks quoting the previous reply get the same treatment or are dropped from storage.

### Out of scope, recorded

- Reordering the prompt to put the card after history: breaks the cache prefix. Rejected.
- Truncating cross-channel history below 100 messages as the fix: loses continuity the owner relies on. Separate question.
- Per-character prompt overrides: unnecessary if the anchor works generically.
- Model-parameter experiments: owner call 2026-09-05, not unless absolutely necessary.
- Card-level: the character's card needs examples in its real daily domain in the card's own register, placed first. The owner's task, listed so the fix is understood as two-part.

