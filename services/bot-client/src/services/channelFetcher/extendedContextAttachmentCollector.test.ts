import { describe, it, expect } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { collectExtendedContextAttachments } from './extendedContextAttachmentCollector.js';

const image: AttachmentMetadata = {
  url: 'https://cdn/x.png',
  contentType: 'image/png',
  name: 'x.png',
};
const voice: AttachmentMetadata = {
  url: 'https://cdn/v.ogg',
  contentType: 'audio/ogg',
  name: 'v.ogg',
  isVoiceMessage: true,
};

function conv(
  attachments: AttachmentMetadata[],
  voiceTranscripts?: string[]
): { message: ConversationMessage; attachments: AttachmentMetadata[] } {
  return {
    message: {
      role: MessageRole.User,
      content: 'hi',
      ...(voiceTranscripts !== undefined ? { messageMetadata: { voiceTranscripts } } : {}),
    } as ConversationMessage,
    attachments,
  };
}

describe('collectExtendedContextAttachments', () => {
  it('collects images and stamps the source message id', () => {
    const images: AttachmentMetadata[] = [];
    const voiceOut: AttachmentMetadata[] = [];
    collectExtendedContextAttachments(conv([image]), 'm1', images, voiceOut);
    expect(images).toHaveLength(1);
    expect(images[0].sourceDiscordMessageId).toBe('m1');
    expect(voiceOut).toHaveLength(0);
  });

  it('ships a voice ref when the transcript is unresolved (empty voiceTranscripts)', () => {
    const images: AttachmentMetadata[] = [];
    const voiceOut: AttachmentMetadata[] = [];
    collectExtendedContextAttachments(conv([voice]), 'm2', images, voiceOut);
    expect(voiceOut).toHaveLength(1);
    expect(voiceOut[0].sourceDiscordMessageId).toBe('m2');
    expect(voiceOut[0].isVoiceMessage).toBe(true);
  });

  it('does NOT ship a voice ref when the transcript already resolved', () => {
    const images: AttachmentMetadata[] = [];
    const voiceOut: AttachmentMetadata[] = [];
    collectExtendedContextAttachments(conv([voice], ['resolved']), 'm3', images, voiceOut);
    expect(voiceOut).toHaveLength(0);
  });

  it('strips voice from images and only ships the unresolved voice ref for a mixed message', () => {
    const images: AttachmentMetadata[] = [];
    const voiceOut: AttachmentMetadata[] = [];
    collectExtendedContextAttachments(conv([image, voice]), 'm4', images, voiceOut);
    expect(images).toHaveLength(1);
    expect(images[0].contentType).toBe('image/png');
    expect(voiceOut).toHaveLength(1);
    expect(voiceOut[0].contentType).toBe('audio/ogg');
  });

  it('is a no-op when there are no attachments', () => {
    const images: AttachmentMetadata[] = [];
    const voiceOut: AttachmentMetadata[] = [];
    collectExtendedContextAttachments(conv([]), 'm5', images, voiceOut);
    expect(images).toHaveLength(0);
    expect(voiceOut).toHaveLength(0);
  });
});
