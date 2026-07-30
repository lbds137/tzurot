---
id: doc-55
title: 'Idea: Vision-describe stickers and custom emoji via a write-once asset cache'
type: other
created_date: '2026-07-30 11:00'
---

_Owner idea 2026-07-30, after #1868 shipped name-only sticker/poll descriptions:
stickers should go through the vision pipeline rather than being reduced to a
name; custom emoji maybe, gated on cost. Owner's own proposal: cache
descriptions in a DB keyed by the asset's snowflake so nothing is re-described.
That instinct is right, and the grounding below makes it cheaper than expected._

**SCHEDULED (owner, 2026-07-30): build this as the capstone of the NEXT release,
not now.** Not a high current priority, but explicitly not to be put off long —
the owner wants to keep draining the follow-up pool first and then land this so
the release has something interesting in it beyond internal refactors. **Promote
when**: the drain run for the next release is judged sufficient and the cut is
being planned — this goes in BEFORE the release PR, as its headline item. Design
is settled (both open calls decided below), so it is build-ready on promotion.

## Two grounded facts that shape the whole design

_Provenance: both were read directly out of the **installed discord.js 14.27.0**
(`typings/index.d.ts` for the edit-options interfaces, `src/util/Constants.js` for
the sticker format map, `src/structures/Sticker.js` for `get url()`), not inferred
from documentation. The PR's reviewer could not confirm them — its sandbox has no
`node_modules` — so this note exists to stop a future session re-doubting them.
They are pinned to that major: re-check if discord.js v15 lands, since fact 1 is
load-bearing for "no invalidation" and fact 2 for the fallback path._

**1. Asset images are IMMUTABLE per snowflake — the cache needs no invalidation.**
`GuildStickerEditOptions` is `{name, description, tags, reason}` and
`GuildEmojiEditOptions` is `{name, roles, reason}`; only the *create* options take
a `file`. Changing an emoji's or sticker's image requires delete + re-upload,
which mints a **new** snowflake. So a description keyed by snowflake is valid
forever: **write-once, no TTL, no pub/sub, no staleness question.** Per
`03-database.md`'s cache decision tree, the "does staleness cause incorrect
behavior?" branch is not merely answered but inapplicable — this is a plain
table, not the Redis+invalidation-service shape most caches here need. (Renames
don't matter: the description describes the image.)

**2. Lottie stickers cannot be rasterized — a name-only fallback is required
from day one.** `StickerFormatExtensionMap` maps format 3 (Lottie) to `.json`, so
`sticker.url` yields a vector-animation document, not an image. Formats: PNG(1)
and APNG(2) → `.png` (vision-ready; APNG gives a first frame), GIF(4) → `.gif`,
**Lottie(3) → no raster exists.** Discord's own default packs are heavily Lottie.
Convenient symmetry: those same official-pack stickers ship a real
Discord-authored `description` ("Blob having a party"), which #1868 already
renders — so the un-rasterizable slice is largely the slice that needs vision
least. Animated GIF/APNG assets get one frame described; acceptable, worth noting.

## Recommended shape

**Inject stickers as synthetic attachments; do not build a parallel describe
path.** A sticker has a URL and a derivable content type, and the existing
attachment → download → vision → describe → persist-onto-history-row chain
(`DownloadAttachmentsStep`, `MultimodalProcessor`, `VisionDescriptionWriter`)
already does every step. The only genuinely new component is the snowflake-keyed
lookup in front of the vision call. That is a far smaller surface than a
sticker-specific pipeline, and it inherits BYOK key routing, the vision-model
cascade, and failure handling for free.

Table sketch. Cardinality is small and bounded: Discord caps custom emoji and
stickers per guild (the exact ceilings are boost-tier-dependent and are Discord
product policy, so check them at build time rather than trusting a number
here) — the load-bearing point is only that the table grows with the number of
distinct assets ever *seen*, not with message volume, so it stays orders of
magnitude below anything needing pagination or pruning:

```
discord_asset_descriptions
  snowflake   String @id      // sticker or emoji ID
  kind        String          // 'sticker' | 'emoji'
  name        String          // for debugging/audit; NOT the cache key
  description String          // the vision output, reused verbatim
  createdAt   DateTime @default(now())
```

## Stickers vs. emoji — split them, and not for the reason it looks like

The cache makes **vision-call volume a non-issue** (warmup only, then a ~100%
hit rate on reused assets). So the stated worry — inflating vision calls — is
largely solved by the cache itself. The costs that actually remain are different
ones, and they argue for treating emoji differently:

1. **Prompt tokens, recurring on every turn.** A description is ~15–25 tokens.
   An emoji-dense message (10+ custom emoji, normal in some servers) adds
   150–250 tokens, and pays that cost again in **every history window the
   message appears in** — unlike the one-time vision call.
2. **Marginal signal is much lower for emoji.** Custom emoji names are usually
   already descriptive (`:blobcatthumbsup:`, `:pepehands:`), so a description
   adds little over the name. A sticker's name is frequently terse while the
   image *is* the message — a much better value-per-token ratio.

## Both open calls — DECIDED by council (2026-07-30, unanimous 3/3)

GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max, asked in parallel. No split, so no
tiebreaker pass. Both answers were unanimous, and the second one **overruled the
agent's own recommendation** (which had been the emoji-dominant gate below).

**1. Asset descriptions use the SYSTEM key, never a user's BYOK key.** All three
framed this identically and it's the framing that settles it: a description is
**infrastructure indexing, not a conversational turn.** A BYOK key exists to fund
that user's own generations; the first-sighter would instead be funding a global
cache row every other user and persona then reads for free. The objection is
principle and least-astonishment, not cost ("why was I charged for a sticker I
sent once?"). It's also the simpler build — no per-user key routing or
conditional billing branch. Interacts with `doc-43` (BYOK-first extraction
billing) but does not contradict it: extraction is work done *for that user*,
asset description is not.

**2. Custom emoji are NEVER vision-described — name-only, permanently.** All
three chose (c) over the emoji-dominant gate (b), and rejected (b) on the same
two grounds: the marginal information is near-zero because the *name already
contains the semantic payload* a vision model would generate
(`:blobcatthumbsup:` → "a cartoon cat giving a thumbs up"), and — the argument
that changed the agent's mind — **(b) creates user-visible inconsistency**: the
same emoji gets understood differently depending on the surrounding text, which
is exactly the surprising behavior the heuristic was meant to avoid. Qwen named
the only case (b) would genuinely serve — a badly-named emoji like `:img_8492:`
used alone — and judged it too rare to build a pipeline branch for. Revisit only
if real logs show specific custom emoji are repeatedly ambiguous to the model.

**Consequence: the build shrinks substantially.** No emoji path, no
dominance heuristic, no `kind` discriminator needed on the table (stickers
only), and no key-selection logic. What remains is: inject stickers as
synthetic attachments, look up by snowflake, describe once on the system key,
fall back to name+Discord-description for Lottie.

## Related

- #1868 shipped the name-only rendering this would upgrade
  (`services/bot-client/src/utils/stickerPollDescriptions.ts`); its
  `[Stickers: name — description]` form is the natural place a vision
  description would substitute for the name.
- `TASK-356` — edit-path description refresh; the immutability finding above
  means a sticker's *image* description never needs refreshing, which narrows
  that task to poll-question edits only.
- `doc-26` message-actions design, `doc-54` diegetic Discord events — adjacent
  Discord-surface work.
