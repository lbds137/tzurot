/**
 * Tests for ShapesExportFormatters
 */

import { describe, it, expect } from 'vitest';
import {
  formatExportAsJson,
  formatConfigSection,
  formatMemoriesSection,
  formatStoriesSection,
  formatUserPersonalizationSection,
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

  // formatExportAsMarkdown was removed as production-dead (no caller outside
  // its own test); the ZIP export (ShapesExportFiles.ts) is the product now.
  // Its old assertions are ported here onto the per-section formatters it was
  // built from. The old "export timestamp" and "stats footer" assertions are
  // not ported — they're covered by the README assertions in
  // ShapesExportFiles.test.ts (exportedAt and counts).
  describe('formatConfigSection', () => {
    it('should include shape name as heading', () => {
      const result = formatConfigSection(basePayload.config, basePayload.sourceSlug);
      expect(result).toContain('# Test Shape');
    });

    it('should include system prompt', () => {
      const result = formatConfigSection(basePayload.config, basePayload.sourceSlug);
      expect(result.join('\n')).toContain('## System Prompt');
      expect(result.join('\n')).toContain('You are Test Shape.');
    });

    it('should include character info', () => {
      const result = formatConfigSection(basePayload.config, basePayload.sourceSlug);
      expect(result.join('\n')).toContain('## Character Info');
      expect(result.join('\n')).toContain('Character info here');
    });

    it('should include personality traits', () => {
      const result = formatConfigSection(basePayload.config, basePayload.sourceSlug);
      expect(result.join('\n')).toContain('### Personality Traits');
      expect(result.join('\n')).toContain('Brave and kind');
    });
  });

  describe('formatMemoriesSection', () => {
    it('should include memories as numbered headings without senders', () => {
      const result = formatMemoriesSection(basePayload.memories).join('\n');
      expect(result).toContain('## Memories');
      expect(result).toContain('1 conversation memories');
      expect(result).toContain('### Memory #1');
      expect(result).toContain('They discussed important topics.');
      // Senders are raw UUIDs from shapes.inc — omitted until display name resolution is implemented
      expect(result).not.toContain('user1');
      expect(result).not.toContain('user2');
    });

    it('should number multiple memories sequentially', () => {
      const memories = [
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
      ];
      const result = formatMemoriesSection(memories).join('\n');
      expect(result).toContain('### Memory #1');
      expect(result).toContain('### Memory #2');
      expect(result).toContain('First memory.');
      expect(result).toContain('Second memory.');
    });

    it('returns an empty array on empty input', () => {
      expect(formatMemoriesSection([])).toEqual([]);
    });
  });

  describe('formatStoriesSection', () => {
    it('should include stories section with title when available', () => {
      const stories = [{ ...basePayload.stories[0], title: 'My Story Title' }];
      const result = formatStoriesSection(stories).join('\n');
      expect(result).toContain('## Knowledge Base');
      expect(result).toContain('### My Story Title');
      expect(result).toContain('Once upon a time...');
    });

    it('should fall back to story_type when title is missing', () => {
      const result = formatStoriesSection(basePayload.stories).join('\n');
      expect(result).toContain('### (general)');
    });

    it('returns an empty array on empty input', () => {
      expect(formatStoriesSection([])).toEqual([]);
    });
  });

  describe('formatUserPersonalizationSection', () => {
    it('returns an empty array when userPersonalization is null', () => {
      expect(formatUserPersonalizationSection(null)).toEqual([]);
    });

    it('returns the heading and bullets, with no backstory paragraph, when only name and pronouns are present', () => {
      const result = formatUserPersonalizationSection({
        backstory: '',
        preferred_name: 'Sam',
        pronouns: 'they/them',
      });
      expect(result).toEqual([
        '## User Personalization',
        '',
        '- **Preferred name:** Sam',
        '- **Pronouns:** they/them',
        '',
      ]);
    });

    it('returns the heading, bullets, and backstory paragraph when all three fields are present', () => {
      const result = formatUserPersonalizationSection({
        backstory: 'A long history together.',
        preferred_name: 'Sam',
        pronouns: 'they/them',
      });
      expect(result).toEqual([
        '## User Personalization',
        '',
        '- **Preferred name:** Sam',
        '- **Pronouns:** they/them',
        '',
        'A long history together.',
        '',
      ]);
    });

    it('returns an empty array when every field is an empty string', () => {
      expect(
        formatUserPersonalizationSection({ backstory: '', preferred_name: '', pronouns: '' })
      ).toEqual([]);
    });
  });
});
