import { describe, it, expect } from 'vitest';
import type {
  ExportCharacter,
  ExportConversationRow,
  ExportFactRow,
  ExportFeedbackRow,
  ExportMemoryRow,
  ExportPersona,
  ExportProfile,
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

function makeConversationRow(overrides: Partial<ExportConversationRow>): ExportConversationRow {
  return {
    id: 'msg-1',
    channelId: 'chan-1',
    guildId: null,
    personalityId: 'char-1',
    personaId: 'persona-1',
    role: 'user',
    content: 'hello',
    createdAt: new Date('2026-07-14T10:00:00Z'),
    deletedAt: null,
    editedAt: null,
    ...overrides,
  } as ExportConversationRow;
}

function makeMemoryRow(overrides: Partial<ExportMemoryRow>): ExportMemoryRow {
  return {
    id: 'mem-1',
    personalityId: 'char-1',
    content: 'a shared moment',
    createdAt: new Date('2026-07-14T10:00:00Z'),
    isLocked: false,
    visibility: 'normal',
    type: 'memory',
    isSummarized: false,
    ...overrides,
  } as ExportMemoryRow;
}

function makeFactRow(overrides: Partial<ExportFactRow>): ExportFactRow {
  return {
    id: 'fact-1',
    statement: 'Alice likes tea',
    validFrom: new Date('2026-06-01T00:00:00Z'),
    supersededAt: null,
    forgotten: false,
    entityTags: [],
    isLocked: false,
    ...overrides,
  } as ExportFactRow;
}

describe('formatProfileMd', () => {
  it('renders populated fields and skips nulls', () => {
    const md = formatProfileMd({
      username: 'alice',
      discordId: '123',
      timezone: 'America/New_York',
      nsfwVerified: false,
      nsfwVerifiedAt: null,
      notifyEnabled: false,
      notifyLevel: 'minor',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    } as ExportProfile);

    expect(md).toContain('# Account Profile');
    expect(md).toContain('**Username:** alice');
    expect(md).toContain('**Timezone:** America/New_York');
    expect(md).toContain('**Release notifications:** disabled');
    expect(md).not.toContain('NSFW verified at');
  });
});

describe('formatPersonaMd', () => {
  it('renders name, optional fields, and the about section', () => {
    const md = formatPersonaMd({
      id: 'p1',
      name: 'Nyx',
      preferredName: 'N',
      pronouns: 'she/her',
      description: 'short desc',
      content: 'longer about text',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ownerId: 'u1',
    } as ExportPersona);

    expect(md).toContain('# Nyx');
    expect(md).toContain('**Preferred name:** N');
    expect(md).toContain('**Pronouns:** she/her');
    expect(md).toContain('## Description\n\nshort desc');
    expect(md).toContain('## About\n\nlonger about text');
  });
});

describe('formatCharacterMd', () => {
  it('renders title with display name and only populated personality fields', () => {
    const md = formatCharacterMd({
      name: 'azura',
      displayName: 'Azura',
      slug: 'azura',
      isPublic: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      characterInfo: 'A sea spirit.',
      personalityTraits: 'calm, watchful',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
    } as ExportCharacter);

    expect(md).toContain('# azura (Azura)');
    expect(md).toContain('**Slug:** azura');
    expect(md).toContain('## Character Info\n\nA sea spirit.');
    expect(md).toContain('### Traits\n\ncalm, watchful');
    expect(md).not.toContain('### Tone');
  });
});

describe('formatConversationsMd', () => {
  const personaNames = new Map([['persona-1', 'Vee']]);

  it('sorts chronologically within a channel and adds day headers', () => {
    const md = formatConversationsMd(
      'Azura',
      [
        makeConversationRow({
          id: 'late',
          content: 'second day',
          createdAt: new Date('2026-07-15T08:00:00Z'),
        }),
        makeConversationRow({
          id: 'early',
          content: 'first day',
          createdAt: new Date('2026-07-14T10:00:00Z'),
          role: 'assistant',
        }),
      ],
      personaNames
    );

    expect(md).toContain('# Conversations — Azura');
    expect(md.indexOf('first day')).toBeLessThan(md.indexOf('second day'));
    expect(md).toContain('### 2026-07-14');
    expect(md).toContain('### 2026-07-15');
    // Assistant rows speak as the character; user rows as the persona.
    expect(md).toContain('**[10:00] Azura:** first day');
    expect(md).toContain('**[08:00] Vee:** second day');
  });

  it('labels DM channels, marks deleted/edited rows, and falls back to You', () => {
    const md = formatConversationsMd(
      'Azura',
      [
        makeConversationRow({
          personaId: 'unknown-persona',
          deletedAt: new Date('2026-07-14T11:00:00Z'),
          editedAt: new Date('2026-07-14T10:30:00Z'),
        }),
        makeConversationRow({
          id: 'msg-2',
          channelId: 'chan-2',
          guildId: 'guild-9',
          content: 'in a server',
        }),
      ],
      personaNames
    );

    expect(md).toContain('## Direct messages (channel chan-1)');
    expect(md).toContain('## Channel chan-2 (server guild-9)');
    expect(md).toContain('**[10:00] You:** _(deleted, edited)_ hello');
  });
});

describe('formatMemoriesMd', () => {
  it('numbers memories chronologically and renders a flag line only when flagged', () => {
    const md = formatMemoriesMd('Azura', [
      makeMemoryRow({
        id: 'mem-2',
        content: 'newer locked memory',
        createdAt: new Date('2026-07-15T10:00:00Z'),
        isLocked: true,
        visibility: 'deleted',
      }),
      makeMemoryRow({ content: 'older plain memory' }),
    ]);

    expect(md).toContain('# Memories — Azura');
    expect(md.indexOf('older plain memory')).toBeLessThan(md.indexOf('newer locked memory'));
    expect(md).toContain('_locked · deleted_');
    // The unflagged memory has no marker line between header and content.
    expect(md).toContain('## Memory #1 — 2026-07-14 10:00 UTC\n\nolder plain memory');
  });
});

describe('formatFactsMd', () => {
  it('buckets facts into current, superseded, and forgotten with details', () => {
    const md = formatFactsMd('Azura', [
      makeFactRow({ entityTags: ['user:alice', 'topic:tea'] }),
      makeFactRow({
        id: 'fact-2',
        statement: 'Alice liked coffee',
        supersededAt: new Date('2026-06-15T00:00:00Z'),
      }),
      makeFactRow({ id: 'fact-3', statement: 'never mind', forgotten: true }),
    ]);

    expect(md).toContain('## Current (1)');
    expect(md).toContain('- Alice likes tea — _since 2026-06-01; tags: user:alice, topic:tea_');
    expect(md).toContain('## Superseded (1)');
    expect(md).toContain('superseded 2026-06-15');
    expect(md).toContain('## Forgotten (1)');
    expect(md).toContain('- never mind');
  });

  it('omits empty buckets', () => {
    const md = formatFactsMd('Azura', [makeFactRow({})]);
    expect(md).not.toContain('## Superseded');
    expect(md).not.toContain('## Forgotten');
  });
});

describe('formatFeedbackMd', () => {
  it('renders each item with timestamp and status', () => {
    const md = formatFeedbackMd([
      {
        id: 'fb-1',
        content: 'love the bot',
        status: 'new',
        createdAt: new Date('2026-07-01T12:00:00Z'),
      } as ExportFeedbackRow,
    ]);

    expect(md).toContain('## 2026-07-01 12:00 UTC — status: new');
    expect(md).toContain('love the bot');
  });
});

describe('formatUsageSummaryMd', () => {
  it('renders a table row per provider/model with null token sums as 0', () => {
    const md = formatUsageSummaryMd([
      {
        provider: 'openrouter',
        model: 'claude-sonnet-4',
        _count: { _all: 12 },
        _sum: { tokensIn: 3400, tokensOut: null },
      },
    ]);

    expect(md).toContain('| openrouter | claude-sonnet-4 | 12 | 3400 | 0 |');
  });
});
