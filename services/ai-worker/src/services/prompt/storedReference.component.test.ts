/**
 * Component test: a built reference SURVIVES the database.
 *
 * This is the one test shape that could have caught the bug this module exists
 * to fix. The write half had been inert for weeks — it patched a metadata field
 * nothing populated, so it stored nothing — and no field-parity or shape test
 * can see that, because every one of them asserts on an object someone handed
 * it. Only a round trip notices that nobody wrote anything down.
 *
 * So: build a reference the way the formatter does → store it → read it back
 * through the REAL read path → render it → look for the sentinels. Two of them,
 * an image description and a voice transcript, because those are two different
 * kinds of paid work and until now only one of them had anywhere to live.
 *
 * The read path matters as much as the write. `parseMessageMetadata` Zod-parses
 * every row on the way out in STRIP mode, so a field the schema doesn't declare
 * is deleted silently between the INSERT and the renderer. Going through
 * `getChannelHistoryWindow` rather than reading the JSONB column directly is what
 * makes this test able to fail for that reason.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import {
  ConversationHistoryService,
  getChannelHistoryWindow,
  writeTriggerReferences,
} from '@tzurot/conversation-history';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { type RawHistoryEntry } from '../../jobs/utils/conversationTypes.js';
import { formatQuotedSection } from '../../jobs/utils/xmlMetadataFormatters.js';
import { type BuiltAttachment } from './QuoteFormatter.js';
import { toStoredReference } from './storedReference.js';

const USER = '7c1c0f66-0000-4000-8000-00000000d001';
const PERSONA = '7c1c0f66-0000-4000-8000-00000000d002';
const PERSONALITY = '7c1c0f66-0000-4000-8000-00000000d003';
const SYSTEM_PROMPT = '7c1c0f66-0000-4000-8000-00000000d004';
const CHANNEL = '900000000000000901';
/** The trigger row's identity, as the reference write asks for it. */
const SCOPE = { channelId: CHANNEL, personalityId: PERSONALITY, personaId: PERSONA };
const TRIGGER_MESSAGE = '900000000000000902';

const IMAGE_URL = 'https://cdn.discord.com/attachments/1/2/whiteboard.png';
const VOICE_URL = 'https://cdn.discord.com/attachments/1/3/note.ogg';
const IMAGE_SENTINEL = 'SENTINEL_A_WHITEBOARD_COVERED_IN_EQUATIONS';
const VOICE_SENTINEL = 'SENTINEL_MEET_ME_AT_SEVEN_BY_THE_FOUNTAIN';

/** A reply quoting one image and one voice note. */
function liveReference(): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: '900000000000000903',
    discordUserId: '900000000000000904',
    authorUsername: 'alice',
    authorDisplayName: 'Alice',
    authorRole: 'user',
    content: 'have a look at these',
    embeds: '',
    timestamp: '2026-07-31T12:00:00.000Z',
    locationContext: '<location server="Test" channel="general"/>',
    attachments: [
      { url: IMAGE_URL, contentType: 'image/png', name: 'whiteboard.png' },
      {
        url: VOICE_URL,
        contentType: 'audio/ogg',
        name: 'note.ogg',
        isVoiceMessage: true,
        duration: 7,
      },
    ],
  };
}

/** What the renderer emitted for that reference — vision and STT already paid. */
function builtAttachments(): BuiltAttachment[] {
  return [
    {
      url: IMAGE_URL,
      attachment: {
        kind: 'image',
        filename: 'whiteboard.png',
        contentType: 'image/png',
        description: IMAGE_SENTINEL,
      },
    },
    {
      url: VOICE_URL,
      attachment: {
        kind: 'voice',
        filename: 'note.ogg',
        contentType: 'audio/ogg',
        durationSeconds: 7,
        description: VOICE_SENTINEL,
      },
    },
  ];
}

describe('built references survive the round trip (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let history: ConversationHistoryService;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER,
      personaId: PERSONA,
      discordId: '900000000000000905',
      username: 'refuser',
      personaName: 'Ref Persona',
      personaContent: 'The round-trip persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'Ref Prompt', 'You are a quoting bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY}::uuid, 'RefBot', 'Ref Bot', 'refbot', ${SYSTEM_PROMPT}::uuid, 'Quotes things', 'Attentive', ${USER}::uuid, NOW())
    `;

    history = new ConversationHistoryService(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM conversation_history`;
    await history.addMessage({
      channelId: CHANNEL,
      guildId: null,
      personalityId: PERSONALITY,
      personaId: PERSONA,
      role: MessageRole.User,
      content: 'what do you make of these?',
      discordMessageId: TRIGGER_MESSAGE,
    });
  });

  /**
   * Read the trigger row back the way generation does, and render its quotes.
   *
   * `dedupId` puts that message in the chat log, which is what makes the quote
   * render as a stub. `chatLogCarries` is what the chat-log ENTRY for it renders
   * on its own — the second question, and the one that decides whether the stub
   * repeating its media would be a duplicate.
   */
  async function replayQuotes(
    dedupId?: string,
    chatLogCarries?: RawHistoryEntry['messageMetadata']
  ): Promise<string> {
    const rows = (await getChannelHistoryWindow(prisma, { channelId: CHANNEL, cap: 10 })).messages;
    const trigger = rows.find(row => row.role === MessageRole.User);
    expect(trigger).toBeDefined();
    return formatQuotedSection({
      // ConversationMessage → RawHistoryEntry is a structural widening; the
      // metadata object is the same one `parseMessageMetadata` produced.
      msg: {
        role: 'user',
        content: trigger?.content ?? '',
        messageMetadata: trigger?.messageMetadata,
      },
      normalizedRole: 'user',
      personalityName: 'Ref Bot',
      historyEntries:
        dedupId === undefined
          ? undefined
          : new Map([
              [
                dedupId,
                {
                  role: 'user',
                  content: '',
                  discordMessageId: [dedupId],
                  messageMetadata: chatLogCarries,
                },
              ],
            ]),
      allPersonalityNames: undefined,
      responderPersonalityId: undefined,
    });
  }

  it('replays the image description and the voice transcript it was built with', async () => {
    const stored = toStoredReference(liveReference(), builtAttachments());

    const written = await writeTriggerReferences(prisma, SCOPE, [stored], TRIGGER_MESSAGE);
    expect(written).toBe(1);

    const rendered = await replayQuotes();

    // The image half — the one that used to expire with a one-hour cache entry.
    expect(rendered).toContain(IMAGE_SENTINEL);
    expect(rendered).toContain('<image filename="whiteboard.png"');
    // The voice half — which had no persisted home at all, at any TTL.
    expect(rendered).toContain(VOICE_SENTINEL);
    expect(rendered).toContain('<voice filename="note.ogg"');
    // And neither renders as an absence.
    expect(rendered).not.toContain('status="undescribed"');
    expect(rendered).not.toContain('status="untranscribed"');
  });

  it('carries both across the DEDUPED replay arm too', async () => {
    // The stub subtracts the reference's TEXT because the chat log already has
    // it. Here the chat-log entry carries no enrichment of its own, so the media
    // has no second copy and must ride along. This arm is where enrichment kept
    // getting dropped, twice, under green coverage.
    const stored = toStoredReference(liveReference(), builtAttachments());
    await writeTriggerReferences(prisma, SCOPE, [stored], TRIGGER_MESSAGE);

    const rendered = await replayQuotes(stored.discordMessageId);

    expect(rendered).toContain('full text in the chat log');
    expect(rendered).toContain(IMAGE_SENTINEL);
    expect(rendered).toContain(VOICE_SENTINEL);
    expect(rendered).toContain('its media is described here');
  });

  it('does NOT repeat media the chat-log entry already renders', async () => {
    // The inverse arm, and the reason the subtraction is derived rather than
    // decided once: when the referenced message was ITSELF a trigger, its own
    // history entry renders <image_descriptions>/<voice_transcripts>, so the
    // stub repeating them prints the same paid text twice in one prompt.
    const stored = toStoredReference(liveReference(), builtAttachments());
    await writeTriggerReferences(prisma, SCOPE, [stored], TRIGGER_MESSAGE);

    const rendered = await replayQuotes(stored.discordMessageId, {
      imageDescriptions: [{ filename: 'whiteboard.png', description: IMAGE_SENTINEL }],
      voiceTranscripts: [VOICE_SENTINEL],
    });

    // Still a stub pointing at the chat log...
    expect(rendered).toContain('full text in the chat log');
    // ...but it no longer promises media it is not carrying, and does not
    // reprint what the chat log renders one element away.
    expect(rendered).not.toContain('its media is described here');
    expect(rendered).not.toContain(IMAGE_SENTINEL);
    expect(rendered).not.toContain(VOICE_SENTINEL);
  });

  it('anchors an image-only stub whose media the chat-log entry renders', async () => {
    // The stored/replay twin of the live-path image-only case: no text to
    // preview AND the subtraction takes every description, so the stub must
    // fall back to previewing the first pre-subtraction enrichment and point
    // at the chat log for the rest. The subtraction set here is built by
    // chatLogEnrichmentFor from messageMetadata — a different producer than
    // the live path's carriedByChatLog map, which is why this arm gets its
    // own test.
    const stored = toStoredReference({ ...liveReference(), content: '' }, builtAttachments());
    await writeTriggerReferences(prisma, SCOPE, [stored], TRIGGER_MESSAGE);

    const rendered = await replayQuotes(stored.discordMessageId, {
      imageDescriptions: [{ filename: 'whiteboard.png', description: IMAGE_SENTINEL }],
      voiceTranscripts: [VOICE_SENTINEL],
    });

    expect(rendered).toContain('described in full in the chat log');
    // The FIRST enrichment rides as the anchor preview...
    expect(rendered).toContain(IMAGE_SENTINEL);
    // ...and only the first — the preview is an anchor, not a copy.
    expect(rendered).not.toContain(VOICE_SENTINEL);
    expect(rendered).not.toContain('its media is described here');
    expect(rendered).not.toContain('full text in the chat log');
  });

  it('renders an absence, not an invention, when nothing was ever computed', async () => {
    // Absence has to stay retryable-shaped: an attachment with no enrichment
    // says so, rather than quietly rendering as though it had none to give.
    const stored = toStoredReference(liveReference(), [
      { url: IMAGE_URL, attachment: { kind: 'image', filename: 'whiteboard.png' } },
      { url: VOICE_URL, attachment: { kind: 'voice', filename: 'note.ogg', durationSeconds: 7 } },
    ]);
    expect(stored.attachmentEnrichment).toBeUndefined();

    await writeTriggerReferences(prisma, SCOPE, [stored], TRIGGER_MESSAGE);

    const rendered = await replayQuotes();
    expect(rendered).toContain('status="undescribed"');
    expect(rendered).toContain('status="untranscribed"');
  });
});
