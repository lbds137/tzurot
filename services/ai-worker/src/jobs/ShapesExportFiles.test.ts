/**
 * Tests for ShapesExportFiles
 */

import { describe, it, expect } from 'vitest';
import { buildShapesExportFiles } from './ShapesExportFiles.js';
import { formatExportAsJson, type ExportPayload } from './ShapesExportFormatters.js';

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

const payloadWithPersonalization: ExportPayload = {
  ...basePayload,
  userPersonalization: {
    backstory: 'A long history together.',
    preferred_name: 'Sam',
    pronouns: 'they/them',
  },
  stats: { ...basePayload.stats, hasUserPersonalization: true },
};

describe('buildShapesExportFiles', () => {
  it('produces the expected entry names without personalization', () => {
    const files = buildShapesExportFiles(basePayload);
    expect(Object.keys(files).sort()).toEqual(
      [
        'README.md',
        'config.json',
        'config.md',
        'memories.json',
        'memories.md',
        'knowledge-base.json',
        'knowledge-base.md',
        'export.json',
      ].sort()
    );
  });

  it('produces the expected entry names with personalization', () => {
    const files = buildShapesExportFiles(payloadWithPersonalization);
    expect(Object.keys(files).sort()).toEqual(
      [
        'README.md',
        'config.json',
        'config.md',
        'memories.json',
        'memories.md',
        'knowledge-base.json',
        'knowledge-base.md',
        'user-personalization.json',
        'user-personalization.md',
        'export.json',
      ].sort()
    );
  });

  it('export.json is byte-identical to the whole-payload JSON formatter', () => {
    const files = buildShapesExportFiles(basePayload);
    expect(files['export.json']).toBe(formatExportAsJson(basePayload));
  });

  it('config.md carries a distinctive substring from the config section', () => {
    const files = buildShapesExportFiles(basePayload);
    expect(files['config.md']).toContain('# Test Shape');
    expect(files['config.md']).toContain('You are Test Shape.');
  });

  it('memories.md carries a distinctive substring from the memories section', () => {
    const files = buildShapesExportFiles(basePayload);
    expect(files['memories.md']).toContain('## Memories');
    expect(files['memories.md']).toContain('They discussed important topics.');
  });

  it('knowledge-base.md carries a distinctive substring from the stories section', () => {
    const files = buildShapesExportFiles(basePayload);
    expect(files['knowledge-base.md']).toContain('## Knowledge Base');
    expect(files['knowledge-base.md']).toContain('Once upon a time...');
  });

  it('README carries the slug, exportedAt, and counts', () => {
    const files = buildShapesExportFiles(basePayload);
    expect(files['README.md']).toContain('test-shape');
    expect(files['README.md']).toContain('2026-02-16T00:00:00.000Z');
    expect(files['README.md']).toContain('**Memories:** 1');
    expect(files['README.md']).toContain('**Stories:** 1');
    expect(files['README.md']).toContain('**User personalization:** No');
  });

  it('README reflects "Yes" when personalization is present', () => {
    const files = buildShapesExportFiles(payloadWithPersonalization);
    expect(files['README.md']).toContain('**User personalization:** Yes');
  });

  it('README heading carries the raw slug even when it is not filename-safe', () => {
    const files = buildShapesExportFiles({ ...basePayload, sourceSlug: 'odd slug' });
    expect(files['README.md']).toContain('# Shapes.inc Export: odd slug');
  });
});
