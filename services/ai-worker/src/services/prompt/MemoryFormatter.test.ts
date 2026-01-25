/**
 * Tests for MemoryFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatMemoriesContext,
  formatSingleMemory,
  getMemoryWrapperOverheadText,
  MEMORY_ARCHIVE_INSTRUCTION,
} from './MemoryFormatter.js';
import type { MemoryDocument } from '../ConversationalRAGService.js';

// Mock formatPromptTimestamp
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    formatPromptTimestamp: vi.fn((date: Date) => {
      // Mock format: "2024-01-15 (Mon) • 2 weeks ago"
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
      };
      const day = date.toLocaleDateString('en-US', options);
      const dateStr = date.toISOString().split('T')[0];
      return `${dateStr} (${day}) • 2 weeks ago`; // Fixed mock value for testing
    }),
  };
});

describe('MemoryFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatMemoriesContext', () => {
    describe('XML wrapper and instruction', () => {
      it('should wrap output in <memory_archive> tags when memories exist', () => {
        const memories: MemoryDocument[] = [
          {
            pageContent: 'Test memory',
            metadata: { createdAt: new Date('2024-01-15') },
          },
        ];

        const result = formatMemoriesContext(memories);

        expect(result).toContain('<memory_archive usage="context_only_do_not_repeat">');
        expect(result).toContain('</memory_archive>');
      });

      it('should include historical context instruction', () => {
        const memories: MemoryDocument[] = [
          {
            pageContent: 'Test memory',
            metadata: { createdAt: new Date('2024-01-15') },
          },
        ];

        const result = formatMemoriesContext(memories);

        // Positive framing (what to do) instead of negative (what not to do)
        expect(result).toContain('SUMMARIZED NOTES from past interactions');
        expect(result).toContain('Use ONLY as background context');
        expect(result).toContain('user message');
      });

      it('should not add XML wrapper when no memories', () => {
        const result = formatMemoriesContext([]);

        expect(result).toBe('');
        expect(result).not.toContain('<memory_archive');
      });

      it('should have properly closed XML tags', () => {
        const memories: MemoryDocument[] = [
          { pageContent: 'Memory 1', metadata: { createdAt: new Date('2024-01-15') } },
          { pageContent: 'Memory 2', metadata: { createdAt: new Date('2024-01-16') } },
        ];

        const result = formatMemoriesContext(memories);

        // Count opening and closing tags
        const openTags = (result.match(/<memory_archive[^>]*>/g) || []).length;
        const closeTags = (result.match(/<\/memory_archive>/g) || []).length;
        expect(openTags).toBe(1);
        expect(closeTags).toBe(1);
      });

      it('should place instruction before memories', () => {
        const memories: MemoryDocument[] = [
          { pageContent: 'Test memory content', metadata: { createdAt: new Date('2024-01-15') } },
        ];

        const result = formatMemoriesContext(memories);

        const instructionIndex = result.indexOf('SUMMARIZED NOTES');
        const memoryIndex = result.indexOf('Test memory content');
        expect(instructionIndex).toBeLessThan(memoryIndex);
      });
    });

    it('should return empty string when no memories', () => {
      const result = formatMemoriesContext([]);
      expect(result).toBe('');
    });

    it('should format single memory with unified timestamp as XML attribute', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'User likes pizza',
          metadata: {
            id: 'mem-1',
            createdAt: new Date('2024-01-15T12:00:00Z'),
          },
        },
      ];

      const result = formatMemoriesContext(memories);

      // Uses <historical_note> tag with unified t= attribute
      expect(result).toContain('<historical_note');
      expect(result).toContain('t="');
      expect(result).toContain('User likes pizza');
      expect(result).toContain('</historical_note>');
    });

    it('should include date and relative time in unified t attribute', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Test memory',
          metadata: {
            createdAt: new Date('2024-01-15'),
          },
        },
      ];

      const result = formatMemoriesContext(memories);

      // Should contain unified format with both date and relative time
      expect(result).toContain('t="2024-01-15'); // Date part
      expect(result).toContain('2 weeks ago"'); // Relative part from mock
    });

    it('should format multiple memories as XML elements', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'User likes pizza',
          metadata: {
            id: 'mem-1',
            createdAt: new Date('2024-01-15T12:00:00Z'),
          },
        },
        {
          pageContent: 'User dislikes spam',
          metadata: {
            id: 'mem-2',
            createdAt: new Date('2024-01-20T15:30:00Z'),
          },
        },
      ];

      const result = formatMemoriesContext(memories);

      expect(result).toContain('<instruction>');
      expect(result).toContain('User likes pizza');
      expect(result).toContain('User dislikes spam');
      // Both should be wrapped in <historical_note> tags
      expect(result).toMatch(/<historical_note[^>]*>User likes pizza<\/historical_note>/);
      expect(result).toMatch(/<historical_note[^>]*>User dislikes spam<\/historical_note>/);
    });

    it('should handle memory without timestamp', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory without timestamp',
          metadata: {},
        },
      ];

      const result = formatMemoriesContext(memories);

      expect(result).toContain('<instruction>');
      // No t= attribute when no timestamp
      expect(result).toContain('<historical_note>Memory without timestamp</historical_note>');
      expect(result).not.toContain('t="');
    });

    it('should handle memory with null createdAt', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory with null timestamp',
          metadata: {
            createdAt: null,
          },
        },
      ];

      const result = formatMemoriesContext(memories);

      expect(result).toContain('<instruction>');
      expect(result).toContain('<historical_note>Memory with null timestamp</historical_note>');
      expect(result).not.toContain('t="');
    });

    it('should handle memory with undefined createdAt', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory with undefined timestamp',
          metadata: {
            createdAt: undefined,
          },
        },
      ];

      const result = formatMemoriesContext(memories);

      expect(result).toContain('<instruction>');
      expect(result).toContain(
        '<historical_note>Memory with undefined timestamp</historical_note>'
      );
      expect(result).not.toContain('t="');
    });

    it('should preserve memory order', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'First memory',
          metadata: { createdAt: new Date('2024-01-15') },
        },
        {
          pageContent: 'Second memory',
          metadata: { createdAt: new Date('2024-01-16') },
        },
        {
          pageContent: 'Third memory',
          metadata: { createdAt: new Date('2024-01-17') },
        },
      ];

      const result = formatMemoriesContext(memories);

      const firstIndex = result.indexOf('First memory');
      const secondIndex = result.indexOf('Second memory');
      const thirdIndex = result.indexOf('Third memory');

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });

    it('should separate memories with newlines', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory one',
          metadata: { createdAt: new Date('2024-01-15') },
        },
        {
          pageContent: 'Memory two',
          metadata: { createdAt: new Date('2024-01-16') },
        },
      ];

      const result = formatMemoriesContext(memories);

      // Memories should be separated by newlines (each <historical_note> on its own line)
      expect(result).toMatch(/<\/historical_note>\n<historical_note/);
    });

    it('should handle mixed memories with and without timestamps', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory with timestamp',
          metadata: { createdAt: new Date('2024-01-15') },
        },
        {
          pageContent: 'Memory without timestamp',
          metadata: {},
        },
        {
          pageContent: 'Another with timestamp',
          metadata: { createdAt: new Date('2024-01-16') },
        },
      ];

      const result = formatMemoriesContext(memories);

      expect(result).toContain('Memory with timestamp');
      expect(result).toContain('Memory without timestamp');
      expect(result).toContain('Another with timestamp');
    });
  });

  describe('formatSingleMemory', () => {
    it('should format memory with timestamp as XML with unified t attribute', () => {
      const doc: MemoryDocument = {
        pageContent: 'Test memory content',
        metadata: { createdAt: new Date('2024-01-15') },
      };

      const result = formatSingleMemory(doc);

      // Uses <historical_note> with unified t= attribute
      expect(result).toContain('<historical_note');
      expect(result).toContain('t="2024-01-15');
      expect(result).toContain('2 weeks ago"');
      expect(result).toContain('Test memory content');
      expect(result).toContain('</historical_note>');
    });

    it('should format memory without timestamp as simple XML element', () => {
      const doc: MemoryDocument = {
        pageContent: 'Test memory content',
        metadata: {},
      };

      const result = formatSingleMemory(doc);

      expect(result).toBe('<historical_note>Test memory content</historical_note>');
    });

    it('should escape protected XML tags in content', () => {
      // escapeXmlContent only escapes protected tags (memory_archive, persona, etc.)
      // not arbitrary HTML tags like <script> - this is by design to avoid breaking
      // legitimate content like "I <3 you" or "x > 5"
      const doc: MemoryDocument = {
        pageContent: 'Content with </memory_archive> injection attempt',
        metadata: {},
      };

      const result = formatSingleMemory(doc);

      // Protected closing tag should be escaped to prevent XML structure breaking
      expect(result).toContain('&lt;/memory_archive&gt;');
      expect(result).not.toContain('</memory_archive>');
    });
  });

  describe('getMemoryWrapperOverheadText', () => {
    it('should return XML wrapper with instruction and usage attribute', () => {
      const result = getMemoryWrapperOverheadText();

      expect(result).toContain('<memory_archive usage="context_only_do_not_repeat">');
      expect(result).toContain('</memory_archive>');
      expect(result).toContain('<instruction>');
      expect(result).toContain('</instruction>');
    });

    it('should include the archive instruction text', () => {
      const result = getMemoryWrapperOverheadText();

      expect(result).toContain(MEMORY_ARCHIVE_INSTRUCTION);
    });
  });

  describe('MEMORY_ARCHIVE_INSTRUCTION', () => {
    it('should contain positive framing (what to do, not what not to do)', () => {
      // Positive framing works better for LLMs than negative constraints
      expect(MEMORY_ARCHIVE_INSTRUCTION).toContain('SUMMARIZED NOTES from past interactions');
      expect(MEMORY_ARCHIVE_INSTRUCTION).toContain('Use ONLY as background context');
      expect(MEMORY_ARCHIVE_INSTRUCTION).toContain('user message');
    });
  });
});
