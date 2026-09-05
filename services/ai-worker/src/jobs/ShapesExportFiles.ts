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

function buildReadme(payload: ExportPayload): string {
  return [
    `# Shapes.inc Export: ${payload.sourceSlug}`,
    '',
    `Exported: ${payload.exportedAt}`,
    '',
    '## Contents',
    '',
    `- **Memories:** ${String(payload.stats.memoriesCount)}`,
    `- **Stories:** ${String(payload.stats.storiesCount)}`,
    `- **User personalization:** ${payload.stats.hasUserPersonalization ? 'Yes' : 'No'}`,
    '',
    'Every user-readable section ships as a `.json`/`.md` pair.',
    '',
    "- `config.{json,md}` — the character's shapes.inc configuration",
    '- `memories.{json,md}` — conversation memories',
    '- `knowledge-base.{json,md}` — knowledge-base stories',
    '- `user-personalization.{json,md}` — your personalization for this character (present only when set)',
    '- `export.json` — the complete export payload in one file',
  ].join('\n');
}

export function buildShapesExportFiles(payload: ExportPayload): Record<string, string> {
  const files: Record<string, string> = {};

  files['README.md'] = buildReadme(payload);
  files['config.json'] = json(payload.config);
  files['config.md'] = formatConfigSection(payload.config, payload.sourceSlug).join('\n');
  files['memories.json'] = json(payload.memories);
  files['memories.md'] = formatMemoriesSection(payload.memories).join('\n');
  files['knowledge-base.json'] = json(payload.stories);
  files['knowledge-base.md'] = formatStoriesSection(payload.stories).join('\n');

  if (payload.userPersonalization !== null) {
    files['user-personalization.json'] = json(payload.userPersonalization);
    files['user-personalization.md'] = formatUserPersonalizationSection(
      payload.userPersonalization
    ).join('\n');
  }

  files['export.json'] = formatExportAsJson(payload);

  return files;
}
