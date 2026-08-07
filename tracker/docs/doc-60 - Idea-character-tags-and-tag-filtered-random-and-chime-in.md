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

## Open questions — owner calls, needed before design

1. **Whose tags are they?** A character can be used by people who did not create it. Are tags owner-authored metadata, like a description, or can any user tag characters for their own filtering? The first is a column or a simple join. The second is a per-user join table and a materially different feature.

2. **Is the namespace global or per-server?** Global matches how characters already work and is simpler. Per-server avoids one user's vocabulary leaking everywhere but invites tag squatting and needs a scope on every query.

3. **What does a tag matching more than 5 characters do to `/chime-in`?** The 5-at-a-time cap exists to prevent abuse (owner, stated to the requester). If a tag matches 12, does it sample 5, refuse and ask for a narrower tag, or something else? This is a UX call with an abuse dimension, not a technical one.

## Grounding already done

- `/random` and `/chime-in` live in bot-client; characters are personality rows behind api-gateway, so filtering belongs in a gateway query rather than a client-side filter over a fetched list.
- There is an existing autocomplete family in `bot-client/src/utils/autocomplete/` (`handlePersonalityAutocomplete`, `handlePersonaAutocomplete`). A tag autocomplete belongs beside those and should reuse `formatAutocompleteOption` for badge consistency.
- Rough shape, pending the answers above: schema plus a gateway filter endpoint, then tag CRUD on the character dashboard, then autocomplete, then the two command options. Two or three PRs.

## Not started

Owner call 2026-08-07: file it, do not drop backlog draining for it. No promote-when trigger — pick it up when the drain queue makes room or the request resurfaces.
