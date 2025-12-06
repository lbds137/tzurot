/**
 * Tests for EnvironmentFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatEnvironmentContext } from './EnvironmentFormatter.js';
import type { DiscordEnvironment } from '../ConversationalRAGService.js';

// Mock the logger
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
    describe('XML wrapper', () => {
      it('should wrap output in <current_situation> tags', () => {
        const dmEnvironment: DiscordEnvironment = {
          type: 'dm',
          channel: {
            id: 'dm-1',
            name: 'Direct Message',
            type: 'DM',
          },
        };

        const result = formatEnvironmentContext(dmEnvironment);

        expect(result).toMatch(/^<current_situation>\n/);
        expect(result).toMatch(/\n<\/current_situation>$/);
      });

      it('should have properly closed XML tags', () => {
        const guildEnvironment: DiscordEnvironment = {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Test Server' },
          channel: { id: 'channel-1', name: 'general', type: 'text' },
        };

        const result = formatEnvironmentContext(guildEnvironment);

        // Count opening and closing tags
        const openTags = (result.match(/<current_situation>/g) || []).length;
        const closeTags = (result.match(/<\/current_situation>/g) || []).length;
        expect(openTags).toBe(1);
        expect(closeTags).toBe(1);
      });
    });

    it('should format DM environment', () => {
      const dmEnvironment: DiscordEnvironment = {
        type: 'dm',
        channel: {
          id: 'dm-1',
          name: 'Direct Message',
          type: 'DM',
        },
      };

      const result = formatEnvironmentContext(dmEnvironment);

      expect(result).toContain('## Conversation Location');
      expect(result).toContain('Direct Message');
      expect(result).toContain('private one-on-one chat');
    });

    it('should format guild environment with minimal info', () => {
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

      expect(result).toContain('## Conversation Location');
      expect(result).toContain('Discord server');
      expect(result).toContain('**Server**: Test Server');
      expect(result).toContain('**Channel**: #general');
      expect(result).toContain('(text)');
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

      expect(result).toContain('**Server**: Test Server');
      expect(result).toContain('**Category**: Community');
      expect(result).toContain('**Channel**: #general');
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
        },
      };

      const result = formatEnvironmentContext(threadEnvironment);

      expect(result).toContain('**Thread**: Discussion Thread');
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
        },
      };

      const result = formatEnvironmentContext(fullGuildEnvironment);

      expect(result).toContain('**Server**: Test Server');
      expect(result).toContain('**Category**: Community');
      expect(result).toContain('**Channel**: #general');
      expect(result).toContain('**Thread**: Discussion Thread');
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

      expect(result).not.toContain('**Category**:');
      expect(result).toContain('**Server**: Test Server');
      expect(result).toContain('**Channel**: #general');
    });
  });
});
