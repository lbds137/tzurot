---
id: TASK-651
title: 'S1 participants churn is now the dominant prompt-cache miss, ahead of chat_log'
status: To Do
assignee: []
created_date: '2026-08-18 01:57'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 651000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.204 post-deploy prefix-diff on prod channel 1481138179917615144 (5 post-deploy pairs, 2026-08-18 00:01-00:33Z). The count-cap hysteresis WORKS -- when S1 holds still, the cut lands at H chat_log offsets 103,184 and 108,590 (97 percent common prefix), against a pre-deploy baseline of 32,334-32,451 at 29-30 percent. Roughly 3x deeper.

But 2 of the 5 pairs are cut at S1 participants (offsets 30,862 and 30,894, 28-30 percent) -- and they are 19 minutes apart, so this is NOT the one-time prefix warm the release notes predicted for #2129. The participants block genuinely changes between generations, most likely as the speaking roster shifts. That now caps the cache benefit well below what the chat_log-stable pairs demonstrate, which makes S1 the next bottleneck rather than H.

Not yet measured: the cached-TOKEN delta. The cacheHitRatio observability lines were not present in the queried prod window, so only the char-level prefix data is in hand. Convert before quoting a token or cost number.

Fix shape: find what varies in the participants block between consecutive generations in one channel -- roster membership, ordering, bio content, or the #2129 attribution lead-in -- then decide whether the volatile part can move DOWN a stability tier (out of S1 into H or V) the way the design intends. Read prompt-assembly-architecture.md on the S0/S1/H/V tiering before proposing a change.

## SECOND CHANNEL + MORE PAIRS 2026-08-18 19:5xZ (folded in from the duplicate TASK-663, now archived)

A later read added channel 1498247824662335608, 12 pairs: 12/12 still cut at
H chat_log, offsets moved from a 14-char band at 27,451-27,465 to a spread of
27,350-97,986, with 9 of 12 above 54,000. That corroborates the "hysteresis
works when S1 holds still" half on a second channel, and the ~3x figure.

Re-read of THIS channel at the same time: 8 pairs, 6/8 at H chat_log spanning
32,326-101,954, and 2/8 still at S1 participants (the same 30,862 / 30,894).
So the S1 divergence is stable across ~19 hours, not a transient.

Two floors observed: two channel-A pairs cut at exactly 27,350, consistent with
count-cap eviction breaking the prefix at the top of chat_log -- the expected
residual, not a failure.

NEW SUSPECT the original filing could not name: TASK-657 slice A added sibling
CHARACTERS to this same roster. A new character speaking now churns the block
too, which did not exist when either read was taken. It does not explain the
observations above (both predate the deploy) but it widens the fix's scope --
whatever stabilises the roster must cover both entity kinds.

CAUTION on the fix-shape list: "bio content" is named there as a candidate
cause. For the HUMAN roster that is `<about>`; there is no character bio in the
roster today, and TASK-660 will add one. Do not read the two as the same thing.

MEASUREMENT CAVEAT, verified 2026-08-18: `cache:prefix-diff` emits NO
cached-token figure, and no other `ops cache:*` command does either (checked via
--help). The "convert before quoting a token or cost number" note above
therefore needs the diagnostic payload's cacheHitRatio, not this command.

Acceptance: the cause of the S1 participants delta between consecutive same-channel generations is identified and named, and either fixed or ruled out with a recorded reason. The cause must be attributed between a genuinely NEW participant (benign, unavoidable, one-time per arrival) and pure window-slide rotation (waste) -- only the second is worth fixing.

## CAUSE IDENTIFIED 2026-08-19 — a field flickers on an EXISTING entry

Read with the new `cache:prefix-diff --show-divergence` (#2146; the instrument
gap was that the tool named the SECTION and could not show the change). The
S1-diverging pair on channel 1481138179917615144 breaks in the MIDDLE of one
participant element: same participant id, same rendered name, same roster
position, and `<guild_info>` present in the newer prompt while absent in the
older one. Identifiers withheld here on purpose -- `tracker/` is a public repo
surface and the window is verbatim prompt text.

So the acceptance criterion's two-way attribution has no bucket for this. It is
neither a genuinely NEW participant nor window-slide eviction of one: nobody
enters or leaves. It is unambiguously the WASTE side -- three lines of Discord
role metadata cost the entire prefix from offset 30,894 onward, roughly 78k
chars of chat_log.

WHY the two halves can disagree, which is the actual defect:

- roster MEMBERSHIP comes from DB history -- `extractParticipants(historyEntries, ...)`
  at services/ai-worker/src/jobs/handlers/pipeline/steps/ContextStep.ts:217.
- the entry's `<guild_info>` comes from a DIFFERENT source, the extended-context
  Discord fetch, collected at services/bot-client/src/services/DiscordChannelFetcher.ts:289
  and gated on `msg.member`.

Two windows, one block. A participant holds their roster seat via the DB while
their guild metadata is sourced from a shorter, per-turn Discord fetch.

TWO code-level candidates for the flip, NOT discriminated at runtime -- the
EFFECT is runtime-confirmed, this half is code-reading only:
(a) the participant has no message inside the extended-context fetch window on
    that turn, so nothing to extract from;
(b) `msg.member` is null because discord.js had no cached GuildMember at that
    moment, so the `&& msg.member` guard skips collection.
Both are per-turn and neither tracks roster membership. The fix does not depend
on which fires, so discriminating them is optional, not blocking.

FIX SHAPE -- this IS the "move the volatile part down a stability tier" the
original filing asked for, and the tier is not the problem so much as the
SOURCE. `<guild_info>` is decoration (roles, colour, join date) drawn from a
volatile per-turn fetch and rendered into the single most cache-sensitive block
in the prompt. Options, owner call because it trades information for cost:
1. drop `<guild_info>` from `<participants>` entirely -- simplest, and its
   informational value to a character is arguably low;
2. persist a last-known value per participant so the rendered bytes are stable
   whether or not this turn's fetch saw them -- keeps the information, costs a
   write path;
3. keep it but render it only when it can be rendered on EVERY turn, which in
   practice means (2).
Do not "fix" this by widening the extended-context window: that makes the flip
rarer without making it deterministic, which is the worst of both.

Note ParticipantFormatter's module docstring already states the invariant this
violates -- every byte it emits must derive from the roster alone. `guild_info`
derives from a per-turn fetch, so the invariant was already false when written;
it was reasoned about per-SPEAKER and never per-FETCH.

MEASUREMENT CAVEAT, now resolvable: the "no cached-token figure" note above is
answered by TASK-643, which names the payload paths -- `llmResponse.promptTokens`
and `llmResponse.cachedPromptTokens` at the TOP level of llmResponse, not nested
under `usage`. Convert through those rather than re-deriving.

## OWNER DECISION 2026-08-19 — persist a last-known guild_info

Asked as a three-way (drop it / persist a last-known value / accept the misses);
the owner chose PERSIST. So the information stays and the churn goes, which
means the fix is a write path rather than a deletion.

Binding consequences for whoever builds it:

- The rendered bytes must be identical whether or not THIS turn's
  extended-context fetch saw the participant. That is the acceptance test, and
  it is stateable as a unit test: render the roster twice, once with the guild
  map populated and once with it absent, and assert byte equality.
- Storage is per-participant, not per-turn. The natural home is alongside the
  persona/participant row rather than in the job envelope, precisely because
  the envelope is the volatile thing that caused this.
- The write is a HIGH-FREQUENCY, NON-SEMANTIC stamp on whatever row holds it.
  If that row is sync-tracked, 03-database.md's LWW rule applies: write it via
  $executeRaw so it does not bump updated_at and hand this env the next
  dev/prod sync. Check syncTables.ts before choosing the column's home.
- ANTI-ROT IS A REQUIREMENT, not an afterthought (owner, same conversation:
  "that last known value needs to be kept from rotting to the best of our
  ability"). The bullet that stood here first said staleness was acceptable by
  construction; that was too permissive and is corrected.

  The distinction that makes both goals reachable at once: EXPIRY DELETES,
  REFRESH REPLACES. A TTL is the wrong tool because it makes the value VANISH
  when it lapses, which is the exact flicker being removed, just on a slower
  clock. Refreshing has no such failure mode — the value is only ever
  overwritten by a newer observation, never emptied.

  So the design is WRITE-THROUGH ON EVERY OBSERVATION: any turn whose
  extended-context fetch does see the member overwrites the stored value.
  For an active participant that means the stored copy is written this turn and
  is not stale at all; the stored copy only carries weight for someone the
  fetch happened to miss, which is precisely the case that renders nothing
  today.

  Two further sources worth taking, in rough order of value:
  (a) the TRIGGERING message itself carries `msg.member` — a participant who
      just spoke can always be refreshed, independent of the fetch window;
  (b) Discord emits `guildMemberUpdate` on a role/nickname/colour change, which
      is the only signal that is actually event-driven rather than
      opportunistic. If bot-client subscribes, a role change refreshes the
      stored copy at the moment it happens rather than the next time that
      person is seen. Check the gateway intents before assuming it arrives.

  What must NOT happen: rendering a value that is known to be old differently
  from one that is fresh (that is a per-turn byte again), or dropping it on
  age.
- Ordering is already handled: ParticipantFormatter sorts by persona UUID, and
  extractGuildInfo sorts roles by position descending. Neither needs revisiting
  — the instability was presence, not order.

## COUPLING FOUND 2026-08-19 — TASK-660's blurbs make this cost MORE, and the ordering is why

Grounded during #2150's CI. The render order in ParticipantFormatter is humans
FIRST, then character entries. The S1 divergence this task fixes is a
`<guild_info>` flicker on a HUMAN participant — so it breaks the prefix
UPSTREAM of every character entry, and therefore upstream of every blurb byte
#2150 just added.

Consequence: each S1 miss now reprocesses the blurbs too. The bound is
ROSTER_BLURB_MAX_LENGTH (= DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH, 4000) times
MAX_ROSTER_CHARACTERS (10), so the worst case is tens of thousands of
newly-uncacheable characters, paid on the ~2-in-5 generations the prod
measurement showed diverging at S1.

The coupling is to the FLAG, not to the release. rosterBlurbEnabled ships
false, so nothing is paid until it flips. Stated as a gate rather than a
priority argument: this task need not precede the beta.205 CUT, but it should
precede rosterBlurbEnabled going true in PROD.

Size re-checked at the same time and the filed size:M holds — the owner's
persist decision is made, so what remains is a schema column, a write path, a
read into the render, and the anti-rot refresh. No design blocking.

## STORAGE GROUNDING 2026-08-19 (read-only, during #2151 CI) — the natural home is wrong twice, and the second reason is the load-bearing one

The owner decision above says "the natural home is alongside the persona row".
Checked both halves of that before anyone builds it, and it does not hold.

1. `personas` IS SYNC-TRACKED. It appears in `SyncTableName`, in the sync config
   map, and in `SYNC_TABLE_ORDER` (services/api-gateway/src/services/sync/config/syncTables.ts,
   lines 83 / 148 / 351). So the LWW hazard the decision anticipated is real,
   not hypothetical: a high-frequency guild-info stamp on that row bumps
   `updated_at` and hands this env the next dev/prod sync. `03-database.md`'s
   `$executeRaw` workaround would apply.

2. But the workaround should not be reached for, because the shape is wrong for
   an unrelated reason: GUILD INFO IS PER (PERSONA, GUILD), and a persona row
   has nowhere to put the guild. `guildMemberInfoSchema`
   (packages/common-types/src/types/schemas/discord.ts:85) is exactly `roles`,
   `displayColor`, `joinedAt` — every one of them guild-scoped, all read off
   `msg.member` in `extractGuildInfo`
   (services/bot-client/src/services/channelFetcher/ParticipantContextCollector.ts:21).
   A persona active in two guilds would clobber its own value on every turn,
   which is the same flicker one layer down.

   The per-turn map hides this legitimately — `Record<personaId, GuildMemberInfo>`
   is unambiguous because one prompt is one channel is one guild. Storage has no
   such context and must carry the key.

CONSEQUENCE — a NEW TABLE keyed (persona_id, guild_id), deliberately left OUT of
`SYNC_TABLE_ORDER`. That models the scoping correctly AND sidesteps the LWW rule
outright rather than working around it, so no `$executeRaw` special-casing is
needed. Excluding it from sync is defensible on its own terms: the value is a
cache of Discord state that either env can re-observe for itself, so syncing it
would propagate one env's staleness to the other.

THE SITES, end to end, so the build does not have to re-derive them:
- WRITE (opportunistic, per the write-through design): `extractGuildInfo` at
  ParticipantContextCollector.ts:21, called from DiscordChannelFetcher.ts:289
  behind the `&& msg.member` guard that is the flicker's proximate cause.
- WRITE (the always-available source the decision names as (a)): the triggering
  message's own member, which already ships as `rawActiveGuildMemberInfo`.
- READ: `ContextAssembler.ts:326-327` sets `participantGuildInfo` +
  `activePersonaGuildInfo` on the context; `MemoryRetriever.ts:490-508` picks
  between them per participant; `ParticipantFormatter.ts:295` renders.

  **MemoryRetriever's pick is the one place to add the persisted fallback** —
  it is already the single point that chooses which of the two live sources
  applies, so a third (stored) source slots in there without touching the
  renderer or the assembler. Anywhere else and the fallback has to be repeated.

OPEN, not resolved here: whether `guildId` is reachable at the ai-worker read
site. It is present on the raw envelope's environment, but that is a code-read
of the shape rather than a traced value — confirm before designing the query.

CARRIED FORWARD: the byte-equality acceptance test the owner decision states
(render the roster twice, guild map populated vs absent, assert identical
output) is unaffected by any of the above and remains the acceptance.
<!-- SECTION:DESCRIPTION:END -->
