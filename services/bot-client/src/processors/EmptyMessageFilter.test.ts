/**
 * Empty Message Filter Tests
 *
 * Tests filtering of empty messages (no content, no attachments).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EmptyMessageFilter } from './EmptyMessageFilter.js';
import type { Message } from 'discord.js';

function createMockMessage(options: {
  content: string;
  attachmentCount: number;
  snapshotAttachmentCount?: number;
}): Message {
  const attachments = new Map();
  for (let i = 0; i < options.attachmentCount; i++) {
    attachments.set(`attachment-${i}`, {
      id: `attachment-${i}`,
      url: `https://example.com/file${i}.png`,
    });
  }

  const messageSnapshots = new Map();
  if (options.snapshotAttachmentCount !== undefined && options.snapshotAttachmentCount > 0) {
    const snapshotAttachments = new Map();
    for (let i = 0; i < options.snapshotAttachmentCount; i++) {
      snapshotAttachments.set(`snapshot-attachment-${i}`, {
        id: `snapshot-attachment-${i}`,
        url: `https://example.com/snapshot-file${i}.ogg`,
      });
    }
    messageSnapshots.set('snapshot-1', {
      attachments: snapshotAttachments,
    });
  }

  return {
    id: '123456789',
    content: options.content,
    attachments,
    messageSnapshots: messageSnapshots.size > 0 ? messageSnapshots : null,
  } as unknown as Message;
}

describe('EmptyMessageFilter', () => {
  let filter: EmptyMessageFilter;

  beforeEach(() => {
    filter = new EmptyMessageFilter();
  });

  it('should filter out empty messages', async () => {
    const message = createMockMessage({ content: '', attachmentCount: 0 });

    const result = await filter.process(message);

    expect(result).toBe(true); // Should stop processing
  });

  it('should allow messages with content', async () => {
    const message = createMockMessage({ content: 'Hello', attachmentCount: 0 });

    const result = await filter.process(message);

    expect(result).toBe(false); // Should continue processing
  });

  it('should allow messages with attachments but no content', async () => {
    const message = createMockMessage({ content: '', attachmentCount: 1 });

    const result = await filter.process(message);

    expect(result).toBe(false); // Should continue processing
  });

  it('should allow messages with both content and attachments', async () => {
    const message = createMockMessage({ content: 'Check this out', attachmentCount: 2 });

    const result = await filter.process(message);

    expect(result).toBe(false); // Should continue processing
  });

  it('should allow forwarded messages with snapshot attachments but no content', async () => {
    const message = createMockMessage({
      content: '',
      attachmentCount: 0,
      snapshotAttachmentCount: 1,
    });

    const result = await filter.process(message);

    expect(result).toBe(false); // Should continue processing (forwarded voice message)
  });

  it('should filter out truly empty messages with no snapshots', async () => {
    const message = createMockMessage({
      content: '',
      attachmentCount: 0,
      snapshotAttachmentCount: 0,
    });

    const result = await filter.process(message);

    expect(result).toBe(true); // Should stop processing
  });
});
