---
id: doc-50
title: >-
  Idea: Deliberate character co-ownership — invite / accept / revoke (owner
  directive 2026-07-25)
type: other
created_date: '2026-07-28 11:11'
---

## Deliberate character co-ownership — invite / accept / revoke (owner directive 2026-07-25)

Owner wants shared ownership to be a real concept: _"we honestly need to allow for multiple character owners."_ Scoped OUT of retention PR-D by the same owner call — PR-D ships only the machinery both need (role-aware readers + the orphan role); the user-facing feature lands on top, so a data-minimization epic isn't gated on a feature design.

**Most of the model already exists and is dormant.** `PersonalityOwner` is a `(personalityId, userId)` junction carrying `role String @default("owner")`. Its only writer is `ai-worker/src/jobs/ShapesImportHelpers.ts:47`, which inserts `userId === ownerId` — a self-duplicate of `personality.ownerId`, so **no genuine co-owner row exists anywhere in the system**. Every reader tests row *existence* and ignores `role`. That dormancy is why the table can be given real semantics without a migration to a new model, and also why nothing today exercises the paths a real co-owner would take.

**What the feature has to decide** (none of it settled): who may invite; whether the invitee accepts or is added unilaterally; what a co-owner may change (definition? avatar? aliases? delete?); whether co-owners can invite further co-owners; revocation, and what happens to the ex-co-owner's conversations; and whether a co-owned character appears in the co-owner's data export as their content (it plausibly should — unlike the retention-orphan case, where it must not).

**Two things it must land with:**

1. **The five `PersonalityOwner` readers become role-aware together**, or the grant means different things in different places: `routes/user/personality/helpers.ts:69` (`canUserEditPersonality`) and `:115` (`canUserViewPersonality`), `personality/list.ts:97`, `personality/get.ts:44`, and `ai-worker/src/jobs/AccountExportAssembler.ts:236` (the export sweep — the one that decides whether a grant puts another person's authored character into your export).

   **And a sixth site that is not a `PersonalityOwner` reader at all — which is exactly why it is the easiest to miss.** `PersonalityLoader.buildAccessFilter` (`packages/identity/src/personality/PersonalityLoader.ts:97`) is the runtime gate on every message-path personality load, and it is `{ OR: [{ isPublic: true }, { ownerId: ownerUuid }] }` — it never consults the junction. So a co-ownership grant built only against the route guards would appear in browse, pass every permission check, show `canEdit: true`… and then the character would silently not respond to the co-owner in a channel or DM. **The junction currently confers no ability to talk to a character.** Any co-ownership feature has to add an arm here, and this is the site that decides whether the feature works at all rather than merely how it displays.
2. **The DTO must stop lying.** `computePersonalityPermissions` derives `canEdit` from `personality.ownerId` alone and never consults the junction, while the route guard does. Inert only because no real co-owner rows exist — which is exactly what this feature creates. `EntityPermissions` is `{ canEdit, canDelete }` with no `canView`; extending it is part of the work.

**Related, and it trips on this feature's first real write**: the reach-widening tracker task — `partitionOwnedByReach` doesn't consult `PersonalityOwner`, so a character shared purely by grant (no memories/history/facts from the co-owner) would be **deleted** by a retention purge rather than re-homed, silently revoking an active co-owner. Provably unreachable today for the dormancy reason above; this feature is what makes it reachable, so the widening ships here if PR-D hasn't already taken it.

**Promote when**: retention Phase 2 completes (PR-D ships the role-aware readers this builds on), or sooner if the owner wants it ahead of retention. Authoritative permission-surface grounding lives in [`inactivity-retention-purge-phase2.md`](../../docs/proposals/backlog/inactivity-retention-purge-phase2.md) D11. **Prerequisite**: the visibility tiers below — co-ownership is the *grant* mechanism, tiers are the *visibility* model, and "shared with specific people" is where they meet.

## Superseded tasks (2026-09-04 pass)

**TASK-350** — *Co-ownership: confirm grant-arm semantics in the delete warning* (filed 2026-07, was state:dependent size:S). Absorbed here because the decision it asks for is part of this feature's design, not a standalone row: it is inert today for exactly the dormancy reason this doc opens with, and it becomes decidable only once real grants exist. It carried a recorded owner disposition of *keep filed* rather than a pending decision, so nothing is being re-opened by moving it — the question simply moves to where it will be answered. It belongs to § What the feature has to decide, as a fifth item:

- **Should "granted but never touched" count as an affected user in the self-serve DELETE WARNING?** `countCrossUserReach` counts a user the moment a `personality_owners` grant row exists, activity or not. That is correct for the retention re-home call — erring toward re-homing is safe — but the delete warning is a different product surface, and the same counting rule reads differently there: it tells the deleter that someone is affected who may never have interacted with the character at all. Inert today because the sole writer inserts owner self-duplicates, which the inequality filters out. Surfaced by the #1847 round-3 review; the reach module's own doc comment flags the same seam. **Promote when**: real co-ownership grants ship — i.e. this feature — so fold it into the design rather than answering it in isolation.

