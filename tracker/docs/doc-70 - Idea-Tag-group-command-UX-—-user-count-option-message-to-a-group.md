---
id: doc-70
title: 'Idea: Tag-group command UX — user count option + message-to-a-group'
type: other
created_date: '2026-08-10 01:20'
---

_Origin: owner musing 2026-08-09, right after doc-60 shipped (#2032/#2033/#2034), before the tag smoke ran. Two gaps in the tag-command surface, filed together because the second's answer may absorb the first._

## Current state (verified against shipped code, 2026-08-09)

| Surface | Carries a message? | Who responds |
| --- | --- | --- |
| multi-mention message | yes | the mentioned set, up to the admin cap |
| `/random tag:` | optional | exactly ONE, sampled from the tag pool — the admin cap never applies to /random |
| `/chime-in tag:` | no (weigh-in semantics) | min(pool, admin cap), sampled |

Standing misconception to keep out of the design: /random cannot reach a whole
group under any cap/pool configuration. The only multi-character message today
is explicit multi-mention.

## Gap 1 — user `count` option on `/chime-in tag:` (near-decision-complete, S)

`/chime-in tag:fantasy count:2` → sample `min(count, adminCap)` instead of the
full admin cap. The admin cap stays the ceiling; the user value is a preference
below it. Notice wording adjusts ("picked 2 of 12"). No new machinery — one
option, a clamp in `runTagChimeIn`, tests. Shippable standalone; small risk the
Gap-2 design later unifies the surface and moves it.

(Deliberately NOT proposing count on /random — its identity is pick-one.)

## Gap 2 — message to a tag group (needs a council pass before plan-mode)

There is no way to send a MESSAGE to a tag group. Three candidate shapes, each
with a real cost:

- **message option on /chime-in** — collides with chime-in's deliberate
  identity: weigh-in = anonymous, no persona attachment, no LTM read/write
  (documented in `chime-in/index.ts` header). A message implies full chat
  semantics; grafting it changes what the command IS.
- **fan-out on /random (count > 1)** — collides with /random's pick-one
  identity and silently imports the cap question into a command the cap
  currently never touches.
- **new command (e.g. /group)** — clean identities, but grows the top-level
  command surface; needs naming + discoverability thought.

Design considerations the council pass must weigh: N full chat responses = N
model calls billed + N memory/persona interactions per invocation (chime-in's
fan-out dodges this via weigh-in anonymity — a message fan-out cannot);
completion-order delivery precedent (chimeInTag.ts header) vs. expectations for
a "conversation"; notice/transparency (the 🎲 notice is currently ephemeral,
invoker-only); interaction with doc-67 (tag-scoped sharing) which consumes the
same tag substrate later.

## Promote when

Owner asks for it, or the tag smoke + early real usage shows demand for
group-directed messages. Gap 1 may promote alone as a quick-win task without
waiting for Gap 2's council pass.
