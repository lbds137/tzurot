/**
 * Shapes Export Formatters
 *
 * Formats shapes.inc export data as JSON, plus per-section Markdown
 * formatters consumed by ShapesExportFiles.ts to build the ZIP's
 * `.json`/`.md` file pairs. Moved from bot-client to ai-worker since export
 * formatting now happens in the async job processor, not the Discord command.
 */

import {
  type ShapesIncPersonalityConfig,
  type ShapesIncMemory,
  type ShapesIncStory,
  type ShapesIncUserPersonalization,
} from '@tzurot/common-types/types/shapes-import';
import { formatDateOnly } from '@tzurot/common-types/utils/dateFormatting';

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

export function formatConfigSection(
  config: ShapesIncPersonalityConfig,
  sourceSlug: string
): string[] {
  // ShapesIncPersonalityConfig has [key: string]: unknown, so Record access is safe
  const rec = config as Record<string, unknown>;
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

export function formatMemoriesSection(memories: ShapesIncMemory[]): string[] {
  if (memories.length === 0) {
    return [];
  }

  const lines = ['## Memories', '', `*${String(memories.length)} conversation memories*`, ''];

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    const memoryDate = new Date(memory.metadata.created_at * 1000);
    const datePart = formatDateOnly(memoryDate, 'UTC');
    const timePart = memoryDate.toISOString().split('T')[1].slice(0, 5);
    const date = `${datePart} ${timePart}`;
    lines.push(`### Memory #${String(i + 1)} (${date})`, '', memory.result.trim(), '');
  }
  return lines;
}

export function formatStoriesSection(stories: ShapesIncStory[]): string[] {
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

/** User-personalization section: empty when unset or when no field carries text. */
export function formatUserPersonalizationSection(
  userPersonalization: ShapesIncUserPersonalization | null
): string[] {
  if (userPersonalization === null) {
    return [];
  }
  const preferredName = configString(userPersonalization, 'preferred_name');
  const pronouns = configString(userPersonalization, 'pronouns');
  const backstory = configString(userPersonalization, 'backstory');
  if (preferredName === undefined && pronouns === undefined && backstory === undefined) {
    return [];
  }

  const lines = ['## User Personalization', ''];
  if (preferredName !== undefined) {
    lines.push(`- **Preferred name:** ${preferredName}`);
  }
  if (pronouns !== undefined) {
    lines.push(`- **Pronouns:** ${pronouns}`);
  }
  if (backstory !== undefined) {
    lines.push('', backstory);
  }
  lines.push('');
  return lines;
}
