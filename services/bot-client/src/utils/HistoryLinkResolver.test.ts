/**
 * History Link Resolver Tests
 *
 * Tests for resolving Discord message links in extended context history.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, Client } from 'discord.js';
import { resolveHistoryLinks } from './HistoryLinkResolver.js';

// Mock dependencies
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./MessageContentBuilder.js', () => ({
  buildMessageContent: vi.fn().mockResolvedValue({
    content: 'Mocked resolved content',
    attachments: [],
    hasVoiceMessage: false,
    isForwarded: false,
  }),
}));

// Test constants
const USER_ID = 'user-123';
const DEFAULT_GUILD_ID = '111222333444555666';
const DEFAULT_CHANNEL_ID = '222333444555666777';
// Message IDs must be numeric to match Discord URL regex
const LINKED_MSG_ID = '333444555666777888';
const LINKED_MSG_ID_2 = '444555666777888999';

/**
 * Create a mock message
 */
function createMockMessage(options: {
  id: string;
  content: string;
  createdTimestamp?: number;
}): Message {
  return {
    id: options.id,
    content: options.content,
    createdTimestamp: options.createdTimestamp ?? Date.now(),
    author: {
      id: USER_ID,
      globalName: 'TestUser',
      username: 'testuser',
    },
    member: {
      displayName: 'TestUser',
    },
    attachments: new Map(),
  } as unknown as Message;
}

/**
 * Create a mock Discord client with properly structured cache
 */
function createMockClient(options: {
  messages?: Map<string, Message>;
  guildId?: string;
  channelId?: string;
}): Client {
  const {
    messages = new Map(),
    guildId = DEFAULT_GUILD_ID,
    channelId = DEFAULT_CHANNEL_ID,
  } = options;

  // Create a Map-like object for channels cache
  const channelsCache = {
    get: vi.fn().mockImplementation((id: string) => {
      if (id === channelId) {
        return {
          messages: {
            fetch: vi.fn().mockImplementation(async (messageId: string) => {
              const msg = messages.get(messageId);
              if (msg === undefined) {
                throw new Error('Unknown Message');
              }
              return msg;
            }),
          },
        };
      }
      return undefined;
    }),
  };

  // Create a Map-like object for guilds cache
  const guildsCache = {
    get: vi.fn().mockImplementation((id: string) => {
      if (id === guildId) {
        return {
          channels: {
            cache: channelsCache,
          },
        };
      }
      return undefined;
    }),
  };

  return {
    guilds: {
      cache: guildsCache,
    },
  } as unknown as Client;
}

describe('HistoryLinkResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveHistoryLinks', () => {
    it('returns unchanged messages when no links present', async () => {
      const messages = [
        createMockMessage({ id: 'msg-1', content: 'Hello world' }),
        createMockMessage({ id: 'msg-2', content: 'How are you?' }),
      ];

      const client = createMockClient({});

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      expect(result.resolvedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.trimmedCount).toBe(0);
      expect(result.messages).toHaveLength(2);
    });

    it('resolves a single link and injects content inline', async () => {
      const linkedMessage = createMockMessage({
        id: LINKED_MSG_ID,
        content: 'This is the linked content',
      });

      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `Check this out: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID}`,
        }),
      ];

      const client = createMockClient({
        messages: new Map([[LINKED_MSG_ID, linkedMessage]]),
      });

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      expect(result.resolvedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.messages).toHaveLength(1);
      // Content should include the blockquote
      expect(result.messages[0].content).toContain('Linked message from');
      expect(result.messages[0].content).toContain('Mocked resolved content');
    });

    it('skips links to messages already in context', async () => {
      // msg-2 is a numeric ID that will be in context
      const MSG_2_ID = '555666777888999000';
      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `Check this: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${MSG_2_ID}`,
        }),
        createMockMessage({
          id: MSG_2_ID,
          content: 'I am already in context',
        }),
      ];

      const client = createMockClient({});

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      // Link should be skipped because MSG_2_ID is already in messages
      expect(result.resolvedCount).toBe(0);
      expect(result.skippedCount).toBe(0); // Not counted as skipped, just not processed
      expect(result.messages).toHaveLength(2);
    });

    it('handles failed link resolution gracefully', async () => {
      const NONEXISTENT_ID = '999000111222333444';
      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `Check this: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${NONEXISTENT_ID}`,
        }),
      ];

      const client = createMockClient({
        messages: new Map(), // Empty - message not found
      });

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      expect(result.resolvedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.messages).toHaveLength(1);
      // Original content should be unchanged
      expect(result.messages[0].content).toContain('https://discord.com/channels');
    });

    it('trims oldest messages when budget exceeded', async () => {
      const linkedMessage = createMockMessage({
        id: LINKED_MSG_ID,
        content: 'Linked content',
      });

      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `Link: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID}`,
          createdTimestamp: 3000,
        }),
        createMockMessage({
          id: 'msg-2',
          content: 'Middle message',
          createdTimestamp: 2000,
        }),
        createMockMessage({
          id: 'msg-3',
          content: 'Oldest message',
          createdTimestamp: 1000,
        }),
      ];

      const client = createMockClient({
        messages: new Map([[LINKED_MSG_ID, linkedMessage]]),
      });

      // Budget of 3, but we have 3 messages + 1 resolved = 4
      // Should trim 1 oldest message
      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 3,
      });

      expect(result.resolvedCount).toBe(1);
      expect(result.trimmedCount).toBe(1);
      expect(result.messages).toHaveLength(2);
      // Oldest message (msg-3) should be trimmed
      expect(result.messages.map(m => m.id)).not.toContain('msg-3');
    });

    it('deduplicates links to the same message', async () => {
      const linkedMessage = createMockMessage({
        id: LINKED_MSG_ID,
        content: 'Single linked message',
      });

      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `First link: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID}`,
        }),
        createMockMessage({
          id: 'msg-2',
          content: `Same link again: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID}`,
        }),
      ];

      const client = createMockClient({
        messages: new Map([[LINKED_MSG_ID, linkedMessage]]),
      });

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      // Should only resolve once despite two links
      expect(result.resolvedCount).toBe(1);
    });

    it('respects budget when many links present', async () => {
      // Create numeric IDs for linked messages
      const createLinkedMessage = (idx: number) => {
        const id = String(100000000000000000 + idx);
        return createMockMessage({ id, content: `Content of ${id}` });
      };

      // Create 10 messages with links to numeric IDs
      const messages = Array.from({ length: 10 }, (_, i) => {
        const linkedId = String(100000000000000000 + i);
        return createMockMessage({
          id: `msg-${i}`,
          content: `Link: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${linkedId}`,
        });
      });

      const linkedMessages = new Map(
        Array.from({ length: 10 }, (_, i) => {
          const id = String(100000000000000000 + i);
          return [id, createLinkedMessage(i)];
        })
      );

      const client = createMockClient({ messages: linkedMessages });

      // Budget of 12: 10 messages + at most 2 resolved
      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 12,
      });

      // Should limit links resolved to stay within budget
      expect(result.messages.length + result.resolvedCount).toBeLessThanOrEqual(12);
    });

    it('handles multiple links in single message', async () => {
      const linked1 = createMockMessage({ id: LINKED_MSG_ID, content: 'First linked' });
      const linked2 = createMockMessage({ id: LINKED_MSG_ID_2, content: 'Second linked' });

      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `Two links: https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID} and https://discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID_2}`,
        }),
      ];

      const client = createMockClient({
        messages: new Map([
          [LINKED_MSG_ID, linked1],
          [LINKED_MSG_ID_2, linked2],
        ]),
      });

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      expect(result.resolvedCount).toBe(2);
      // Both should be injected
      expect(result.messages[0].content).toContain('Linked message from');
    });

    it('handles inaccessible guild gracefully', async () => {
      const OTHER_GUILD_ID = '999888777666555444';
      const OTHER_MSG_ID = '888777666555444333';
      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `Link to other guild: https://discord.com/channels/${OTHER_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${OTHER_MSG_ID}`,
        }),
      ];

      const client = createMockClient({}); // Only has DEFAULT_GUILD_ID

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      expect(result.resolvedCount).toBe(0);
      expect(result.failedCount).toBe(1);
    });

    it('handles PTB and Canary Discord URLs', async () => {
      const linkedMessage = createMockMessage({
        id: LINKED_MSG_ID,
        content: 'Linked content',
      });

      const messages = [
        createMockMessage({
          id: 'msg-1',
          content: `PTB link: https://ptb.discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID}`,
        }),
        createMockMessage({
          id: 'msg-2',
          content: `Canary link: https://canary.discord.com/channels/${DEFAULT_GUILD_ID}/${DEFAULT_CHANNEL_ID}/${LINKED_MSG_ID}`,
        }),
      ];

      const client = createMockClient({
        messages: new Map([[LINKED_MSG_ID, linkedMessage]]),
      });

      const result = await resolveHistoryLinks(messages, {
        client,
        budget: 100,
      });

      // Both PTB and Canary URLs should be recognized (though deduped to same target)
      expect(result.resolvedCount).toBe(1);
    });
  });
});
