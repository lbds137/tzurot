/**
 * Shapes Export File Map
 *
 * Turns an assembled shapes.inc export payload into the ZIP's path →
 * text-content map. Layout convention (matching the account export): every
 * user-readable section ships as a `.json`/`.md` pair, plus a single
 * `export.json` carrying the whole payload in one file.
 */

import {
  formatConfigSection,
  formatMemoriesSection,
  formatStoriesSection,
  formatUserPersonalizationSection,
  formatExportAsJson,
  type ExportPayload,
} from './ShapesExportFormatters.js';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildReadme(payload: ExportPayload, hasPersonalizationSection: boolean): string {
  return [
    `# Shapes.inc Export: ${payload.sourceSlug}`,
    '',
    `Exported: ${payload.exportedAt}`,
    '',
    '## Contents',
    '',
    `- **Memories:** ${String(payload.stats.memoriesCount)}`,
    `- **Stories:** ${String(payload.stats.storiesCount)}`,
    `- **User personalization:** ${hasPersonalizationSection ? 'Yes' : 'No'}`,
    '',
    'Every user-readable section ships as a `.json`/`.md` pair.',
    '',
    "- `config.{json,md}` — the character's shapes.inc configuration",
    '- `memories.{json,md}` — conversation memories (the .md is omitted when there are none)',
    '- `knowledge-base.{json,md}` — knowledge-base stories (the .md is omitted when there are none)',
    '- `user-personalization.{json,md}` — your personalization for this character (present only when populated)',
    '- `export.json` — the complete export payload in one file',
  ].join('\n');
}

export function buildShapesExportFiles(payload: ExportPayload): Record<string, string> {
  const files: Record<string, string> = {};

  const personalization = formatUserPersonalizationSection(payload.userPersonalization);
  const memories = formatMemoriesSection(payload.memories);
  const stories = formatStoriesSection(payload.stories);

  files['README.md'] = buildReadme(payload, personalization.length > 0);
  files['config.json'] = json(payload.config);
  files['config.md'] = formatConfigSection(payload.config, payload.sourceSlug).join('\n');
  files['memories.json'] = json(payload.memories);
  if (memories.length > 0) {
    files['memories.md'] = memories.join('\n');
  }
  files['knowledge-base.json'] = json(payload.stories);
  if (stories.length > 0) {
    files['knowledge-base.md'] = stories.join('\n');
  }

  if (personalization.length > 0) {
    files['user-personalization.json'] = json(payload.userPersonalization);
    files['user-personalization.md'] = personalization.join('\n');
  }

  files['export.json'] = formatExportAsJson(payload);

  return files;
}
