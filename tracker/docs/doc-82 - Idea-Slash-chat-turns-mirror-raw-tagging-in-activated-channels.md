---
id: doc-82
title: 'Idea: Slash chat turns mirror raw tagging in activated channels'
type: other
created_date: '2026-08-23 08:37'
---


Owner directive 2026-07-21 (Wave-3 smoke): `/chat`/`/random`/`/chime-in` should "behave as similarly as possible to regular tagging" — i.e. the channel's activated character replies to a slash turn too. Today the bot-authored echo is dropped by `BotMessageFilter`, so activation never fires: one reply instead of the raw-message two.

Needs scoping in the shared turn engine (`services/character/characterTurn.ts` in bot-client):

- Dedup when the invoked character IS the activated one (must not double-reply).
- Reply ordering between the invoked character's reply and the activated character's.
- A second model call per slash turn — spend implication worth stating at design time.

Behavior change only — no command-shape change, does NOT need a breaking batch. Routed from `backlog/now.md` › 📥 Untriaged 2026-08-23 (sat since 07-21; single feature needing scoping → idea doc per the granularity ladder).
