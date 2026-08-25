import { describe, expect, it } from 'vitest';
import {
  ExportCharacterSchema,
  ExportConversationRowSchema,
  ExportFactRowSchema,
  ExportFeedbackRowSchema,
  ExportMemoryRowSchema,
  ExportPersonaSchema,
  ExportProfileSchema,
  ExportUsageSummaryRowSchema,
  PersonalityDirectoryEntrySchema,
  PersonalityDirectorySchema,
} from './accountExportCoreSchemas.js';

describe('accountExportCoreSchemas', () => {
  it('parses a valid personality directory entry', () => {
    const result = PersonalityDirectoryEntrySchema.safeParse({
      id: 'p1',
      name: 'Test Character',
      slug: 'test-character',
    });
    expect(result.success).toBe(true);
  });

  it('parses an array of personality directory entries', () => {
    const result = PersonalityDirectorySchema.safeParse([
      { id: 'p1', name: 'A', slug: 'a' },
      { id: 'p2', name: 'B', slug: 'b' },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects a personality directory entry with an unrecognized key (drift guard)', () => {
    const result = PersonalityDirectoryEntrySchema.safeParse({
      id: 'p1',
      name: 'Test Character',
      slug: 'test-character',
      extraField: 'unexpected',
    });
    expect(result.success).toBe(false);
  });

  it('parses a valid profile without isSuperuser', () => {
    const result = ExportProfileSchema.safeParse({
      discordId: '123456789012345678',
      username: 'testuser',
      timezone: 'UTC',
      nsfwVerified: false,
      nsfwVerifiedAt: null,
      notifyEnabled: true,
      notifyLevel: 'major',
      createdAt: '2026-01-01T00:00:00.000Z',
      configDefaults: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a profile carrying isSuperuser (must be stripped before serialization)', () => {
    const result = ExportProfileSchema.safeParse({
      discordId: '123456789012345678',
      username: 'testuser',
      timezone: 'UTC',
      nsfwVerified: false,
      nsfwVerifiedAt: null,
      notifyEnabled: true,
      notifyLevel: 'major',
      createdAt: '2026-01-01T00:00:00.000Z',
      configDefaults: null,
      isSuperuser: true,
    });
    expect(result.success).toBe(false);
  });

  it('parses a valid persona row', () => {
    const result = ExportPersonaSchema.safeParse({
      id: 'persona-1',
      name: 'Alex',
      description: null,
      content: 'A persona description.',
      preferredName: null,
      pronouns: null,
      ownerId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid character row without avatarData/voiceReferenceData', () => {
    const result = ExportCharacterSchema.safeParse({
      id: 'char-1',
      name: 'Character',
      displayName: null,
      slug: 'character',
      systemPromptId: null,
      ownerId: 'user-1',
      characterInfo: 'info',
      personalityTraits: 'traits',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      customFields: null,
      errorMessage: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      isPublic: true,
      definitionPublic: false,
      voiceEnabled: false,
      voiceSettings: null,
      imageEnabled: false,
      imageSettings: null,
      voiceReferenceType: null,
      configDefaults: null,
      originalOwnerDiscordId: null,
      tags: [],
      rosterBlurb: null,
      rosterBlurbSourceHash: null,
      cardSourceHash: null,
      rosterBlurbAttempts: 0,
      rosterBlurbLastFailedAt: null,
      rosterBlurbFailedSourceHash: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a character row carrying avatarData (must never reach the export)', () => {
    const base = {
      id: 'char-1',
      name: 'Character',
      displayName: null,
      slug: 'character',
      systemPromptId: null,
      ownerId: 'user-1',
      characterInfo: 'info',
      personalityTraits: 'traits',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      customFields: null,
      errorMessage: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      isPublic: true,
      definitionPublic: false,
      voiceEnabled: false,
      voiceSettings: null,
      imageEnabled: false,
      imageSettings: null,
      voiceReferenceType: null,
      configDefaults: null,
      originalOwnerDiscordId: null,
      tags: [],
      rosterBlurb: null,
      rosterBlurbSourceHash: null,
      cardSourceHash: null,
      rosterBlurbAttempts: 0,
      rosterBlurbLastFailedAt: null,
      rosterBlurbFailedSourceHash: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = ExportCharacterSchema.safeParse({ ...base, avatarData: 'binary' });
    expect(result.success).toBe(false);
  });

  it('parses a valid conversation row', () => {
    const result = ExportConversationRowSchema.safeParse({
      id: 'conv-1',
      channelId: 'chan-1',
      guildId: null,
      personalityId: 'char-1',
      personaId: 'persona-1',
      role: 'user',
      content: 'hello',
      tokenCount: null,
      discordMessageId: ['830000000000000001'],
      messageMetadata: {},
      thinkingContent: null,
      deletedAt: null,
      editedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid memory row without an embedding field', () => {
    const result = ExportMemoryRowSchema.safeParse({
      id: 'mem-1',
      personaId: 'persona-1',
      personalityId: 'char-1',
      content: 'a memory',
      isSummarized: false,
      originalMessageCount: null,
      summarizedAt: null,
      sessionId: null,
      canonScope: null,
      summaryType: null,
      channelId: null,
      guildId: null,
      messageIds: [],
      senders: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      legacyShapesUserId: null,
      sourceSystem: 'tzurot-v3',
      type: 'memory',
      isLocked: false,
      visibility: 'normal',
      pool: 'private',
      canonGroupId: null,
      isFiction: false,
      chunkGroupId: null,
      chunkIndex: null,
      totalChunks: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a memory row carrying an embedding field (must never reach the export)', () => {
    const result = ExportMemoryRowSchema.safeParse({
      id: 'mem-1',
      personaId: 'persona-1',
      personalityId: 'char-1',
      content: 'a memory',
      isSummarized: false,
      originalMessageCount: null,
      summarizedAt: null,
      sessionId: null,
      canonScope: null,
      summaryType: null,
      channelId: null,
      guildId: null,
      messageIds: [],
      senders: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      legacyShapesUserId: null,
      sourceSystem: 'tzurot-v3',
      type: 'memory',
      isLocked: false,
      visibility: 'normal',
      pool: 'private',
      canonGroupId: null,
      isFiction: false,
      chunkGroupId: null,
      chunkIndex: null,
      totalChunks: null,
      embedding: [0.1, 0.2],
    });
    expect(result.success).toBe(false);
  });

  it('parses a valid fact row without an embedding field', () => {
    const result = ExportFactRowSchema.safeParse({
      id: 'fact-1',
      personalityId: 'char-1',
      personaId: null,
      pool: 'private',
      canonGroupId: null,
      isFiction: false,
      visibility: 'normal',
      isLocked: false,
      statement: 'Alice likes cats.',
      entityTags: ['user:alice'],
      salience: 0.5,
      tier: 'observed',
      validFrom: '2026-01-01T00:00:00.000Z',
      supersededAt: null,
      supersededById: null,
      forgotten: false,
      sourceMemoryIds: [],
      extractionJobId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid feedback row', () => {
    const result = ExportFeedbackRowSchema.safeParse({
      id: 'fb-1',
      userId: 'user-1',
      content: 'Great bot!',
      contentHash: 'abc123',
      status: 'new',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid usage summary row', () => {
    const result = ExportUsageSummaryRowSchema.safeParse({
      provider: 'openrouter',
      model: 'claude-sonnet-4',
      _count: { _all: 5 },
      _sum: { tokensIn: 100, tokensOut: null },
    });
    expect(result.success).toBe(true);
  });
});
