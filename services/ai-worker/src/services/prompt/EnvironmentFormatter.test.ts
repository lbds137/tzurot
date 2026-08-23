/**
 * Tests for EnvironmentFormatter
 *
 * Tests the ai-worker wrapper around formatLocationAsXml.
 * The core formatting logic is tested in common-types/environmentFormatter.test.ts.
 * This file tests the wrapper adds logging and delegates correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatEnvironmentContext, formatCurrentLocationLine } from './EnvironmentFormatter.js';
import type { DiscordEnvironment } from '@tzurot/common-types/types/schemas/discord';

// Mock the logger but keep formatLocationAsXml as real implementation
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('EnvironmentFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatEnvironmentContext', () => {
    describe('XML structure', () => {
      it('should return a <location> element for DM', () => {
        const dmEnvironment: DiscordEnvironment = {
          type: 'dm',
          channel: {
            id: 'dm-1',
            name: 'Direct Message',
            type: 'DM',
          },
        };

        const result = formatEnvironmentContext(dmEnvironment);

        expect(result).toMatch(/^<location type="dm">/);
        expect(result).toMatch(/<\/location>$/);
      });

      it('should return a <location> element for guild', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Test Server' },
          channel: { id: 'channel-1', name: 'general', type: 'text' },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        expect(result).toMatch(/^<location type="guild">/);
        expect(result).toMatch(/<\/location>$/);
      });

      it('should have properly closed XML tags', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Test Server' },
          channel: { id: 'channel-1', name: 'general', type: 'text' },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        // Count opening and closing location tags
        const openTags = (result.match(/<location[^>]*>/g) || []).length;
        const closeTags = (result.match(/<\/location>/g) || []).length;
        expect(openTags).toBe(1);
        expect(closeTags).toBe(1);
      });
    });

    describe('DM environment', () => {
      it('should format DM environment with type="dm"', () => {
        const dmEnvironment: DiscordEnvironment = {
          type: 'dm',
          channel: {
            id: 'dm-1',
            name: 'Direct Message',
            type: 'DM',
          },
        };

        const result = formatEnvironmentContext(dmEnvironment);

        expect(result).toContain('<location type="dm">');
        expect(result).toContain('Direct Message');
        expect(result).toContain('private one-on-one chat');
        expect(result).toContain('</location>');
      });
    });

    describe('guild environment', () => {
      it('should format guild environment with type="guild"', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test Server',
          },
          channel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        expect(result).toContain('<location type="guild">');
        expect(result).toContain('</location>');
      });

      it('should include server element with name attribute', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test Server',
          },
          channel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        expect(result).toContain('<server name="Test Server"/>');
      });

      it('should include channel element with name and type attributes', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test Server',
          },
          channel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        expect(result).toContain('<channel name="general" type="text"/>');
      });

      it('should include category when present', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test Server',
          },
          channel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
          category: {
            id: 'cat-1',
            name: 'Community',
          },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        expect(result).toContain('<category name="Community"/>');
      });

      it('should include thread when present', () => {
        const threadEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test Server',
          },
          channel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
          thread: {
            id: 'thread-1',
            name: 'Discussion Thread',
            parentChannel: {
              id: 'channel-1',
              name: 'general',
              type: 'text',
            },
          },
        };

        const result = formatEnvironmentContext(threadEnvironment);

        expect(result).toContain('<thread name="Discussion Thread"/>');
      });

      it('should include all guild features together', () => {
        const fullGuildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test Server',
          },
          channel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
          category: {
            id: 'cat-1',
            name: 'Community',
          },
          thread: {
            id: 'thread-1',
            name: 'Discussion Thread',
            parentChannel: {
              id: 'channel-1',
              name: 'general',
              type: 'text',
            },
          },
        };

        const result = formatEnvironmentContext(fullGuildEnvironment);

        expect(result).toContain('<server name="Test Server"/>');
        expect(result).toContain('<category name="Community"/>');
        expect(result).toContain('<channel name="general" type="text"/>');
        expect(result).toContain('<thread name="Discussion Thread"/>');
      });

      it('should skip category when name is empty', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test Server',
          },
          channel: {
            id: 'channel-1',
            name: 'general',
            type: 'text',
          },
          category: {
            id: 'cat-1',
            name: '',
          },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        expect(result).not.toContain('<category');
        expect(result).toContain('<server name="Test Server"/>');
        expect(result).toContain('<channel name="general"');
      });

      it('should escape XML special characters in names', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: {
            id: 'guild-1',
            name: 'Test & Debug Server',
          },
          channel: {
            id: 'channel-1',
            name: 'chat"room',
            type: 'text',
          },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        expect(result).toContain('name="Test &amp; Debug Server"');
        expect(result).toContain('name="chat&quot;room"');
      });
    });

    describe('element ordering', () => {
      it('should order elements as: server, category, channel, thread', () => {
        const fullGuildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Server' },
          channel: { id: 'channel-1', name: 'channel', type: 'text' },
          category: { id: 'cat-1', name: 'Category' },
          thread: {
            id: 'thread-1',
            name: 'Thread',
            parentChannel: { id: 'channel-1', name: 'channel', type: 'text' },
          },
        };

        const result = formatEnvironmentContext(fullGuildEnvironment);

        const serverIndex = result.indexOf('<server');
        const categoryIndex = result.indexOf('<category');
        const channelIndex = result.indexOf('<channel');
        const threadIndex = result.indexOf('<thread');

        expect(serverIndex).toBeLessThan(categoryIndex);
        expect(categoryIndex).toBeLessThan(channelIndex);
        expect(channelIndex).toBeLessThan(threadIndex);
      });
    });
  });

  describe('formatCurrentLocationLine', () => {
    it('should render the DM line for undefined environment', () => {
      const result = formatCurrentLocationLine(undefined);
      expect(result).toBe(
        '<current_location>Direct Message (private one-on-one chat)</current_location>'
      );
    });

    it('should render the DM line for null environment', () => {
      const result = formatCurrentLocationLine(null);
      expect(result).toBe(
        '<current_location>Direct Message (private one-on-one chat)</current_location>'
      );
    });

    it('should render the DM line for a dm environment', () => {
      const dmEnvironment: DiscordEnvironment = {
        type: 'dm',
        channel: { id: 'dm-1', name: 'Direct Message', type: 'DM' },
      };
      const result = formatCurrentLocationLine(dmEnvironment);
      expect(result).toBe(
        '<current_location>Direct Message (private one-on-one chat)</current_location>'
      );
    });

    it('should render server, category, channel, and thread for a full guild environment', () => {
      const fullGuildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-1', name: 'chat', type: 'text' },
        category: { id: 'cat-1', name: 'General' },
        thread: {
          id: 'thread-1',
          name: 'discussion',
          parentChannel: { id: 'channel-1', name: 'chat', type: 'text' },
        },
      };

      const result = formatCurrentLocationLine(fullGuildEnvironment);

      expect(result).toBe(
        '<current_location>server "Test Server" › category "General" › channel #chat › thread "discussion"</current_location>'
      );
    });

    it('should omit category and thread segments when absent', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-1', name: 'chat', type: 'text' },
      };

      const result = formatCurrentLocationLine(guildEnvironment);

      expect(result).toBe(
        '<current_location>server "Test Server" › channel #chat</current_location>'
      );
    });

    it('should omit the category segment when the category name is empty', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-1', name: 'chat', type: 'text' },
        category: { id: 'cat-1', name: '' },
      };

      const result = formatCurrentLocationLine(guildEnvironment);

      expect(result).not.toContain('category');
      expect(result).toBe(
        '<current_location>server "Test Server" › channel #chat</current_location>'
      );
    });

    it('should join thread directly after channel when category is absent', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-1', name: 'chat', type: 'text' },
        thread: {
          id: 'thread-1',
          name: 'discussion',
          parentChannel: { id: 'channel-1', name: 'chat', type: 'text' },
        },
      };

      const result = formatCurrentLocationLine(guildEnvironment);

      expect(result).toBe(
        '<current_location>server "Test Server" › channel #chat › thread "discussion"</current_location>'
      );
    });

    it('should omit the server segment when guild is absent on a guild-type environment', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        channel: { id: 'channel-1', name: 'chat', type: 'text' },
      };

      const result = formatCurrentLocationLine(guildEnvironment);

      expect(result).toBe('<current_location>channel #chat</current_location>');
    });

    it('should not include the channel topic in the output', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test Server' },
        channel: { id: 'channel-1', name: 'chat', type: 'text', topic: 'Very secret topic' },
      };

      const result = formatCurrentLocationLine(guildEnvironment);

      expect(result).not.toContain('Very secret topic');
    });

    it('should XML-escape special characters in the guild name', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Test & <Debug> "Server"' },
        channel: { id: 'channel-1', name: 'chat', type: 'text' },
      };

      const result = formatCurrentLocationLine(guildEnvironment);

      expect(result).toContain('&amp;');
      expect(result).toContain('&lt;Debug&gt;');
      expect(result).toContain('&quot;Server&quot;');
      expect(result).not.toMatch(/Debug> "Server"/);
    });

    it('should XML-escape special characters in category, channel, and thread names', () => {
      const guildEnvironment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-1', name: 'Server' },
        channel: { id: 'channel-1', name: 'chat<img>', type: 'text' },
        category: { id: 'cat-1', name: 'Cat & "Co"' },
        thread: {
          id: 'thread-1',
          name: '<script>alert(1)</script>',
          parentChannel: { id: 'channel-1', name: 'chat<img>', type: 'text' },
        },
      };

      const result = formatCurrentLocationLine(guildEnvironment);

      expect(result).toContain('channel #chat&lt;img&gt;');
      expect(result).toContain('category "Cat &amp; &quot;Co&quot;"');
      expect(result).toContain('thread "&lt;script&gt;alert(1)&lt;/script&gt;"');
      expect(result).not.toContain('<img>');
      expect(result).not.toContain('<script>');
    });
  });
});
