/**
 * Seam test: history enrichment → live reference render.
 *
 * These two steps run back-to-back in `ConversationalRAGService.generateResponse`
 * and they do not call each other — they communicate by writing and reading a
 * field on a shared mutable object (`context.rawConversationHistory`). Per
 * `02-code-standards.md` § "A shared mutable context is a seam too", that is a
 * seam with no mock in it: enrichment's unit tests build the history themselves,
 * and the formatter's unit tests build the carried-enrichment set themselves, so
 * neither can observe what the other actually produced.
 *
 * The bug this pins was exactly that. The render ran FIRST, so at stub-build
 * time `imageDescriptions` was still unpopulated, the subtraction set was empty,
 * and one quoted image's 1374-character vision description was printed twice in
 * one prompt — once inside <contextual_references>, once inside <chat_log>.
 * Every unit test on both sides passed throughout.
 *
 * Only the paid boundary (vision/transcription) and the persona lookup are
 * mocked; the enrichment write, the id matching, the enrichment-key derivation
 * and the stub projection all run for real, in order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { ConversationInputProcessor } from './ConversationInputProcessor.js';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import { enrichRagHistory } from './multimodal/ragVisionAuth.js';
import type { ConversationContext } from './ConversationalRAGTypes.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type { PromptBuilder } from './PromptBuilder.js';

// THE paid boundary — the only computation mocked. Nothing in these cases
// should reach it: every description arrives pre-computed from the dependency
// stage, which is what the production deduped path relies on.
const mockProcessAttachments = vi.fn();
const mockDescribeImage = vi.fn();
const mockTranscribeAudio = vi.fn();
vi.mock('./MultimodalProcessor.js', () => ({
  processAttachments: (...args: unknown[]) => mockProcessAttachments(...args),
  describeImage: (...args: unknown[]) => mockDescribeImage(...args),
  transcribeAudio: (...args: unknown[]) => mockTranscribeAudio(...args),
  deriveApiKeySource: (): 'system' => 'system',
}));

// The persona-hydration database seam (and the module that would otherwise
// construct a Redis client at import time).
vi.mock('./reference/BatchResolvers.js', () => ({
  batchResolveByDiscordIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../redis.js', () => ({
  visionDescriptionCache: { get: vi.fn().mockResolvedValue(null) },
}));

const VISION_SENTINEL = 'SENTINEL_SEAM_VISION_4c17fe: a tabby asleep on a keyboard';
const QUOTED_MESSAGE_ID = 'quoted-msg-77';
const IMAGE_URL = 'https://cdn.discordapp.com/attachments/1/2/cat.png';

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-1',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  ownerId: 'owner-uuid-test',
  systemPrompt: 'x',
  model: 'test-model',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 131072,
  characterInfo: 'x',
  personalityTraits: 'x',
  voiceEnabled: false,
};

/** The vision result the dependency stage produces for the quoted message. */
function extendedContextImage(): ProcessedAttachment {
  return {
    type: AttachmentType.Image,
    description: VISION_SENTINEL,
    originalUrl: IMAGE_URL,
    metadata: {
      url: IMAGE_URL,
      name: 'cat.png',
      contentType: 'image/png',
      size: 1000,
      // The correlation key enrichment injects on: this description belongs to
      // the history entry for the quoted message.
      sourceDiscordMessageId: QUOTED_MESSAGE_ID,
    },
  };
}

/** The SAME description, reaching the reference render as preprocessing. */
const preprocessedForReference: Record<number, ProcessedAttachment[]> = {
  1: [extendedContextImage()],
};

/** A reply to a message that is also in history → the enricher flags it deduped. */
function dedupedReference(): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: QUOTED_MESSAGE_ID,
    discordUserId: 'user-1',
    authorUsername: 'testuser',
    authorDisplayName: 'Test User',
    content: 'look at my cat',
    embeds: '',
    timestamp: '2025-12-06T00:00:00Z',
    locationContext: '',
    isDeduplicated: true,
  };
}

function contextWithQuotedMessageInHistory(
  overrides: Partial<ConversationContext> = {}
): ConversationContext {
  return {
    userId: 'user-1',
    channelId: 'channel-1',
    referencedMessages: [dedupedReference()],
    rawConversationHistory: [
      {
        id: 'db-row-uuid-1',
        discordMessageId: [QUOTED_MESSAGE_ID],
        role: 'user',
        content: 'look at my cat',
      },
    ],
    ...overrides,
  };
}

describe('live deduped stubs subtract what history enrichment just wrote', () => {
  let processor: ConversationInputProcessor;
  const prisma = {} as unknown as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessAttachments.mockResolvedValue([]);

    // Not part of this seam: a stub keeps the assertions on the reference XML.
    const promptBuilder = {
      formatUserMessage: vi.fn().mockReturnValue('formatted user message'),
      buildSearchQuery: vi.fn().mockReturnValue('search query'),
    } as unknown as PromptBuilder;

    processor = new ConversationInputProcessor(
      promptBuilder,
      new ReferencedMessageFormatter(prisma)
    );
  });

  /** The production order: enrich history, THEN render the references. */
  async function runInProductionOrder(
    context: ConversationContext
  ): Promise<{ referencedMessagesDescriptions?: string }> {
    await enrichRagHistory({
      prisma,
      context,
      personality: TEST_PERSONALITY,
      visionAuth: {},
      isGuestMode: true,
    });
    return processor.processInputs(TEST_PERSONALITY, 'what breed is that', context, {
      isGuestMode: true,
    });
  }

  it('renders the vision description once: in the chat log, not in the quote', async () => {
    const context = contextWithQuotedMessageInHistory({
      preprocessedExtendedContextAttachments: [extendedContextImage()],
      preprocessedReferenceAttachments: preprocessedForReference,
    });

    const { referencedMessagesDescriptions } = await runInProductionOrder(context);

    // The stub defers to the chat log…
    expect(referencedMessagesDescriptions).not.toContain(VISION_SENTINEL);
    expect(referencedMessagesDescriptions).toContain(
      '[Referenced message — full text in the chat log]'
    );
    expect(referencedMessagesDescriptions).not.toContain('its media is described here');

    // …and the chat log's own copy is still there to defer TO. Asserting the
    // entry's data rather than a second render: this is the write the reference
    // render read, and losing it would make the subtraction a deletion.
    expect(context.rawConversationHistory?.[0].messageMetadata?.imageDescriptions).toEqual([
      { filename: 'cat.png', description: VISION_SENTINEL },
    ]);

    // No new spend bought either copy.
    expect(mockDescribeImage).not.toHaveBeenCalled();
  });

  it('keeps the description in the quote when history carries nothing for it', async () => {
    // The inverse, and the reason subtraction cannot be unconditional: with no
    // extended-context enrichment, <chat_log> renders that message as text
    // only, so the stub is the ONLY place its image is described.
    const context = contextWithQuotedMessageInHistory({
      preprocessedReferenceAttachments: preprocessedForReference,
    });

    const { referencedMessagesDescriptions } = await runInProductionOrder(context);

    expect(referencedMessagesDescriptions).toContain(VISION_SENTINEL);
    expect(referencedMessagesDescriptions).toContain('its media is described here');
    expect(context.rawConversationHistory?.[0].messageMetadata?.imageDescriptions).toBeUndefined();
  });

  it('keeps the description when the quoted message is not the enriched one', async () => {
    // Enrichment landed on a DIFFERENT history entry. The subtraction is
    // per-reference, so a description belonging to someone else's message must
    // not silence this quote.
    const context = contextWithQuotedMessageInHistory({
      preprocessedExtendedContextAttachments: [
        {
          ...extendedContextImage(),
          metadata: { ...extendedContextImage().metadata, sourceDiscordMessageId: 'other-msg-99' },
        },
      ],
      preprocessedReferenceAttachments: preprocessedForReference,
    });
    context.rawConversationHistory?.push({
      id: 'db-row-uuid-2',
      discordMessageId: ['other-msg-99'],
      role: 'user',
      content: 'unrelated',
    });

    const { referencedMessagesDescriptions } = await runInProductionOrder(context);

    expect(referencedMessagesDescriptions).toContain(VISION_SENTINEL);
  });

  it('prints the description TWICE when the steps run in the wrong order', async () => {
    // The regression itself, pinned as a property of the ORDER rather than of
    // either step. Rendering first is what produced the shipped bug: the stub
    // has nothing to subtract against yet, and enrichment then adds the second
    // copy behind it. If someone moves the enrichment call back below
    // `processInputs`, the first case above goes red and this one explains why.
    const context = contextWithQuotedMessageInHistory({
      preprocessedExtendedContextAttachments: [extendedContextImage()],
      preprocessedReferenceAttachments: preprocessedForReference,
    });

    const { referencedMessagesDescriptions } = await processor.processInputs(
      TEST_PERSONALITY,
      'what breed is that',
      context,
      { isGuestMode: true }
    );
    await enrichRagHistory({
      prisma,
      context,
      personality: TEST_PERSONALITY,
      visionAuth: {},
      isGuestMode: true,
    });

    expect(referencedMessagesDescriptions).toContain(VISION_SENTINEL);
    expect(context.rawConversationHistory?.[0].messageMetadata?.imageDescriptions?.[0]).toEqual({
      filename: 'cat.png',
      description: VISION_SENTINEL,
    });
  });
});
