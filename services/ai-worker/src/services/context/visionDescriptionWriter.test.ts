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

function makeHistory(): {
  updateLastUserMessage: ReturnType<typeof vi.fn>;
  persistReferenceImageDescriptions: ReturnType<typeof vi.fn>;
} {
  return {
    updateLastUserMessage: vi.fn().mockResolvedValue(true),
    persistReferenceImageDescriptions: vi.fn().mockResolvedValue(1),
  };
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
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      'look at this\n\n[Image: img.png]\na red bicycle leaning on a wall'
    );
  });

  it('uses descriptions alone when the message has no text (image-only trigger)', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: '',
      jobContext: makeContext(),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });

    expect(history.updateLastUserMessage).toHaveBeenCalledWith(
      'chan-1',
      'pers-1',
      'persona-1',
      '[Image: img.png]\na red bicycle leaning on a wall'
    );
  });

  it('skips when there are no processed attachments', async () => {
    const history = makeHistory();
    const writer = new VisionDescriptionWriter(history as never);

    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'plain text',
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
      jobContext: makeContext({ channelId: undefined }),
      personalityId: 'pers-1',
      processedAttachments: [imageAttachment],
    });
    await writer.persistTriggerDescriptions({
      jobId: 'j1',
      message: 'text',
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

  describe('persistReferenceDescriptions', () => {
    const audioRefAttachment: ProcessedAttachment = {
      type: AttachmentType.Audio,
      description: 'a spoken greeting',
      originalUrl: 'https://cdn/voice.ogg',
      metadata: { url: 'https://cdn/voice.ogg', name: 'voice.ogg', contentType: 'audio/ogg' },
    };

    it('builds a URL→description map for images and forwards it to the history service', async () => {
      const history = makeHistory();
      const writer = new VisionDescriptionWriter(history as never);

      await writer.persistReferenceDescriptions({
        jobId: 'j1',
        jobContext: makeContext(),
        personalityId: 'pers-1',
        processedReferenceAttachments: { 1: [imageAttachment] },
      });

      expect(history.persistReferenceImageDescriptions).toHaveBeenCalledWith(
        'chan-1',
        'pers-1',
        'persona-1',
        new Map([['https://cdn/img.png', 'a red bicycle leaning on a wall']])
      );
    });

    it('excludes non-image attachments from the description map', async () => {
      const history = makeHistory();
      const writer = new VisionDescriptionWriter(history as never);

      await writer.persistReferenceDescriptions({
        jobId: 'j1',
        jobContext: makeContext(),
        personalityId: 'pers-1',
        processedReferenceAttachments: { 1: [imageAttachment, audioRefAttachment] },
      });

      expect(history.persistReferenceImageDescriptions).toHaveBeenCalledWith(
        'chan-1',
        'pers-1',
        'persona-1',
        new Map([['https://cdn/img.png', 'a red bicycle leaning on a wall']])
      );
    });

    it('skips when there are no image descriptions to persist', async () => {
      const history = makeHistory();
      const writer = new VisionDescriptionWriter(history as never);

      await writer.persistReferenceDescriptions({
        jobId: 'j1',
        jobContext: makeContext(),
        personalityId: 'pers-1',
        processedReferenceAttachments: { 1: [audioRefAttachment] },
      });

      expect(history.persistReferenceImageDescriptions).not.toHaveBeenCalled();
    });

    it('skips when the persona id is missing', async () => {
      const history = makeHistory();
      const writer = new VisionDescriptionWriter(history as never);

      await writer.persistReferenceDescriptions({
        jobId: 'j1',
        jobContext: makeContext({ activePersonaId: undefined }),
        personalityId: 'pers-1',
        processedReferenceAttachments: { 1: [imageAttachment] },
      });

      expect(history.persistReferenceImageDescriptions).not.toHaveBeenCalled();
    });

    it('never throws — a failed persist warns and resolves', async () => {
      const history = {
        updateLastUserMessage: vi.fn(),
        persistReferenceImageDescriptions: vi.fn().mockRejectedValue(new Error('db down')),
      };
      const writer = new VisionDescriptionWriter(history as never);

      await expect(
        writer.persistReferenceDescriptions({
          jobId: 'j1',
          jobContext: makeContext(),
          personalityId: 'pers-1',
          processedReferenceAttachments: { 1: [imageAttachment] },
        })
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'j1' }),
        expect.stringContaining('cache-only hydration remains')
      );
    });
  });
});
