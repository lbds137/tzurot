/**
 * Tests for ShapesExportFormatters
 */

import { describe, it, expect } from 'vitest';
import {
  formatExportAsJson,
  formatExportAsMarkdown,
  type ExportPayload,
} from './ShapesExportFormatters.js';

const basePayload: ExportPayload = {
  exportedAt: '2026-02-16T00:00:00.000Z',
  sourceSlug: 'test-shape',
  config: {
    id: 'shape-id',
    name: 'Test Shape',
    username: 'test-shape',
    avatar: '',
    jailbreak: 'You are Test Shape.',
    user_prompt: 'Character info here',
    personality_traits: 'Brave and kind',
    engine_model: 'gpt-4o',
    engine_temperature: 0.7,
    stm_window: 20,
    ltm_enabled: true,
    ltm_threshold: 0.3,
    ltm_max_retrieved_summaries: 5,
  },
  memories: [
    {
      id: 'mem-1',
      shape_id: 'shape-id',
      senders: ['user1', 'user2'],
      result: 'They discussed important topics.',
      metadata: { start_ts: 1000, end_ts: 2000, created_at: 1700000000, senders: ['user1'] },
    },
  ],
  stories: [
    {
      id: 'story-1',
      shape_id: 'shape-id',
      story_type: 'general',
      content: 'Once upon a time...',
    },
  ],
  userPersonalization: null,
  stats: {
    memoriesCount: 1,
    storiesCount: 1,
    pagesTraversed: 1,
    hasUserPersonalization: false,
  },
};

describe('ShapesExportFormatters', () => {
  describe('formatExportAsJson', () => {
    it('should return valid JSON', () => {
      const result = formatExportAsJson(basePayload);
      const parsed = JSON.parse(result);

      expect(parsed.sourceSlug).toBe('test-shape');
      expect(parsed.config.name).toBe('Test Shape');
      expect(parsed.memories).toHaveLength(1);
      expect(parsed.stories).toHaveLength(1);
    });

    it('should pretty-print with 2 spaces', () => {
      const result = formatExportAsJson(basePayload);
      expect(result).toContain('  "sourceSlug"');
    });
  });

  describe('formatExportAsMarkdown', () => {
    it('should include export timestamp', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('Exported from shapes.inc on 2026-02-16');
    });

    it('should include shape name as heading', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('# Test Shape');
    });

    it('should include system prompt', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('## System Prompt');
      expect(result).toContain('You are Test Shape.');
    });

    it('should include character info', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('## Character Info');
      expect(result).toContain('Character info here');
    });

    it('should include personality traits', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('### Personality Traits');
      expect(result).toContain('Brave and kind');
    });

    it('should include memories as numbered headings without senders', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('## Memories');
      expect(result).toContain('1 conversation memories');
      expect(result).toContain('### Memory #1');
      expect(result).toContain('They discussed important topics.');
      // Senders are raw UUIDs from shapes.inc — omitted until display name resolution is implemented
      expect(result).not.toContain('user1');
      expect(result).not.toContain('user2');
    });

    it('should number multiple memories sequentially', () => {
      const multiMemPayload: ExportPayload = {
        ...basePayload,
        memories: [
          {
            id: 'mem-1',
            shape_id: 'shape-id',
            senders: ['user1'],
            result: 'First memory.',
            metadata: { start_ts: 1000, end_ts: 2000, created_at: 1700000000, senders: ['user1'] },
          },
          {
            id: 'mem-2',
            shape_id: 'shape-id',
            senders: ['user2'],
            result: 'Second memory.',
            metadata: { start_ts: 3000, end_ts: 4000, created_at: 1700100000, senders: ['user2'] },
          },
        ],
        stats: { ...basePayload.stats, memoriesCount: 2 },
      };
      const result = formatExportAsMarkdown(multiMemPayload);
      expect(result).toContain('### Memory #1');
      expect(result).toContain('### Memory #2');
      expect(result).toContain('First memory.');
      expect(result).toContain('Second memory.');
    });

    it('should include stories section with title when available', () => {
      const payloadWithTitle = {
        ...basePayload,
        stories: [{ ...basePayload.stories[0], title: 'My Story Title' }],
      };
      const result = formatExportAsMarkdown(payloadWithTitle);
      expect(result).toContain('## Knowledge Base');
      expect(result).toContain('### My Story Title');
      expect(result).toContain('Once upon a time...');
    });

    it('should fall back to story_type when title is missing', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('### (general)');
    });

    it('should include stats footer', () => {
      const result = formatExportAsMarkdown(basePayload);
      expect(result).toContain('Memories: 1');
      expect(result).toContain('Stories: 1');
      expect(result).toContain('User Personalization: No');
    });

    it('should omit empty sections', () => {
      const emptyPayload = {
        ...basePayload,
        memories: [],
        stories: [],
        stats: { ...basePayload.stats, memoriesCount: 0, storiesCount: 0 },
      };
      const result = formatExportAsMarkdown(emptyPayload);
      expect(result).not.toContain('## Memories');
      expect(result).not.toContain('## Knowledge Base');
    });
  });
});
