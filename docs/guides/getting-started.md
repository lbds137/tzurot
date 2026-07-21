# Getting Started

Tzurot lets you talk to customizable AI characters in Discord — each with its
own personality, voice, and long-term memory. This guide covers your first
conversation through to making the bot your own. For the complete command
list, see the [command reference](https://tzurot.org/docs/commands) — and in
Discord itself, `/help getting-started` shows a condensed version of this
guide.

> Tzurot is for adults: chatting with characters requires confirming you are
> 18 or older. Everything below assumes the bot is in a server with you.

## Your first conversation

Characters respond when you talk to them:

- **@mention a character by name** anywhere the bot can see, and it replies in
  character. Replying to one of its messages continues the conversation.
- **Browse who's available** with `/character browse`.
- **Dedicated channels**: a moderator can run `/channel activate` to make a
  character respond to every message in a channel, no mention needed
  (`/channel deactivate` turns it off).

Multiple characters can share a channel and weigh in on the same
conversation.

## Make your own character

- `/character create` starts a new character; `/character edit` opens its
  dashboard, and `/character avatar set` sets its face.
- `/chat` talks to a character directly from any channel (`/random` picks
  one for you).
- Coming from elsewhere? `/character import` accepts a JSON export (and
  `/shapes import` migrates shapes.inc characters), while `/character export`
  and `/character template` get you portable JSON back out.

## Tell characters who _you_ are

A **persona** is how characters see you — your name and whatever you want
them to know about you. `/persona edit` fills yours out, `/persona create`
makes alternates, and `/persona override set` presents a different persona to
a specific character.

## Memory

Characters remember what matters across conversations, and the memory is
yours to inspect:

- `/memory browse` and `/memory search` show what a character remembers;
  `/memory facts` shows the specific facts it has learned about you — and
  lets you correct them.
- `/memory delete` and `/memory purge` remove memories outright.
- **Focus mode** (`/memory focus`) temporarily stops a character from
  _reading_ long-term memory; **incognito mode** (`/memory incognito`) stops
  it from _writing_ new memories, with a retroactive forget when you turn it
  off.
- `/history clear` resets the recent conversation (with undo).

## Voice

- **Talk to characters**: send a Discord voice message and it gets
  transcribed and answered like text.
- **Hear them back**: characters can reply with speech. `/character voice set`
  enrolls a cloned voice for a character from reference audio; `/voice`
  configures which text-to-speech and transcription providers are used and
  manages your cloned-voice library.
- Voice runs on self-hosted infrastructure by default — no key needed — or
  through Mistral / ElevenLabs with your own key.

## Models and keys

Out of the box you're on the **free tier**: a free AI model and self-hosted
voice, no setup. When you want more:

- `/settings apikey set` connects your own provider key (BYOK) — your usage,
  your account, access to 400+ models.
- `/models browse` shows what's available; `/preset create` builds reusable
  model + parameter presets, and `/preset override set` applies them
  per-character.

## Your data

- `/settings data export` packages everything your account owns into a ZIP
  (link lives 24 hours).
- `/settings data delete` permanently erases your account after a typed
  confirmation.
- `/notifications` controls release-notes DMs — they only ever go to people
  who have actually used the bot, and default to breaking-change releases
  only.
- The [privacy policy](https://tzurot.org/privacy) says exactly what is
  stored, for how long, and where it goes.

## Questions or problems

`/feedback` goes straight to the developer, and
[GitHub issues](https://github.com/lbds137/tzurot/issues) work too — the
whole project is open source.
