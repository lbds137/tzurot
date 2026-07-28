---
id: doc-51
title: >-
  Idea: Character visibility tiers — private / shared-with-specific-people /
  unlisted / public (owner directive 2026-07-25)
type: other
created_date: '2026-07-28 11:11'
---

## Character visibility tiers — private / shared-with-specific-people / unlisted / public (owner directive 2026-07-25)

Today visibility is **binary**: `personalities.isPublic`. Public means anyone can talk to it and it appears in browse; private means only the creator and the bot owner. The runtime gate is a single predicate — `PersonalityLoader.buildAccessFilter` returns `{ OR: [{ isPublic: true }, { ownerId: ownerUuid }] }` — so there is no third state anywhere in the system.

Owner wants the social-media ladder instead: _"fully private where you're the only person who sees it. Then private plus any specific people you invite. And then unlisted, where if you know the link you can access it, but it's not publicly searchable."_ Mapped onto this codebase:

| Tier | Can talk to it | Appears in public browse / random-pick |
| --- | --- | --- |
| **private** | owner (+ bot owner) | no |
| **shared** | owner + explicitly granted users | no |
| **unlisted** | anyone who knows the exact name/slug/alias | no |
| **public** | anyone | yes |

**Why it's more than a column rename.** `isPublic` is doing two different jobs today — *who may talk to it* and *who may see it in a list* — and the tiers split those apart. `unlisted` is precisely "talkable but not listable," which no current code can express: `buildAccessFilter` decides talkability, while `list.ts:91` (`where: { isPublic: true }`) and `randomPick.ts:81` decide listability, and both read the same flag. Expect a boolean→enum migration plus an audit of every `isPublic` consumer, splitting each into the talk question or the list question.

**Adjacent decisions this unlocks or touches:**

- **Co-ownership** (section above) is the natural grant mechanism for the `shared` tier — build the tiers first, or design them together, but don't ship `shared` without deciding which one owns the grant list.
- **Retention orphans**: the whole D11 accessibility question dissolved *because* only two tiers exist (a private character can't have live cross-user reach). Adding `shared` re-opens it — a shared character CAN have reach-holders who lose access when the owner is purged. **Whoever builds tiers must re-read D11's retraction**, because its reasoning is explicitly conditioned on the current binary model.
- The once-public-now-private over-retention tracker task gets more shapes to consider.

**Promote when**: the owner wants it (it is a user-facing feature with no forcing trigger), or when co-ownership is scheduled — whichever comes first. Not a retention prerequisite; retention Phase 2 is correct as-is under the binary model.

