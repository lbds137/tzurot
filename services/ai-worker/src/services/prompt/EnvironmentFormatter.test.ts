/**
 * Tests for EnvironmentFormatter
 *
 * Tests the ai-worker wrapper around formatLocationAsXml.
 * The core formatting logic is tested in common-types/environmentFormatter.test.ts.
 * This file tests the wrapper adds logging and delegates correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatEnvironmentContext } from './EnvironmentFormatter.js';
import type { DiscordEnvironment } from '@tzurot/common-types';

// Mock the logger but keep formatLocationAsXml as real implementation
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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
});
