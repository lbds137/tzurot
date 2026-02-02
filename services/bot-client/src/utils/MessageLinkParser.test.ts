/**
 * Tests for MessageLinkParser
 */

import { describe, it, expect } from 'vitest';
import { MessageLinkParser } from './MessageLinkParser.js';

describe('MessageLinkParser', () => {
  describe('parseMessageLinks', () => {
    it('should parse standard discord.com link', () => {
      const content = 'Check out https://discord.com/channels/123456/789012/345678';
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        guildId: '123456',
        channelId: '789012',
        messageId: '345678',
        fullUrl: 'https://discord.com/channels/123456/789012/345678',
      });
    });

    it('should parse ptb.discord.com link', () => {
      const content = 'https://ptb.discord.com/channels/111/222/333';
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].guildId).toBe('111');
    });

    it('should parse canary.discord.com link', () => {
      const content = 'https://canary.discord.com/channels/444/555/666';
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].channelId).toBe('555');
    });

    it('should parse discordapp.com link', () => {
      const content = 'https://discordapp.com/channels/777/888/999';
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].messageId).toBe('999');
    });

    it('should parse multiple links', () => {
      const content = `
        First: https://discord.com/channels/1/2/3
        Second: https://discord.com/channels/4/5/6
        Third: https://discord.com/channels/7/8/9
      `;
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(3);
      expect(links[0].messageId).toBe('3');
      expect(links[1].messageId).toBe('6');
      expect(links[2].messageId).toBe('9');
    });

    it('should handle content with no links', () => {
      const content = 'Just a regular message with no links';
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(0);
    });

    it('should handle empty content', () => {
      const links = MessageLinkParser.parseMessageLinks('');

      expect(links).toHaveLength(0);
    });

    it('should not parse invalid URLs', () => {
      const content = `
        Not a link: discord.com/channels/1/2/3
        Missing protocol: www.discord.com/channels/4/5/6
        Wrong domain: https://example.com/channels/7/8/9
      `;
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(0);
    });

    it('should handle mixed valid and invalid content', () => {
      const content = `
        Valid: https://discord.com/channels/1/2/3
        Invalid: discord.com/channels/4/5/6
        Valid: https://discord.com/channels/7/8/9
      `;
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(2);
    });

    it('should parse links with surrounding text', () => {
      const content = 'Before https://discord.com/channels/1/2/3 after';
      const links = MessageLinkParser.parseMessageLinks(content);

      expect(links).toHaveLength(1);
      expect(links[0].fullUrl).toBe('https://discord.com/channels/1/2/3');
    });

    it('should handle duplicate links', () => {
      const url = 'https://discord.com/channels/1/2/3';
      const content = `${url} and ${url} again`;
      const links = MessageLinkParser.parseMessageLinks(content);

      // Should find both occurrences
      expect(links).toHaveLength(2);
      expect(links[0].messageId).toBe('3');
      expect(links[1].messageId).toBe('3');
    });
  });

  describe('replaceLinksWithReferences', () => {
    it('should replace single link with reference', () => {
      const content = 'Check out https://discord.com/channels/1/2/3';
      const linkMap = new Map([['https://discord.com/channels/1/2/3', 1]]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toBe('Check out [Reference 1]');
    });

    it('should replace multiple links with correct numbers', () => {
      const content = `
        First: https://discord.com/channels/1/2/3
        Second: https://discord.com/channels/4/5/6
      `;
      const linkMap = new Map([
        ['https://discord.com/channels/1/2/3', 1],
        ['https://discord.com/channels/4/5/6', 2],
      ]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toContain('First: [Reference 1]');
      expect(result).toContain('Second: [Reference 2]');
    });

    it('should preserve non-link text', () => {
      const content = 'Before https://discord.com/channels/1/2/3 after';
      const linkMap = new Map([['https://discord.com/channels/1/2/3', 1]]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toBe('Before [Reference 1] after');
    });

    it('should handle empty link map', () => {
      const content = 'No links to replace https://discord.com/channels/1/2/3';
      const linkMap = new Map();

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toBe(content);
    });

    it('should handle content with no links', () => {
      const content = 'Just regular text';
      const linkMap = new Map([['https://discord.com/channels/1/2/3', 1]]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toBe(content);
    });

    it('should replace longest URLs first to avoid partial matches', () => {
      // This ensures we don't partially replace a longer URL
      const content = 'https://discord.com/channels/123/456/789';
      const linkMap = new Map([['https://discord.com/channels/123/456/789', 1]]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toBe('[Reference 1]');
      expect(result).not.toContain('discord.com');
    });

    it('should replace duplicate links consistently', () => {
      const url = 'https://discord.com/channels/1/2/3';
      const content = `${url} and ${url}`;
      const linkMap = new Map([[url, 1]]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toBe('[Reference 1] and [Reference 1]');
    });

    it('should handle different URL formats', () => {
      const content = `
        PTB: https://ptb.discord.com/channels/1/2/3
        Canary: https://canary.discord.com/channels/4/5/6
        App: https://discordapp.com/channels/7/8/9
      `;
      const linkMap = new Map([
        ['https://ptb.discord.com/channels/1/2/3', 1],
        ['https://canary.discord.com/channels/4/5/6', 2],
        ['https://discordapp.com/channels/7/8/9', 3],
      ]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toContain('PTB: [Reference 1]');
      expect(result).toContain('Canary: [Reference 2]');
      expect(result).toContain('App: [Reference 3]');
    });

    it('should handle links at start and end of content', () => {
      const url1 = 'https://discord.com/channels/1/2/3';
      const url2 = 'https://discord.com/channels/4/5/6';
      const content = `${url1} middle text ${url2}`;
      const linkMap = new Map([
        [url1, 1],
        [url2, 2],
      ]);

      const result = MessageLinkParser.replaceLinksWithReferences(content, linkMap);

      expect(result).toBe('[Reference 1] middle text [Reference 2]');
    });
  });

  describe('Integration: parse and replace', () => {
    it('should parse links and replace them with references', () => {
      const originalContent = `
        Check https://discord.com/channels/1/2/3
        and https://discord.com/channels/4/5/6
      `.trim();

      // Parse links
      const links = MessageLinkParser.parseMessageLinks(originalContent);

      // Create link map
      const linkMap = new Map(links.map((link, index) => [link.fullUrl, index + 1]));

      // Replace
      const result = MessageLinkParser.replaceLinksWithReferences(originalContent, linkMap);

      expect(result).toContain('Reference 1');
      expect(result).toContain('Reference 2');
      expect(result).not.toContain('discord.com');
    });
  });
});
