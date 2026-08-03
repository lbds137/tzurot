import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type JobContext } from '@tzurot/common-types/types/jobs';
import { VisionDescriptionWriter } from './visionDescriptionWriter.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';

function makeHistory(): { updateLastUserMessage: ReturnType<typeof vi.fn> } {
  return { updateLastUserMessage: vi.fn().mockResolvedValue(true) };
}

function makeContext(partial: Partial<JobContext> = {}): JobContext {
  return {
    userId: 'user-1',
    channelId: 'chan-1',
    activePersonaId: 'persona-1',
    ...partial,
  } as JobContext;
}

const imageAttachment: ProcessedAttachment = {
  type: AttachmentType.Image,
  description: 'a red bicycle leaning on a wall',
  originalUrl: 'https://cdn/img.png',
  metadata: { url: 'https://cdn/img.png', name: 'img.png', contentType: 'image/png', size: 10 },
};

const SPOKEN_WORDS = 'can you hear me okay';

/**
 * Shaped exactly as DependencyStep builds a trigger audio attachment from a
 * transcription dependency result: no isVoiceMessage/duration metadata, so the
 * description carries an `[Audio: name]` header (not `[Voice message: Ns]`).
 */
const voiceAttachment: ProcessedAttachment = {
  type: AttachmentType.Audio,
  description: SPOKEN_WORDS,
  originalUrl: 'https://cdn/voice-message.ogg',
  metadata: {
    url: 'https://cdn/voice-message.ogg',
    name: 'voice-message.ogg',
    contentType: 'audio/unknown',
    size: 0,
  },
};

const VOICE_DESCRIPTIONS = `[Audio: voice-message.ogg]\n<voice_transcripts><transcript>${SPOKEN_WORDS}</transcript></voice_transcripts>`;

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('VisionDescriptionWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends descriptions to the message content (the retired bot-side composition)', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'look at this',
      rawMessageContent: 'look at this',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      'look at this\n\n[Image: img.png]\na red bicycle leaning on a wall',
      { triggerMessageId: undefined }
    );
  });

  it('uses descriptions alone when the message has no text (image-only trigger)', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: '',
      rawMessageContent: '',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      '[Image: img.png]\na red bicycle leaning on a wall',
      { triggerMessageId: undefined }
    );
  });

  it('stores descriptions alone for a voice trigger (the transcript appears once)', async () => {
    // The user typed nothing (rawMessageContent === ''), so `message` here is
    // the bot-side STT transcript — prefixing it would store the spoken words
    // both bare and inside <voice_transcripts>.
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: SPOKEN_WORDS,
      rawMessageContent: '',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [voiceAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      VOICE_DESCRIPTIONS,
      { triggerMessageId: undefined }
    );
    const stored = history.updateLastUserMessage.mock.calls[0][3] as string;
    expect(occurrences(stored, SPOKEN_WORDS)).toBe(1);
  });

  it('keeps the message prefix when the user typed text alongside an audio attachment', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'listen to this clip',
      rawMessageContent: 'listen to this clip',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [voiceAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      `listen to this clip\n\n${VOICE_DESCRIPTIONS}`,
      { triggerMessageId: undefined }
    );
  });

  it('keeps the message prefix when the payload carries no raw inputs to discriminate on', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'look at this',
      rawMessageContent: undefined,
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      'look at this\n\n[Image: img.png]\na red bicycle leaning on a wall',
      { triggerMessageId: undefined }
    );
  });

  it('targets the row the job was queued for, not just the latest one', async () => {
    // The other write this job makes uses the same id. A second message landing
    // mid-generation must not collect this one's descriptions.
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'look at this',
      rawMessageContent: 'look at this',
      jobContext: makeContext({ triggerMessageId: 'discord-42' }),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      expect.any(String),
      { triggerMessageId: 'discord-42' }
    );
  });

  it('skips when there are no processed attachments', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'plain text',
      rawMessageContent: 'plain text',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [],
    });

    expect(history.updateLastUserMessage).not.toHaveBeenCalled();
  });

  it('skips when descriptions collapse to an empty string (unrecognized types)', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'text',
      rawMessageContent: 'text',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [
        { ...imageAttachment, type: 'mystery' as never }, // formats to ''
      ],
    });

    expect(history.updateLastUserMessage).not.toHaveBeenCalled();
  });

  it('skips on non-string message shapes', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: { structured: true },
      rawMessageContent: 'text',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).not.toHaveBeenCalled();
  });

  it('skips when the persona id is missing', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'text',
      rawMessageContent: 'text',
      jobContext: makeContext({ activePersonaId: undefined }),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).not.toHaveBeenCalled();
  });

  it('skips on missing or empty channel id', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'text',
      rawMessageContent: 'text',
      jobContext: makeContext({ channelId: undefined }),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });
    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'text',
      rawMessageContent: 'text',
      jobContext: makeContext({ channelId: '' }),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).not.toHaveBeenCalled();
  });

  it('never throws — a failed write leaves placeholders and warns', async () => {
    const history = {
      updateLastUserMessage: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const writer = new VisionDescriptionWriter(history as never);

    await expect(
      writer.persistTriggerDescriptions({
        jobId: 'j1',
        message: 'text',
        rawMessageContent: 'text',
        jobContext: makeContext(),
        personalityId: 'pers-1',
        processedAttachments: [imageAttachment],
      })
    ).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'j1' }),
      expect.stringContaining('placeholders remain')
    );
  });
});
