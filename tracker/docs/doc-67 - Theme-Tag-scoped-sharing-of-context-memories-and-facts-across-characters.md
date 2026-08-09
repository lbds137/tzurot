---
id: doc-67
title: 'Theme: Tag-scoped sharing of context, memories, and facts across characters'
type: other
created_date: '2026-08-09 17:45'
---

_Focus: unify the scattered cross-character sharing mechanisms (cross-channel history sharing, all-characters long-term-memory sharing, facts) into ONE reusable scoping mechanism with three levels — off / all characters / scoped to a user-defined set of character tags._

Owner directive (2026-08-09, dictated — the recurring itch: "this is something that keeps occurring to me over the past few days on a regular basis"): cross-channel history sharing exists but only within the SAME character; long-term memory sharing across ALL characters exists as a toggle; facts have their own story. The owner wants both concepts refined into one granular, reusable mechanism: "being able to selectively share long term memories and short term context using the same mechanism, reused in both places, where it can either be off, so there is no sharing, or it is on for all characters like we currently have, or it is scoped granularly for a specific user defined set of tags." And the north star, verbatim: "I want to be able to have a bit of a pantheon of characters that follow me around, and I can tag any of them whenever and have them pick up on the context of whatever I was talking about."

**The lived pain**: "sometimes it's frustrating because I just talked about something with a different character, but I want to solicit another character's opinion on it. But I can't do that unless I'm in the exact same channel where the original conversation took place."

### The mechanism sketch

- **One scoping enum, three data planes.** A sharing scope — `off` / `all` / `tags:<user-defined set>` — applied independently (or together; design call) to: short-term conversational context (history), long-term memories, and facts. Same concept, same UX, same storage shape in all three places.
- **Tags are doc-60's substrate.** The character-tag system (doc-60: owner-authored tags on character cards, comma-delimited list) is the vocabulary; this theme consumes it for scope definitions. Examples from the owner: a trait tag (Charlie tagged `bisexual` — a pool of characters sharing a trait), a franchise tag (`hazbin-hotel`), an umbrella tag (`hellaverse` covering both Hazbin Hotel and Helluva Boss — the Vivienne Medrano shows). (Transcription in the source ramble garbled these; corrected here.)
- **Per-USER configuration.** The pantheon follows the user — sharing scope is the user's own setting over their own conversations/memories, never a global character property, and never a channel for cross-user leakage. Conservative defaults stay: sharing off, because it is not what users expect by default (the reason cross-channel history sharing ships disabled today).

### Constraints (owner-stated)

- Granular control ("I'm a bit of a control freak") AND explainable to non-power-users: "user friendly and able to be understood and explained in a way that might be useful to people besides myself." The three-level scope is itself the explainability device — off / everywhere / just-these-groups.
- Complexity honestly acknowledged: "it's a little bit complex and messy" — the design phase should hunt for the simplest shape that still delivers the pantheon UX.

### Epic placement — open call

The owner explicitly left this open: "I don't know if this is part of the tagging epic itself or if it would go under a subsequent or sibling epic." Filed as a sibling theme: doc-60 (tags + tag-filtered /random and /chime-in) is the substrate and is independently shippable; this theme is the second consumer of tags and should sequence AFTER doc-60's tag storage exists. Decide the packaging (one epic with phases vs. two) at promotion time. doc-60's open question 1 (owner-authored vs per-user tags) becomes load-bearing here: scope SETS are per-user selections, but whether the underlying tags are creator-authored metadata or user-taggable is doc-60's call and shapes this design.

### Relations

- doc-60 — the tag substrate + first consumers; sequence dependency.
- doc-8 (Memory System Overhaul, PARKED) — memory-plane sharing semantics should be designed compatibly with that epic's retrieval model if it un-parks.
- Existing mechanisms to generalize (grounding at design time): cross-channel history sharing setting (same-character, off by default), the all-characters LTM sharing toggle, fact retrieval scoping.
