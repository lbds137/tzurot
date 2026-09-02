# Character-initiated messaging: prior art

> **Date**: 2026-09-02
> **Source**: Web research pass for tracker `doc-86` (the shapes.inc "free will" theme), owner-requested before any Phase 0 decision
> **Status**: Active

Every mechanism claim below is what the vendor or a third party PUBLISHES, not runtime observation. Closed-source products expose settings, not algorithms.

## TL;DR

Four products ship "the character messages first", and they are two different products sharing a name. The **DM companion model** (Nomi, Kindroid, Replika) is a background "while you were away" turn on a paced timer with back-off and quiet hours, opt-in per character, solo chats only. The **group-chat participant model** (shapes.inc) is a chat member deciding whether to jump in on chat events, configured per chat by whoever owns the chat. Only Nomi publishes a legible cadence design; nobody publishes a trigger algorithm; only Kindroid says who pays. Neither model depends on agentic tooling. Recommendation for Phase 0: v1 is the DM model with Nomi's cadence ladder.

## Key Findings

### What each product does

**shapes.inc "Free Will"** — per chat, under Chat Settings → AI Configurations, five independently toggled triggers, quoted verbatim from the current docs: "Reply when mentioned", "Keep the convo going", "React to keywords", "Always have something to say", "Come back later". Guidance: enable more triggers for active chats; keep only the mention trigger where the shape should wait to be summoned. The stated rationale (TechCrunch, April 2026) is group-chat liveness: people hesitate to send the first message, so the shape does. Mechanism, cost, and rate limits are not published. The Discord-era manual pages redirect-loop and could not be read. Discord mass-terminated Shapes-associated accounts in late 2023 and 2024 on self-botting and spam grounds, which is the cautionary half of this prior art.

**Nomi "Proactive Messages"** — opt-in per Nomi. Four tiers: Very Frequent (about 1 hour), Frequent (about 3 hours), Normal (about a day), Infrequent (about 4 days). If the user does not reply, the wait roughly doubles before the next message and keeps growing; on Infrequent it is one message until the user answers. Hard quiet hours, 10pm to 8am in the user's local time. "Not a strict timer" by design. Solo chats only. Content is framed as what the Nomi "has been thinking about or doing" over the ongoing context, explicitly unscripted. Notifications must be on to enable it.

**Kindroid "away proactive"** — context-aware initiation with a choice of text, voice message, selfie, or voice call; quiet hours apply to calls. Up to ten companions on "advanced proactivity", ON by default for a user's first companion. "Every X hours" intervals are approximate pacing, not a schedule. Proactive turns do not cost credits but are rate-limited by the system and by the user's own interaction. A third-party review places the feature on the top paid plan; unverified.

**Replika** — "proactive check-ins" driven by inferred mood from interaction frequency, tone, and past emotional trend, plus follow-ups days after a conversation. No published cadence; third-party descriptions only.

### How prior art answers doc-86's five Phase 0 questions

1. **Consent.** Every DM-model product is opt-in per character (Kindroid's default-on first companion is the exception). Shapes' consent lives with the chat owner, not the person being messaged: the wrong grain for DMs, the right one for an activated channel.
2. **Cadence and quiet hours.** Nomi's design is the one to copy: a small tier ladder, exponential back-off on silence, a hard local-time quiet window. Kindroid adds "approximate, not scheduled" as an explicit product value.
3. **Who pays.** Kindroid absorbs it and rate-limits. For tzurot the key model forces the split: BYOK turns bill the user's key; free-tier turns bill the owner and need a hard per-user daily cap before any rollout.
4. **Trigger.** Nobody publishes one. The DM products describe a background turn over ongoing context; Shapes' triggers are chat events. A timer plus back-off needs no new trigger machinery; chat-event triggers overlap with the activation and trigger processing tzurot already has for activated channels.
5. **Where.** DM products are solo-only. Shapes is group-native, and that is its whole pitch.

### The framing question: agentic features or its own thing

Two products. The DM model is a scheduled background turn with a pacing policy and needs none of doc-11's tool loop. The channel model is reactivity over chat events, closer to activated-channel behaviour than to agentic scaffolding. Both share the doc-12 telemetry gate for the same reason: unwatched spend.

### Discord-specific constraints to verify before Phase 1

- Bots can only DM users who share a server with the bot and have DMs open; `users.dmUndeliverableSince` already tracks bounced DMs and any scheduler must honour it.
- Discord's spam heuristics and DM rate limits for bots are not documented as numbers; treat unsolicited DM volume as a ban risk (the Shapes history is the evidence) and keep the ceiling low.
- Group-chat initiation would run through the existing channel activation and denylist gates.

## Actionable Items

- Tracker `doc-86` Phase 0: scope v1 to the DM model, copy Nomi's cadence ladder and quiet hours, opt-in per user per character, user's own key or a capped owner budget; leave the channel model until doc-75's moderator controls exist. Build gate unchanged (`backlog/cold/queue.md` Phase C).

## Sources

- https://docs.shapes.inc/shapeschatsguide (Free Will settings, verbatim names)
- https://techcrunch.com/2026/04/29/meet-shapes-the-app-bringing-humans-and-ai-into-the-same-group-chats/
- https://alon-alush.github.io/ai%20world/shapesinctermination/ (Discord terminations)
- https://nomi.ai/nomi-knowledge/proactive-messaging-when-your-nomi-messages-you-first/ (tiers, back-off, quiet hours)
- https://nomi.ai/updates/september-9th-update-proactive-messages/
- https://wiki.nomi.ai/When_Your_Nomi_Messages_You_First
- https://kindroid.ai/docs/article/chat-features-and-tools/ (page loaded only via search excerpts)
- https://companionwise.com/reviews/kindroid/ (third-party, plan-tier claim)
- https://www.eesel.ai/blog/replika-ai (third-party, Replika check-ins)
