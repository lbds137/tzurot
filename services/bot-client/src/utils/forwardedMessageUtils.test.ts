/**
 * Forwarded Message Utilities Tests
 *
 * Tests for the centralized forwarded message detection and content extraction utilities.
 * These utilities are the SINGLE SOURCE OF TRUTH for handling Discord forwarded messages.
 */

import { describe, it, expect } from 'vitest';
import type { Message, MessageSnapshot, Collection } from 'discord.js';
import { MessageReferenceType } from 'discord.js';
import {
  isForwardedMessage,
  hasForwardedSnapshots,
  getFirstSnapshot,
  getSnapshots,
  extractForwardedContent,
  extractForwardedAttachments,
  extractAllForwardedContent,
  hasForwardedContent,
  hasForwardedVoiceAttachment,
  getEffectiveContent,
} from './forwardedMessageUtils.js';

/**
 * Create a mock Discord message for testing
 */
function createMockMessage(options: {
  referenceType?: typeof MessageReferenceType.Forward | typeof MessageReferenceType.Default | null;
  referenceMessageId?: string;
  content?: string;
  snapshots?: Array<{
    content?: string;
    attachments?: Array<{
      url: string;
      contentType?: string;
      name?: string;
      size?: number;
      duration?: number;
      isVoiceMessage?: boolean;
    }>;
    embeds?: Array<{ title?: string; description?: string }>;
  }>;
  attachments?: Array<{
    url: string;
    contentType?: string;
    name?: string;
    size?: number;
  }>;
  embeds?: Array<{ title?: string; description?: string }>;
}): Message {
  // Create attachments map
  const attachmentsMap = new Map();
  if (options.attachments) {
    options.attachments.forEach((att, index) => {
      attachmentsMap.set(`att-${index}`, {
        url: att.url,
        contentType: att.contentType ?? 'application/octet-stream',
        name: att.name ?? `file-${index}`,
        size: att.size ?? 1000,
      });
    });
  }

  // Create messageSnapshots collection
  let messageSnapshots: Collection<string, MessageSnapshot> | undefined;
  if (options.snapshots && options.snapshots.length > 0) {
    const snapshotsMap = new Map();
    options.snapshots.forEach((snap, index) => {
      // Create snapshot attachments map
      const snapAttachments = new Map();
      if (snap.attachments) {
        snap.attachments.forEach((att, attIndex) => {
          snapAttachments.set(`snap-att-${attIndex}`, {
            url: att.url,
            contentType: att.contentType ?? 'application/octet-stream',
            name: att.name ?? `snap-file-${attIndex}`,
            size: att.size ?? 1000,
            duration: att.duration ?? null,
          });
        });
      }

      snapshotsMap.set(`snapshot-${index}`, {
        content: snap.content ?? '',
        attachments: snapAttachments,
        embeds: snap.embeds ?? [],
      });
    });

    // Add Collection-like methods
    messageSnapshots = {
      size: snapshotsMap.size,
      values: () => snapshotsMap.values(),
      first: () => snapshotsMap.values().next().value,
    } as unknown as Collection<string, MessageSnapshot>;
  }

  // Create reference object
  const reference =
    options.referenceType !== null && options.referenceType !== undefined
      ? {
          type: options.referenceType,
          messageId: options.referenceMessageId,
        }
      : null;

  return {
    content: options.content ?? '',
    reference,
    messageSnapshots,
    attachments: attachmentsMap,
    embeds: options.embeds ?? [],
  } as unknown as Message;
}

describe('forwardedMessageUtils', () => {
  describe('isForwardedMessage', () => {
    it('should return true for message with Forward reference type', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(isForwardedMessage(message)).toBe(true);
    });

    it('should return true for forwarded message even without snapshots', () => {
      // This is a key behavior - we detect forwarded messages by reference type only
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [], // No snapshots
      });

      expect(isForwardedMessage(message)).toBe(true);
    });

    it('should return false for regular message', () => {
      const message = createMockMessage({
        content: 'Hello',
      });

      expect(isForwardedMessage(message)).toBe(false);
    });

    it('should return false for reply message', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Default,
        content: 'This is a reply',
      });

      expect(isForwardedMessage(message)).toBe(false);
    });
  });

  describe('hasForwardedSnapshots', () => {
    it('should return true when forward message has snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Forwarded content' }],
      });

      expect(hasForwardedSnapshots(message)).toBe(true);
    });

    it('should return false when forward message has no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        // No snapshots
      });

      expect(hasForwardedSnapshots(message)).toBe(false);
    });

    it('should return false when forward message has empty snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [],
      });

      expect(hasForwardedSnapshots(message)).toBe(false);
    });

    it('should return false for non-forwarded message even with snapshots data', () => {
      // Edge case: snapshots exist but reference type is not Forward
      const message = createMockMessage({
        referenceType: MessageReferenceType.Default,
        snapshots: [{ content: 'Some content' }],
      });

      expect(hasForwardedSnapshots(message)).toBe(false);
    });
  });

  describe('getFirstSnapshot', () => {
    it('should return first snapshot from forwarded message', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'First snapshot' }, { content: 'Second snapshot' }],
      });

      const snapshot = getFirstSnapshot(message);

      expect(snapshot).toBeDefined();
      expect(snapshot?.content).toBe('First snapshot');
    });

    it('should return undefined when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(getFirstSnapshot(message)).toBeUndefined();
    });

    it('should return undefined for non-forwarded message', () => {
      const message = createMockMessage({
        content: 'Regular message',
      });

      expect(getFirstSnapshot(message)).toBeUndefined();
    });
  });

  describe('getSnapshots', () => {
    it('should return snapshots collection from forwarded message', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Snapshot 1' }, { content: 'Snapshot 2' }],
      });

      const snapshots = getSnapshots(message);

      expect(snapshots).toBeDefined();
      expect(snapshots?.size).toBe(2);
    });

    it('should return undefined when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(getSnapshots(message)).toBeUndefined();
    });
  });

  describe('extractForwardedContent', () => {
    it('should extract content from snapshot', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Content from forwarded message' }],
        content: '', // Main content empty
      });

      expect(extractForwardedContent(message)).toBe('Content from forwarded message');
    });

    it('should fall back to main content when snapshot is empty', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: '' }], // Empty snapshot content
        content: 'Fallback content',
      });

      expect(extractForwardedContent(message)).toBe('Fallback content');
    });

    it('should fall back to main content when no snapshots exist', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        content: 'Main message content',
        // No snapshots
      });

      expect(extractForwardedContent(message)).toBe('Main message content');
    });
  });

  describe('extractForwardedAttachments', () => {
    it('should extract attachments from snapshot', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/image.png',
                contentType: 'image/png',
                name: 'image.png',
              },
            ],
          },
        ],
      });

      const attachments = extractForwardedAttachments(message);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].url).toBe('https://cdn.discord.com/image.png');
      expect(attachments[0].contentType).toBe('image/png');
    });

    it('should extract attachments from multiple snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [{ url: 'https://cdn.discord.com/img1.png', contentType: 'image/png' }],
          },
          {
            attachments: [{ url: 'https://cdn.discord.com/img2.png', contentType: 'image/png' }],
          },
        ],
      });

      const attachments = extractForwardedAttachments(message);

      expect(attachments).toHaveLength(2);
    });

    it('should return empty array when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
      });

      expect(extractForwardedAttachments(message)).toEqual([]);
    });

    it('should return empty array for non-forwarded message', () => {
      const message = createMockMessage({
        content: 'Regular message',
        attachments: [{ url: 'https://cdn.discord.com/file.txt' }],
      });

      // extractForwardedAttachments is specifically for forwarded message snapshots
      // For non-forwarded messages, it returns empty because there are no snapshots
      expect(extractForwardedAttachments(message)).toEqual([]);
    });
  });

  describe('extractAllForwardedContent', () => {
    it('should extract all content from snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        referenceMessageId: 'original-123',
        snapshots: [
          {
            content: 'Forwarded text',
            attachments: [{ url: 'https://cdn.discord.com/image.png', contentType: 'image/png' }],
            embeds: [{ title: 'Embed Title' }],
          },
        ],
      });

      const result = extractAllForwardedContent(message);

      expect(result.content).toBe('Forwarded text');
      expect(result.attachments).toHaveLength(1);
      expect(result.embeds).toHaveLength(1);
      expect(result.fromSnapshot).toBe(true);
      expect(result.originalMessageId).toBe('original-123');
    });

    it('should fall back to main message when no snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        referenceMessageId: 'original-456',
        content: 'Main content',
        attachments: [{ url: 'https://cdn.discord.com/main.png', contentType: 'image/png' }],
        embeds: [{ title: 'Main Embed' }],
      });

      const result = extractAllForwardedContent(message);

      expect(result.content).toBe('Main content');
      expect(result.attachments).toHaveLength(1);
      expect(result.embeds).toHaveLength(1);
      expect(result.fromSnapshot).toBe(false);
      expect(result.originalMessageId).toBe('original-456');
    });
  });

  describe('hasForwardedContent', () => {
    it('should return true when forwarded message has text content', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Some content' }],
      });

      expect(hasForwardedContent(message)).toBe(true);
    });

    it('should return true when forwarded message has only attachments', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            content: '',
            attachments: [{ url: 'https://cdn.discord.com/image.png' }],
          },
        ],
      });

      expect(hasForwardedContent(message)).toBe(true);
    });

    it('should return true when forwarded message has only embeds', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            content: '',
            embeds: [{ title: 'Embed' }],
          },
        ],
      });

      expect(hasForwardedContent(message)).toBe(true);
    });

    it('should return false for non-forwarded message', () => {
      const message = createMockMessage({
        content: 'Regular message',
      });

      expect(hasForwardedContent(message)).toBe(false);
    });

    it('should return true when forwarded message has main content but no snapshots', () => {
      // Edge case: forwarded with no snapshots falls back to main content
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        content: 'Fallback content',
      });

      expect(hasForwardedContent(message)).toBe(true);
    });
  });

  describe('hasForwardedVoiceAttachment', () => {
    it('should return true when forwarded message has voice attachment', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice.ogg',
                contentType: 'audio/ogg',
                duration: 5.5,
                isVoiceMessage: true,
              },
            ],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(true);
    });

    it('should return true when forwarded attachment has duration', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [
              {
                url: 'https://cdn.discord.com/voice.ogg',
                contentType: 'application/octet-stream',
                duration: 10, // Has duration = voice message
              },
            ],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(true);
    });

    it('should return false when forwarded message has no voice attachments', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [
          {
            attachments: [{ url: 'https://cdn.discord.com/image.png', contentType: 'image/png' }],
          },
        ],
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(false);
    });

    it('should return false for non-forwarded message', () => {
      const message = createMockMessage({
        content: 'Regular message',
      });

      expect(hasForwardedVoiceAttachment(message)).toBe(false);
    });
  });

  describe('getEffectiveContent', () => {
    it('should return message content for regular messages', () => {
      const message = createMockMessage({
        content: 'Hello world!',
      });

      expect(getEffectiveContent(message)).toBe('Hello world!');
    });

    it('should return snapshot content for forwarded messages', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'Forwarded content here' }],
        content: '', // Main content empty
      });

      expect(getEffectiveContent(message)).toBe('Forwarded content here');
    });

    it('should return main content for forwarded message without snapshots', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        content: 'Fallback content from main',
        // No snapshots
      });

      expect(getEffectiveContent(message)).toBe('Fallback content from main');
    });

    it('should return first snapshot content when multiple exist', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Forward,
        snapshots: [{ content: 'First' }, { content: 'Second' }],
      });

      expect(getEffectiveContent(message)).toBe('First');
    });

    it('should return reply message content (not forwarded)', () => {
      const message = createMockMessage({
        referenceType: MessageReferenceType.Default,
        content: 'My reply',
      });

      expect(getEffectiveContent(message)).toBe('My reply');
    });
  });
});
