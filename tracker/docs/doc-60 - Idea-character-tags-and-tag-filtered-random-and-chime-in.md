---
id: doc-60
title: 'Idea: character tags, and tag-filtered /random and /chime-in'
type: other
created_date: '2026-08-07 11:20'
---

## Origin

A user asked (2026-08-07) whether server roles could be assigned to characters so that pinging the role would activate them, with every character sharing a role replying at once.

The owner declined the request as asked and named the reason: there is only one bot identity, so role-based addressing cannot work — a ping resolves to the bot, not to a character. The owner also noted the multi-character reply path is capped at 5 at a time to prevent abuse.

What the owner DID want, stated in the same reply: a tag system to group characters. This doc is that, not the role request.

## The idea

Let a character carry a list of tags. Expose tags through slash commands, and let the two commands that pick characters for you narrow their candidate pool by tag:

- `/random` — pick a random character carrying tag X rather than from everything.
- `/chime-in` — bring in characters carrying tag X.

Grouping is the point. The role request wanted "talk to this set of characters"; tags deliver that without needing per-character Discord identities.

## Open questions — ANSWERED (owner, 2026-08-09, AskUserQuestion batch)

1. **Whose tags are they?** → **Owner-authored.** Tags are metadata the character's creator sets, like the description — a column or simple join on the character, one authoritative taxonomy. Per-user tagging can layer on later if doc-67's sharing scopes need it; not in this build.

2. **Is the namespace global or per-server?** → **Global.** Matches how characters already work; no scope column on queries. Tag-word collisions across creators just widen the filter pool, which the 5-cap already bounds.

3. **What does a tag matching more than 5 characters do to `/chime-in`?** → **Sample the cap's worth at random, and say so in the reply** ("12 match, picked 5 at random"). The cap stands as the abuse bound; refusal was rejected as punishing big tags for no abuse benefit; repeated invocations naturally rotate the pool.

4. **The cap itself becomes admin-configurable** (owner addition, same day): the 5-at-a-time multi-character cap was picked arbitrarily and should be an admin setting, not a hardcoded constant — the tag sampling (and the existing multi-character reply path) reads the setting. Fold into this build's gateway/schema PR alongside the tag work.

## Grounding already done

- `/random` and `/chime-in` live in bot-client; characters are personality rows behind api-gateway, so filtering belongs in a gateway query rather than a client-side filter over a fetched list.
- There is an existing autocomplete family in `bot-client/src/utils/autocomplete/` (`handlePersonalityAutocomplete`, `handlePersonaAutocomplete`). A tag autocomplete belongs beside those and should reuse `formatAutocompleteOption` for badge consistency.
- Rough shape, pending the answers above: schema plus a gateway filter endpoint, then tag CRUD on the character dashboard, then autocomplete, then the two command options. Two or three PRs.

## Not started

Owner call 2026-08-07: file it, do not drop backlog draining for it. No promote-when trigger — pick it up when the drain queue makes room or the request resurfaces.
