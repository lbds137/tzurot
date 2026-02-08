/**
 * Tests for environmentFormatter
 *
 * Tests the shared location formatting function used by both
 * bot-client (for referenced messages) and ai-worker (for current context).
 */

import { describe, it, expect } from 'vitest';
import { formatLocationAsXml } from './environmentFormatter.js';
import type { DiscordEnvironment } from '../types/schemas/index.js';

describe('formatLocationAsXml', () => {
  describe('DM formatting', () => {
    it('should format DM environment', () => {
      const environment: DiscordEnvironment = {
        type: 'dm',
        channel: { id: 'dm-123', name: 'Direct Message', type: 'dm' },
      };

      const result = formatLocationAsXml(environment);

      expect(result).toBe(
        '<location type="dm">Direct Message (private one-on-one chat)</location>'
      );
    });
  });

  describe('Guild formatting', () => {
    it('should format basic guild environment', () => {
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-123', name: 'Test Server' },
        channel: { id: 'channel-456', name: 'general', type: 'text' },
      };

      const result = formatLocationAsXml(environment);

      expect(result).toContain('<location type="guild">');
      expect(result).toContain('<server name="Test Server"/>');
      expect(result).toContain('<channel name="general" type="text"/>');
      expect(result).toContain('</location>');
    });

    it('should include category when present', () => {
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-123', name: 'Test Server' },
        category: { id: 'cat-789', name: 'General' },
        channel: { id: 'channel-456', name: 'chat', type: 'text' },
      };

      const result = formatLocationAsXml(environment);

      expect(result).toContain('<category name="General"/>');
    });

    it('should include thread when present', () => {
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-123', name: 'Test Server' },
        channel: { id: 'channel-456', name: 'general', type: 'text' },
        thread: {
          id: 'thread-111',
          name: 'Discussion',
          parentChannel: { id: 'channel-456', name: 'general', type: 'text' },
        },
      };

      const result = formatLocationAsXml(environment);

      expect(result).toContain('<thread name="Discussion"/>');
    });

    it('should include channel topic when present', () => {
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-123', name: 'Test Server' },
        channel: {
          id: 'channel-456',
          name: 'announcements',
          type: 'announcement',
          topic: 'Important updates',
        },
      };

      const result = formatLocationAsXml(environment);

      expect(result).toContain(
        '<channel name="announcements" type="announcement" topic="Important updates"/>'
      );
    });

    it('should escape XML special characters in names', () => {
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-123', name: 'Test & Server <cool>' },
        channel: { id: 'channel-456', name: 'general', type: 'text' },
      };

      const result = formatLocationAsXml(environment);

      // XML entities should be escaped
      expect(result).toContain('<server name="Test &amp; Server &lt;cool&gt;"/>');
    });

    it('should handle all components together', () => {
      const environment: DiscordEnvironment = {
        type: 'guild',
        guild: { id: 'guild-123', name: 'My Server' },
        category: { id: 'cat-789', name: 'Gaming' },
        channel: { id: 'channel-456', name: 'minecraft', type: 'text', topic: 'Minecraft chat' },
        thread: {
          id: 'thread-111',
          name: 'Build Ideas',
          parentChannel: { id: 'channel-456', name: 'minecraft', type: 'text' },
        },
      };

      const result = formatLocationAsXml(environment);

      // Verify structure order
      const lines = result.split('\n');
      expect(lines[0]).toBe('<location type="guild">');
      expect(lines[1]).toBe('<server name="My Server"/>');
      expect(lines[2]).toBe('<category name="Gaming"/>');
      expect(lines[3]).toBe('<channel name="minecraft" type="text" topic="Minecraft chat"/>');
      expect(lines[4]).toBe('<thread name="Build Ideas"/>');
      expect(lines[5]).toBe('</location>');
    });

    it('should handle guild without explicit guild info', () => {
      const environment: DiscordEnvironment = {
        type: 'guild',
        channel: { id: 'channel-456', name: 'general', type: 'text' },
      };

      const result = formatLocationAsXml(environment);

      expect(result).toContain('<location type="guild">');
      expect(result).toContain('<channel name="general" type="text"/>');
      expect(result).not.toContain('<server');
    });
  });
});
