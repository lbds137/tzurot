# Tzurot Privacy Policy

**Status: DRAFT — not yet in effect.** _Clauses marked ⏳ describe features that ship before this policy publishes._

_Last updated: (set at publication)_

Tzurot is a Discord bot that lets you talk with AI characters. It is operated by an individual developer ("the operator", "we"). This policy explains what data the bot stores, why, where it goes, and what control you have over it. It is written to describe what the software actually does — nothing more.

## What we collect and store

**Account basics.** Your Discord user ID, username, timezone (if you set one), your notification preferences, and whether you have completed the 18+ verification (a yes/no flag with a timestamp — we never ask for or store your birthdate or identity documents).

**Messages.** The content of messages in conversations the bot participates in, kept so characters can hold a coherent conversation. This includes message text, attachments' AI-generated descriptions, channel and server IDs, and reply context.

**Memories and facts.** The bot builds long-term memory for characters: conversation summaries and short factual statements extracted from what is said (for example, "this user's cat is named Miso"), stored with embeddings for retrieval. These are derived from your messages and are about you.

**Your creations.** Personas and characters you author, including their descriptions, avatar images, and voice-reference audio clips you upload for voice cloning. Avatar images are served from a public URL without authentication — Discord requires this for the bot to display them — so do not use an avatar image you would not want publicly reachable.

**API keys (BYOK).** If you connect your own AI-provider API key, it is encrypted at rest with AES-256-GCM (unique IV per encryption, authenticated tags) and used only to call that provider on your behalf. The same encryption applies to any external session credentials you supply for data imports.

**Usage records.** Per-request logs of provider, model, and token counts — kept to prevent infrastructure abuse, including for users on their own keys. No message content is in these records.

**Feedback.** If you submit feedback through the bot, its content is stored and a copy is posted to a private channel the operator reads.

**Diagnostic logs.** For 24 hours after each AI response, the bot keeps a "flight recorder" entry containing the full request context — your message, the assembled prompt (including character definition and retrieved memories), and the model's raw output — used to debug generation problems. You can view your own entries with `/inspect`; the operator can view all entries during that window. They are deleted automatically after 24 hours.

## Retention

| Data                                    | Kept for                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| Conversation history                    | 30 days (swept daily)                                       |
| Diagnostic logs                         | 24 hours (swept hourly)                                     |
| Data exports you request                | 24 hours, then deleted                                      |
| Memories and extracted facts            | Until you delete them                                       |
| Personas, characters, uploads           | Until you delete them                                       |
| Account basics, usage records, feedback | ⏳ Until you delete your account (see "Deleting your data") |

## Where your data goes (third parties)

Your conversation content is sent to AI providers to generate responses. Which provider depends on your configuration:

- **OpenRouter** — the primary AI provider. Receives the assembled conversation context (character definition, recent history, retrieved memories, your message, and any images) for every response it generates.
- **z.ai** — powers the shared free tier. Receives the same class of conversation context when a free-tier model generates the response.
- **Mistral / ElevenLabs** — optional voice providers, used only if you connect your own key. They receive the character's response text for speech synthesis (and, for Mistral transcription, your voice-message audio; ElevenLabs also receives voice-reference audio for cloning).
- **Self-hosted voice engine** — the default voice pipeline runs on our own infrastructure, not a third party: your voice messages are transcribed and response audio is synthesized there.
- **shapes.inc** — contacted only if you explicitly run an import/export of your own shapes.inc data, using credentials you supply.
- **Railway** — hosts the bot's services and databases. All stored data described above lives there.

Each provider processes data under its own privacy policy. We attach no analytics, telemetry, or advertising services — none exist in the codebase.

We never sell your data.

## Your controls

- **Memory**: browse, search, correct, and forget individual memories and facts (`/memory`); batch-delete or purge a character's memories; **focus mode** stops memory reads; **incognito mode** stops memory writes for a session, with retroactive forget.
- **History**: clear or reset your conversation history (`/history`).
- **Notifications**: release announcements are opt-out (`/notifications disable`, or pick a level).
- **Keys**: remove a connected API key at any time (immediate hard delete).
- **Creations**: delete your personas and characters (deletion cascades to their conversation history and memories).
- ⏳ **Export everything**: a command to export all data associated with your account in a portable format.
- ⏳ **Delete everything**: a command to permanently erase all data associated with your account, with an explicit confirmation step. Until this ships, deletion is per-resource as listed above; you can also contact the operator to request removal of anything without a self-serve path.

## Age requirement

Tzurot is for adults. Chatting with characters requires confirming you are 18 or older (verification is automatic in Discord age-restricted channels). Do not use the bot if you are under 18.

## Security

Secrets (API keys, credentials) are encrypted at rest as described above. Service-to-service traffic is authenticated. Access to production data is limited to the operator. No system is perfectly secure; use the incognito and memory controls for anything you'd rather not have stored.

## Changes

Material changes to this policy will be announced through the bot's release-notes channel (the same opt-out DM system described above) and reflected in the "last updated" date.

## Contact

Questions or data requests: contact the operator on Discord — **(operator contact / support server link to be set at publication)**.
