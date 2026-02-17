/**
 * Shapes Export Formatters
 *
 * Formats shapes.inc export data as JSON or Markdown.
 * Moved from bot-client to ai-worker since export formatting now
 * happens in the async job processor, not the Discord command.
 */

import type {
  ShapesIncPersonalityConfig,
  ShapesIncMemory,
  ShapesIncStory,
  ShapesIncUserPersonalization,
} from '@tzurot/common-types';

// ============================================================================
// Types
// ============================================================================

export interface ExportPayload {
  exportedAt: string;
  sourceSlug: string;
  config: ShapesIncPersonalityConfig;
  memories: ShapesIncMemory[];
  stories: ShapesIncStory[];
  userPersonalization: ShapesIncUserPersonalization | null;
  stats: {
    memoriesCount: number;
    storiesCount: number;
    pagesTraversed: number;
    hasUserPersonalization: boolean;
  };
}

// ============================================================================
// JSON formatter
// ============================================================================

export function formatExportAsJson(data: ExportPayload): string {
  return JSON.stringify(data, null, 2);
}

// ============================================================================
// Markdown formatter
// ============================================================================

/** Key personality config fields to include in markdown export */
const PERSONALITY_FIELDS: readonly { key: string; label: string }[] = [
  { key: 'personality_traits', label: 'Personality Traits' },
  { key: 'personality_tone', label: 'Tone' },
  { key: 'personality_age', label: 'Age' },
  { key: 'personality_appearance', label: 'Appearance' },
  { key: 'personality_likes', label: 'Likes' },
  { key: 'personality_dislikes', label: 'Dislikes' },
  { key: 'personality_conversational_goals', label: 'Conversational Goals' },
  { key: 'personality_conversational_examples', label: 'Conversational Examples' },
  { key: 'personality_history', label: 'History' },
] as const;

/** Extract a string field from the config */
function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatConfigSection(config: ShapesIncPersonalityConfig, sourceSlug: string): string[] {
  // ShapesIncPersonalityConfig has [key: string]: unknown, so Record access is safe
  const rec = config as unknown as Record<string, unknown>;
  const lines: string[] = [];
  const name = configString(rec, 'name') ?? sourceSlug;
  lines.push(`# ${name}`, '');

  const jailbreak = configString(rec, 'jailbreak');
  if (jailbreak !== undefined) {
    lines.push('## System Prompt', '', jailbreak, '');
  }

  const userPrompt = configString(rec, 'user_prompt');
  if (userPrompt !== undefined) {
    lines.push('## Character Info', '', userPrompt, '');
  }

  const personalityLines = PERSONALITY_FIELDS.map(({ key, label }) => ({
    label,
    value: configString(rec, key),
  }))
    .filter((f): f is { label: string; value: string } => f.value !== undefined)
    .map(({ label, value }) => `### ${label}\n\n${value}`);

  if (personalityLines.length > 0) {
    lines.push('## Personality', '', personalityLines.join('\n\n'), '');
  }

  return lines;
}

function formatMemoriesSection(memories: ShapesIncMemory[]): string[] {
  if (memories.length === 0) {
    return [];
  }

  const lines = ['## Memories', '', `*${String(memories.length)} conversation memories*`, ''];

  for (const memory of memories) {
    const iso = new Date(memory.metadata.created_at * 1000).toISOString();
    const date = `${iso.split('T')[0]} ${iso.split('T')[1].slice(0, 5)}`;
    const senders = memory.senders.length > 0 ? ` (${memory.senders.join(', ')})` : '';
    lines.push(`- **${date}**${senders}: ${memory.result.trim()}`);
  }
  lines.push('');
  return lines;
}

function formatStoriesSection(stories: ShapesIncStory[]): string[] {
  if (stories.length === 0) {
    return [];
  }

  const lines = ['## Knowledge Base', ''];
  for (const story of stories) {
    const hasTitle = story.title !== undefined && story.title !== '';
    const title = hasTitle ? story.title : `(${story.story_type})`;
    lines.push(`### ${title}`, '', story.content, '');
  }
  return lines;
}

export function formatExportAsMarkdown(data: ExportPayload): string {
  const lines: string[] = [];

  lines.push(`> Exported from shapes.inc on ${data.exportedAt}`, '');
  lines.push(...formatConfigSection(data.config, data.sourceSlug));

  // User personalization
  if (data.userPersonalization !== null) {
    const backstory = configString(
      data.userPersonalization as unknown as Record<string, unknown>,
      'backstory'
    );
    if (backstory !== undefined) {
      lines.push('## User Personalization', '', backstory, '');
    }
  }

  lines.push(...formatStoriesSection(data.stories));
  lines.push(...formatMemoriesSection(data.memories));

  // Stats footer
  lines.push(
    '---',
    '',
    `Memories: ${String(data.stats.memoriesCount)} | ` +
      `Stories: ${String(data.stats.storiesCount)} | ` +
      `User Personalization: ${data.stats.hasUserPersonalization ? 'Yes' : 'No'}`
  );

  return lines.join('\n');
}
