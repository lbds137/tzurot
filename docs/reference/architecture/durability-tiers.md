# Durability Tiers

What is truly Redis-ephemeral, what is conversation-scoped, and what has to
outlive both. The axis is **cost of loss × natural lifetime** — not storage
mechanism.

[`CACHING_AUDIT.md`](./CACHING_AUDIT.md) inventories the same caches on a
different axis (what breaks under horizontal scaling). That question cannot see
this one: a Redis entry and a DB row look identical to a scaling audit and are
completely different when the question is "what happens when this is lost."

## The sorting question

> If this is lost, does someone **pay again** — and does the thing it describes
> **outlive the conversation**?

Two yeses → tier 3. Pay-again but conversation-bound → tier 2. Neither → tier 1.

| Tier                        | Test                                                                                                           | Home                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **1 — ephemeral**           | recomputable for free; losing it is correctness-neutral                                                        | in-memory or Redis, short TTL                                        |
| **2 — conversation-scoped** | costs money or real latency to regenerate, and is meaningful exactly as long as the conversation it belongs to | the conversation-history row; dies with it at `DAYS_TO_KEEP_HISTORY` |
| **3 — globally durable**    | costs money to regenerate, and the underlying asset is immutable and shared across users                       | its own table (or an external system of record), no TTL              |

Redis then has exactly one honest job at tiers 2 and 3: an **L1 accelerator**,
never the system of record.

### Ask the prior question first: is it ever read twice?

The tier-1 test — "recomputable for free, loss is correctness-neutral" — is too
strict as written, and TTS audio is the counterexample. `storeTTSAudio` holds
generated speech between synthesis and delivery. It cost money, and losing it is
NOT correctness-neutral (the reply ships without voice). By the letter of the
test it is tier 2 or 3. It is neither, and short-TTL Redis is exactly right for
it.

The reason is that it is **never read twice**. It has one consumer, once, and
its only requirement is to outlive the slowest delivery path — which is what its
TTL is derived from. Tiering is about _re-reads_; a single-use buffer has no
durability question to answer, only a lifetime one.

So the real first question is **"will anything ever ask for this again?"** If
no, it is a transit buffer: size the TTL to the consumer and stop. Only if yes
does the cost-of-loss axis apply.

## Inventory

Every value below was re-read from source rather than copied from the previous
table — three of the eleven rows in `03-database.md` were wrong, so the table
itself could not be trusted as input.

That rule has one recorded exception, because the audit broke it and review
caught it: the first draft listed sticker descriptions as tier 3 with "own
table", read off a backlog note rather than the schema. The table does not
exist — it is a designed-but-unbuilt piece of doc-55 — so the audit had
converted its one genuine open violation into an example of the tier done
right. **A board entry describing a plan reads exactly like a board entry
describing a shipped thing.** Grep the schema.

### Tier 1 — ephemeral (correct as-is)

| What                                                                                                                                                                                                                   | Where                                                | Why tier 1                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Config/identity resolution (`BaseConfigResolver`, `LlmConfigResolver`, `VisionConfigResolver`, `SttResolver`, `ConfigCascadeResolver`, `ApiKeyResolver`, `PersonalityService`, `UserService`, `HttpPersonalityLoader`) | in-memory `TTLCache`, most with pub/sub invalidation | a DB query rebuilds them; loss costs one query        |
| Channel/admin settings, autocomplete, preset + browse pickers, voice list, model capabilities, maintenance flag                                                                                                        | in-memory `TTLCache`                                 | same — read models over rows we own                   |
| OpenRouter model catalogue                                                                                                                                                                                             | 5-min memory L1 → 24h Redis                          | an unpriced API call rebuilds it                      |
| Rate limit, quotas, credit exhaustion, dedup, fetch gates (`RateLimitCache`, `FreeTierRequestQuota`, `VisionFallbackQuota`, `CreditExhaustionCache`, `RedisDeduplicationCache`, `shapesFetchGate`)                     | Redis, TTL                                           | counters whose loss fails **open** by design          |
| UI/session state (dashboard `SessionManager`, `MemoryActionTokenService`, `MemoryModeSessionManager`, verification messages, db-sync report stash, nag cooldowns)                                                      | Redis, TTL                                           | losing it ends a UI session; nothing is unrecoverable |
| TTS audio (`storeTTSAudio`)                                                                                                                                                                                            | Redis, TTL sized to the delivery window              | paid, but single-use — see the prior question above   |

### Tier 2 — conversation-scoped

| What                | System of record                                                                                     | L1                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Vision descriptions | `attachmentEnrichment` on the history row's `messageMetadata`                                        | `VisionDescriptionCache`, 1h Redis |
| Voice transcripts   | the same field; a voice message with its own row also carries the transcript as that row's `content` | `VoiceTranscriptCache`, 1h Redis   |

Both were tier-2 **violations** when this idea was filed — Redis with no durable
tier behind them. Both were closed by persisting the built reference, so the
formatter now writes the same enrichment it renders.

One asymmetry survives: the replay hydrator heals a row's missing enrichment
from the vision cache but has no equivalent voice path, so a row written before
persistence shipped can still replay a transcript-less voice note. Bounded and
self-closing — the heal only helps within the 1h cache TTL, and rows predating
persistence age out of the 30-day history window on their own. Tracked
separately; not a tier violation, an incomplete backfill.

### Tier 3 — globally durable

| What                 | System of record          | Notes                                                                                                            |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Sticker descriptions | **none — OPEN VIOLATION** | tier 3 by the test, stored at tier 1: 1h Redis via the ordinary vision cache. See below                          |
| Cloned voice IDs     | **the TTS provider**      | `CloneCacheKernel` is a 30-min in-memory L1 with no local durable copy — which LOOKS like a violation and is not |

**Sticker descriptions are the one open violation this audit found.** A sticker
is the cleanest tier-3 asset in the system: describing it costs a vision call,
and the asset is immutable and shared across _every user who ever sends that
sticker_ — so one description could serve all of them forever. Instead, stickers
ride the ordinary attachment → download → vision → describe chain (deliberately,
to inherit the CDN allowlist, size caps, model cascade and failure fallbacks),
which means the description lands in `VisionDescriptionCache` — 1h Redis, L1
only, no durable tier. There is no sticker table or column in the schema.

The fix is already designed and unbuilt: the snowflake-keyed asset table is
doc-55's PR-2, the only outstanding piece of that idea. Tracked as TASK-389 so
the gap is a tracked violation and not only a feature idea — a feature can be
deprioritised on product grounds; a violation should be closed or consciously
accepted.

Worth noting why the reasoning that removed the vision L2 does not extend here:
that Postgres tier was dropped because Discord attachment URLs are ephemeral, so
persisting descriptions keyed to them bought little. A sticker snowflake is
stable and re-describable at any time, so the premise that justified dropping
the L2 is simply false for stickers.

**Cloned voices, in detail**, because the shape is instructive: cloning costs
money and the clone outlives any conversation, so it is unambiguously tier 3 —
and there is no `voiceId` column anywhere in the schema. The tier still holds,
because the resolution path lists voices at the provider before cloning. The
provider IS the system of record; our cache is a legitimate L1 over a remote
one.

The consequence to keep in view is that this makes our correctness depend on
someone else's list endpoint. A provider list that under-reports produces a
duplicate clone and a second charge, which is why the Mistral client's
pagination handling has its own guards. Tier 3 satisfied externally is a real
answer, not a loophole — but it is worth writing down that the durable store is
outside the blast radius of our own backups.

## Decisions this pass settles

**1. Does a tier-2 item ever get its own table, or is inline-on-the-row always
right?** Inline, so far, and the reason generalizes: a tier-2 item by definition
has no key dimension the conversation row does not already have, and inlining
gives it the row's retention for free — no second cleanup job, no orphan class,
no way for the enrichment to outlive the thing it describes. A table would be
justified only by a key that is genuinely not the row (a shared asset), and that
is the definition of tier 3. **The tier boundary and the storage decision are
the same question**, which is why "should this get a table?" is answered by
sorting it, not by estimating its size.

**2. Does `CACHING_AUDIT.md` gain a durability column, or is it superseded?**
Neither cleanly — it is **narrowed**. Its scaling analysis is still correct and
still useful; its headline finding is resolved and its inventory is stale.
Bolting a durability column onto it would produce one document answering two
questions and re-staling the inventory it already got wrong. So durability lives
here, the always-loaded table in `03-database.md` points here for tiers, and
`CACHING_AUDIT.md` keeps the scaling axis with its inventory marked historical.

## Adding a cache

1. **Will anything read it twice?** No → transit buffer; size the TTL to the
   consumer, stop here.
2. **Does losing it make someone pay again?** No → tier 1, any TTL store.
3. **Does the thing it describes outlive the conversation?** No → tier 2: the
   history row is the system of record, Redis is L1. Yes → tier 3: it needs a
   home that is not a TTL, which may be a table of ours or an external system of
   record you can actually re-read.
4. Add the row to `03-database.md`'s table **with its tier**, and put the real
   TTL constant in it.
