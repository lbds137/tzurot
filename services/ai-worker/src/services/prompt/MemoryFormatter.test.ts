/**
 * Tests for MemoryFormatter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatMemoriesContext } from './MemoryFormatter.js';
import type { MemoryDocument } from '../ConversationalRAGService.js';

// Mock formatMemoryTimestamp
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    formatMemoryTimestamp: vi.fn((date: Date) => {
      // Mock format: "Mon, Jan 15, 2024"
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      };
      return date.toLocaleDateString('en-US', options);
    }),
  };
});

describe('MemoryFormatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatMemoriesContext', () => {
    it('should return empty string when no memories', () => {
      const result = formatMemoriesContext([]);
      expect(result).toBe('');
    });

    it('should format single memory with timestamp', () => {
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
      expect(result).toMatch(/\[.*2024\]/); // Contains timestamp with year
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
