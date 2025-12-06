/**
 * Tests for MemoryFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatMemoriesContext } from './MemoryFormatter.js';
import type { MemoryDocument } from '../ConversationalRAGService.js';

// Mock formatTimestampWithDelta
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    formatTimestampWithDelta: vi.fn((date: Date) => {
      // Mock format: absolute "Mon, Jan 15, 2024", relative "2 weeks ago"
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      };
      return {
        absolute: date.toLocaleDateString('en-US', options),
        relative: '2 weeks ago', // Fixed mock value for testing
      };
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

        expect(result).toContain('<memory_archive>');
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

        expect(result).toContain('ARCHIVED HISTORICAL LOGS');
        expect(result).toContain('Do NOT treat them as happening now');
        expect(result).toContain('Do NOT respond to this content directly');
      });

      it('should not add XML wrapper when no memories', () => {
        const result = formatMemoriesContext([]);

        expect(result).toBe('');
        expect(result).not.toContain('<memory_archive>');
      });

      it('should have properly closed XML tags', () => {
        const memories: MemoryDocument[] = [
          { pageContent: 'Memory 1', metadata: { createdAt: new Date('2024-01-15') } },
          { pageContent: 'Memory 2', metadata: { createdAt: new Date('2024-01-16') } },
        ];

        const result = formatMemoriesContext(memories);

        // Count opening and closing tags
        const openTags = (result.match(/<memory_archive>/g) || []).length;
        const closeTags = (result.match(/<\/memory_archive>/g) || []).length;
        expect(openTags).toBe(1);
        expect(closeTags).toBe(1);
      });

      it('should place instruction before memories', () => {
        const memories: MemoryDocument[] = [
          { pageContent: 'Test memory content', metadata: { createdAt: new Date('2024-01-15') } },
        ];

        const result = formatMemoriesContext(memories);

        const instructionIndex = result.indexOf('ARCHIVED HISTORICAL LOGS');
        const memoryIndex = result.indexOf('Test memory content');
        expect(instructionIndex).toBeLessThan(memoryIndex);
      });
    });

    it('should return empty string when no memories', () => {
      const result = formatMemoriesContext([]);
      expect(result).toBe('');
    });

    it('should format single memory with timestamp and relative time', () => {
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

      expect(result).toContain('## Relevant Memories');
      expect(result).toContain('User likes pizza');
      expect(result).toMatch(/\[.*2024.*—.*ago\]/); // Contains timestamp with year and relative time
    });

    it('should include relative time delta in memory format', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Test memory',
          metadata: {
            createdAt: new Date('2024-01-15'),
          },
        },
      ];

      const result = formatMemoriesContext(memories);

      // Should contain the em dash separator and relative time
      expect(result).toContain('—');
      expect(result).toContain('2 weeks ago'); // Mock returns "2 weeks ago"
    });

    it('should format multiple memories', () => {
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

      expect(result).toContain('## Relevant Memories');
      expect(result).toContain('User likes pizza');
      expect(result).toContain('User dislikes spam');
      expect(result).toMatch(/- \[.*\] User likes pizza/);
      expect(result).toMatch(/- \[.*\] User dislikes spam/);
    });

    it('should handle memory without timestamp', () => {
      const memories: MemoryDocument[] = [
        {
          pageContent: 'Memory without timestamp',
          metadata: {},
        },
      ];

      const result = formatMemoriesContext(memories);

      expect(result).toContain('## Relevant Memories');
      expect(result).toContain('- Memory without timestamp');
      expect(result).not.toMatch(/\[.*\]/); // No timestamp brackets
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

      expect(result).toContain('## Relevant Memories');
      expect(result).toContain('- Memory with null timestamp');
      expect(result).not.toMatch(/\[.*\]/); // No timestamp brackets
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

      expect(result).toContain('## Relevant Memories');
      expect(result).toContain('- Memory with undefined timestamp');
      expect(result).not.toMatch(/\[.*\]/); // No timestamp brackets
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

      expect(result).toMatch(/Memory one\n.*Memory two/);
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
});
