/**
 * Account Export File Map
 *
 * Turns assembled account-export data into the ZIP's path → text-content
 * map. Layout convention: user-readable content ships as .json/.md pairs;
 * operational metadata is JSON-only. Character-scoped content
 * (conversations, memories, facts) is foldered by character slug, covering
 * characters the user conversed with but doesn't own — the personality
 * directory provides the slug for every referenced character.
 */

import {
  type AccountExportData,
  type PersonalityDirectoryEntry,
} from './AccountExportAssembler.js';
import {
  formatCharacterMd,
  formatConversationsMd,
  formatFactsMd,
  formatFeedbackMd,
  formatMemoriesMd,
  formatPersonaMd,
  formatProfileMd,
  formatUsageSummaryMd,
} from './AccountExportMarkdown.js';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Filename stem from user-controlled text (persona names, slugs). */
function sanitizeFileStem(stem: string): string {
  const sanitized = stem.replace(/[^\w.-]/g, '_');
  return sanitized === '' ? 'unnamed' : sanitized;
}

function groupByPersonality<T extends { personalityId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const existing = groups.get(row.personalityId);
    if (existing === undefined) {
      groups.set(row.personalityId, [row]);
    } else {
      existing.push(row);
    }
  }
  return groups;
}

function directorySlug(
  directory: ReadonlyMap<string, PersonalityDirectoryEntry>,
  personalityId: string
): string {
  return sanitizeFileStem(
    directory.get(personalityId)?.slug ?? `unknown-${personalityId.slice(0, 8)}`
  );
}

function directoryName(
  directory: ReadonlyMap<string, PersonalityDirectoryEntry>,
  personalityId: string
): string {
  return directory.get(personalityId)?.name ?? 'Unknown character';
}

function buildReadme(data: AccountExportData): string {
  const counts: [string, number][] = [
    ['Personas', data.personas.length],
    ['Characters (owned or co-owned)', data.characters.length],
    ['Conversation messages', data.conversationHistory.length],
    ['Memories', data.memories.length],
    ['Facts', data.facts.length],
    ['Feedback items', data.feedback.length],
  ];
  return [
    '# Tzurot Account Export',
    '',
    `Exported: ${data.meta.exportedAt}`,
    `Format version: ${String(data.meta.formatVersion)}`,
    '',
    '## Contents',
    '',
    ...counts.map(([label, count]) => `- **${label}:** ${String(count)}`),
    '',
    'Every user-readable section ships as a `.json`/`.md` pair; operational',
    'metadata (`configs/`, `account/`) is JSON-only.',
    '',
    '- `profile.{json,md}` — your account record',
    '- `personas/` — one file per persona you authored',
    '- `characters/` — full definitions of characters you own or co-own',
    '- `conversations/`, `memories/`, `facts/` — foldered by character slug',
    '- `feedback.{json,md}`, `usage-summary.{json,md}`',
    '- `configs/` — your LLM/TTS configs and per-character overrides',
    '- `account/` — key/credential metadata, job history, release deliveries',
    '- `personality-directory.json` — id → name/slug for every character referenced above',
    '',
    '## Profile vs. personas',
    '',
    '**Profile** is your account record: Discord identity, settings, and',
    'verification state. **Personas** are the identities you authored for',
    'conversations — the name, pronouns, and self-description a character',
    'sees when talking with you.',
    '',
    '## Characters you talked with but do not own',
    '',
    'The `conversations/`, `memories/`, and `facts/` folders include every',
    'character you interacted with. Full definitions of characters you do',
    'not own belong to their owners and are not included; use',
    '`personality-directory.json` to map slugs to character names.',
    '',
    '## What is NOT included',
    '',
    ...data.meta.notes.map(note => `- ${note}`),
    '',
  ].join('\n');
}

function buildPersonaFiles(data: AccountExportData, files: Record<string, string>): void {
  for (const persona of data.personas) {
    const stem = `${sanitizeFileStem(persona.name)}-${persona.id.slice(0, 8)}`;
    files[`personas/${stem}.json`] = json(persona);
    files[`personas/${stem}.md`] = formatPersonaMd(persona);
  }
}

function buildCharacterFiles(data: AccountExportData, files: Record<string, string>): void {
  for (const character of data.characters) {
    const stem = sanitizeFileStem(character.slug);
    files[`characters/${stem}.json`] = json(character);
    files[`characters/${stem}.md`] = formatCharacterMd(character);
  }
}

function buildCharacterScopedFiles(
  data: AccountExportData,
  directory: ReadonlyMap<string, PersonalityDirectoryEntry>,
  files: Record<string, string>
): void {
  const personaNameById = new Map(
    data.personas.map(persona => [persona.id, persona.preferredName ?? persona.name])
  );

  for (const [personalityId, rows] of groupByPersonality(data.conversationHistory)) {
    const stem = directorySlug(directory, personalityId);
    const name = directoryName(directory, personalityId);
    files[`conversations/${stem}.json`] = json(rows);
    files[`conversations/${stem}.md`] = formatConversationsMd(name, rows, personaNameById);
  }
  for (const [personalityId, rows] of groupByPersonality(data.memories)) {
    const stem = directorySlug(directory, personalityId);
    files[`memories/${stem}.json`] = json(rows);
    files[`memories/${stem}.md`] = formatMemoriesMd(directoryName(directory, personalityId), rows);
  }
  for (const [personalityId, rows] of groupByPersonality(data.facts)) {
    const stem = directorySlug(directory, personalityId);
    files[`facts/${stem}.json`] = json(rows);
    files[`facts/${stem}.md`] = formatFactsMd(directoryName(directory, personalityId), rows);
  }
}

export function buildAccountExportFiles(data: AccountExportData): Record<string, string> {
  const directory = new Map(data.personalityDirectory.map(entry => [entry.id, entry]));
  const files: Record<string, string> = {};

  files['README.md'] = buildReadme(data);
  files['personality-directory.json'] = json(data.personalityDirectory);
  files['profile.json'] = json(data.profile);
  files['profile.md'] = formatProfileMd(data.profile);

  buildPersonaFiles(data, files);
  buildCharacterFiles(data, files);
  buildCharacterScopedFiles(data, directory, files);

  files['feedback.json'] = json(data.feedback);
  files['feedback.md'] = formatFeedbackMd(data.feedback);
  files['usage-summary.json'] = json(data.usageSummary);
  files['usage-summary.md'] = formatUsageSummaryMd(data.usageSummary);

  files['configs/llm.json'] = json(data.llmConfigs);
  files['configs/tts.json'] = json(data.ttsConfigs);
  files['configs/personality-overrides.json'] = json(data.personalityConfigs);
  files['configs/persona-history.json'] = json(data.personaHistoryConfigs);

  files['account/api-key-metadata.json'] = json(data.apiKeyMetadata);
  files['account/credential-metadata.json'] = json(data.credentialMetadata);
  files['account/jobs.json'] = json({ importJobs: data.importJobs, exportJobs: data.exportJobs });
  files['account/release-deliveries.json'] = json(data.releaseDeliveries);
  files['account/shapes-mappings.json'] = json(data.shapesMappings);

  return files;
}
