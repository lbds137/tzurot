/**
 * Account Export Markdown Formatters
 *
 * Pure formatters turning assembled account-export rows into the
 * human-readable .md halves of the export ZIP (every user-readable section
 * ships as a .json/.md pair; see AccountExportFiles for the layout).
 */

import {
  type ExportProfile,
  type ExportPersona,
  type ExportCharacter,
  type ExportConversationRow,
  type ExportMemoryRow,
  type ExportFactRow,
  type ExportFeedbackRow,
  type ExportUsageSummaryRow,
} from './AccountExportAssembler.js';

/** `YYYY-MM-DD HH:MM UTC` — compact and unambiguous for export documents. */
function formatTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatClock(date: Date): string {
  return date.toISOString().slice(11, 16);
}

/** Render `label: value` lines, skipping null/undefined/empty values. */
function fieldLines(pairs: [string, string | null | undefined][]): string[] {
  return pairs
    .filter(
      (pair): pair is [string, string] =>
        pair[1] !== null && pair[1] !== undefined && pair[1] !== ''
    )
    .map(([label, value]) => `- **${label}:** ${value}`);
}

export function formatProfileMd(profile: ExportProfile): string {
  const lines = [
    '# Account Profile',
    '',
    ...fieldLines([
      ['Username', profile.username],
      ['Discord ID', profile.discordId],
      ['Timezone', profile.timezone],
      ['NSFW verified', profile.nsfwVerified ? 'yes' : 'no'],
      [
        'NSFW verified at',
        profile.nsfwVerifiedAt === null ? null : formatTimestamp(profile.nsfwVerifiedAt),
      ],
      [
        'Release notifications',
        profile.notifyEnabled ? `enabled (${profile.notifyLevel})` : 'disabled',
      ],
      ['Account created', formatTimestamp(profile.createdAt)],
    ]),
    '',
  ];
  return lines.join('\n');
}

export function formatPersonaMd(persona: ExportPersona): string {
  const lines = [
    `# ${persona.name}`,
    '',
    ...fieldLines([
      ['Preferred name', persona.preferredName],
      ['Pronouns', persona.pronouns],
      ['Created', formatTimestamp(persona.createdAt)],
    ]),
  ];
  if (persona.description !== null && persona.description !== '') {
    lines.push('', '## Description', '', persona.description);
  }
  if (persona.content !== '') {
    lines.push('', '## About', '', persona.content);
  }
  lines.push('');
  return lines.join('\n');
}

const CHARACTER_PERSONALITY_FIELDS: readonly {
  key: keyof ExportCharacter;
  label: string;
}[] = [
  { key: 'personalityTraits', label: 'Traits' },
  { key: 'personalityTone', label: 'Tone' },
  { key: 'personalityAge', label: 'Age' },
  { key: 'personalityAppearance', label: 'Appearance' },
  { key: 'personalityLikes', label: 'Likes' },
  { key: 'personalityDislikes', label: 'Dislikes' },
  { key: 'conversationalGoals', label: 'Conversational Goals' },
  { key: 'conversationalExamples', label: 'Conversational Examples' },
] as const;

export function formatCharacterMd(character: ExportCharacter): string {
  const title =
    character.displayName !== null &&
    character.displayName !== '' &&
    character.displayName !== character.name
      ? `${character.name} (${character.displayName})`
      : character.name;
  const lines = [
    `# ${title}`,
    '',
    ...fieldLines([
      ['Slug', character.slug],
      ['Public', character.isPublic ? 'yes' : 'no'],
      ['Created', formatTimestamp(character.createdAt)],
    ]),
  ];

  if (character.characterInfo !== '') {
    lines.push('', '## Character Info', '', character.characterInfo);
  }

  const personalitySections = CHARACTER_PERSONALITY_FIELDS.map(({ key, label }) => ({
    label,
    value: character[key],
  })).filter(
    (field): field is { label: string; value: string } =>
      typeof field.value === 'string' && field.value !== ''
  );
  if (personalitySections.length > 0) {
    lines.push('', '## Personality');
    for (const { label, value } of personalitySections) {
      lines.push('', `### ${label}`, '', value);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Human label for a conversation channel grouping. */
function channelHeading(row: ExportConversationRow): string {
  return row.guildId === null
    ? `Direct messages (channel ${row.channelId})`
    : `Channel ${row.channelId} (server ${row.guildId})`;
}

function speakerName(
  row: ExportConversationRow,
  characterName: string,
  personaNameById: ReadonlyMap<string, string>
): string {
  if (row.role === 'assistant') {
    return characterName;
  }
  return personaNameById.get(row.personaId) ?? 'You';
}

function messageMarkers(row: ExportConversationRow): string {
  const markers = [
    ...(row.deletedAt !== null ? ['deleted'] : []),
    ...(row.editedAt !== null ? ['edited'] : []),
  ];
  return markers.length > 0 ? ` _(${markers.join(', ')})_` : '';
}

/**
 * Transcript for one character: grouped by channel, ordered chronologically,
 * day headers with per-message clock times (sweeps return id order, which is
 * NOT chronological — the sort here is load-bearing).
 */
export function formatConversationsMd(
  characterName: string,
  rows: ExportConversationRow[],
  personaNameById: ReadonlyMap<string, string>
): string {
  const byChannel = new Map<string, ExportConversationRow[]>();
  for (const row of rows) {
    const existing = byChannel.get(row.channelId);
    if (existing === undefined) {
      byChannel.set(row.channelId, [row]);
    } else {
      existing.push(row);
    }
  }

  const lines = [
    `# Conversations — ${characterName}`,
    '',
    `*${String(rows.length)} messages across ${String(byChannel.size)} channel(s)*`,
  ];

  for (const channelRows of byChannel.values()) {
    channelRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    lines.push('', `## ${channelHeading(channelRows[0])}`);
    let currentDay = '';
    for (const row of channelRows) {
      const day = formatDay(row.createdAt);
      if (day !== currentDay) {
        currentDay = day;
        lines.push('', `### ${day}`, '');
      }
      const speaker = speakerName(row, characterName, personaNameById);
      lines.push(
        `**[${formatClock(row.createdAt)}] ${speaker}:**${messageMarkers(row)} ${row.content}`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function memoryFlags(memory: ExportMemoryRow): string[] {
  return [
    ...(memory.isLocked ? ['locked'] : []),
    ...(memory.visibility !== 'normal' ? [memory.visibility] : []),
    ...(memory.type !== 'memory' ? [memory.type] : []),
    ...(memory.isSummarized ? ['summarized'] : []),
  ];
}

export function formatMemoriesMd(characterName: string, rows: ExportMemoryRow[]): string {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lines = [`# Memories — ${characterName}`, '', `*${String(rows.length)} memories*`];
  sorted.forEach((memory, index) => {
    lines.push('', `## Memory #${String(index + 1)} — ${formatTimestamp(memory.createdAt)}`, '');
    const flags = memoryFlags(memory);
    if (flags.length > 0) {
      lines.push(`_${flags.join(' · ')}_`, '');
    }
    lines.push(memory.content);
  });
  lines.push('');
  return lines.join('\n');
}

function factBullet(fact: ExportFactRow): string {
  const details = [
    `since ${formatDay(fact.validFrom)}`,
    ...(fact.supersededAt !== null ? [`superseded ${formatDay(fact.supersededAt)}`] : []),
    ...(fact.entityTags.length > 0 ? [`tags: ${fact.entityTags.join(', ')}`] : []),
    ...(fact.isLocked ? ['locked'] : []),
  ];
  return `- ${fact.statement} — _${details.join('; ')}_`;
}

export function formatFactsMd(characterName: string, rows: ExportFactRow[]): string {
  const current = rows.filter(fact => !fact.forgotten && fact.supersededAt === null);
  const superseded = rows.filter(fact => !fact.forgotten && fact.supersededAt !== null);
  const forgotten = rows.filter(fact => fact.forgotten);

  const lines = [`# Facts — ${characterName}`];
  const sections: [string, ExportFactRow[]][] = [
    ['Current', current],
    ['Superseded', superseded],
    ['Forgotten', forgotten],
  ];
  for (const [heading, sectionRows] of sections) {
    if (sectionRows.length === 0) {
      continue;
    }
    lines.push('', `## ${heading} (${String(sectionRows.length)})`, '');
    lines.push(...sectionRows.map(factBullet));
  }
  lines.push('');
  return lines.join('\n');
}

export function formatFeedbackMd(rows: ExportFeedbackRow[]): string {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lines = [`# Feedback You Submitted`, '', `*${String(rows.length)} item(s)*`];
  for (const row of sorted) {
    lines.push('', `## ${formatTimestamp(row.createdAt)} — status: ${row.status}`, '', row.content);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatUsageSummaryMd(rows: ExportUsageSummaryRow[]): string {
  const lines = [
    '# Usage Summary',
    '',
    'Aggregate request counts per provider/model. Raw per-request logs are not exported.',
    '',
    '| Provider | Model | Requests | Tokens in | Tokens out |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.provider} | ${row.model} | ${String(row._count._all)} | ` +
        `${String(row._sum.tokensIn ?? 0)} | ${String(row._sum.tokensOut ?? 0)} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}
