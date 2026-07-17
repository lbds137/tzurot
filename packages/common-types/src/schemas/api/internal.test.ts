import { describe, it, expect } from 'vitest';
import {
  DiscordSnowflakeSchema,
  RecentUsersResponseSchema,
  DmSessionSetRequestSchema,
  DmSessionSetResponseSchema,
  MessagePersonalityResponseSchema,
  PersistAssistantMessageRequestSchema,
  PersistAssistantMessageResponseSchema,
  PersistUserMessageRequestSchema,
  PersistUserMessageResponseSchema,
  ConversationSyncRequestSchema,
  ConversationSyncResponseSchema,
  LoadPersonalityInternalResponseSchema,
  RoutingContextRequestSchema,
  RoutingContextResponseSchema,
  SecretRotationEntrySchema,
  SecretRotationStatusResponseSchema,
} from './internal.js';

describe('DiscordSnowflakeSchema', () => {
  it('accepts a 17-digit snowflake', () => {
    expect(DiscordSnowflakeSchema.safeParse('12345678901234567').success).toBe(true);
  });

  it('accepts an 18-digit snowflake (most common length today)', () => {
    expect(DiscordSnowflakeSchema.safeParse('123456789012345678').success).toBe(true);
  });

  it('accepts a 20-digit snowflake (max length)', () => {
    expect(DiscordSnowflakeSchema.safeParse('12345678901234567890').success).toBe(true);
  });

  it('rejects a 16-digit string (too short)', () => {
    expect(DiscordSnowflakeSchema.safeParse('1234567890123456').success).toBe(false);
  });

  it('rejects a 21-digit string (too long)', () => {
    expect(DiscordSnowflakeSchema.safeParse('123456789012345678901').success).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(DiscordSnowflakeSchema.safeParse('not-a-snowflake').success).toBe(false);
  });

  it('rejects strings with mixed digits and letters', () => {
    expect(DiscordSnowflakeSchema.safeParse('12345678901234567a').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(DiscordSnowflakeSchema.safeParse('').success).toBe(false);
  });

  it('rejects non-string inputs (numbers)', () => {
    // Value is arbitrary — the schema rejects all non-string input. Kept within
    // Number.MAX_SAFE_INTEGER so the literal carries no precision-loss surprise.
    expect(DiscordSnowflakeSchema.safeParse(1234567890123456).success).toBe(false);
  });
});

describe('RecentUsersResponseSchema', () => {
  it('accepts a valid response with snowflake IDs', () => {
    const data = {
      discordIds: ['111111111111111111', '222222222222222222'],
      sinceDays: 30,
    };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts empty discordIds', () => {
    const data = { discordIds: [], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts the snowflake length range (17 and 20 digits)', () => {
    const data = {
      discordIds: ['12345678901234567', '12345678901234567890'], // 17 and 20 digits
      sinceDays: 30,
    };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects negative sinceDays', () => {
    const data = { discordIds: [], sinceDays: -1 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects zero sinceDays', () => {
    const data = { discordIds: [], sinceDays: 0 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects non-string discordIds', () => {
    const data = { discordIds: [123], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects empty discordId strings', () => {
    const data = { discordIds: [''], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric discordId strings', () => {
    const data = { discordIds: ['not-a-snowflake'], sinceDays: 30 };
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects discordId strings shorter than 17 digits', () => {
    const data = { discordIds: ['1234567890123456'], sinceDays: 30 }; // 16 digits
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects discordId strings longer than 20 digits', () => {
    const data = { discordIds: ['123456789012345678901'], sinceDays: 30 }; // 21 digits
    const result = RecentUsersResponseSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('DmSessionSetRequestSchema and DmSessionSetResponseSchema', () => {
  it('request accepts valid channelId + personalitySlug', () => {
    expect(
      DmSessionSetRequestSchema.safeParse({
        channelId: '123456789012345678',
        personalitySlug: 'lila',
      }).success
    ).toBe(true);
  });

  it('response shape mirrors request shape (echo of what was set)', () => {
    expect(
      DmSessionSetResponseSchema.safeParse({
        channelId: '123456789012345678',
        personalitySlug: 'lila',
      }).success
    ).toBe(true);
  });

  it('request rejects missing channelId', () => {
    expect(DmSessionSetRequestSchema.safeParse({ personalitySlug: 'lila' }).success).toBe(false);
  });
});

describe('MessagePersonalityResponseSchema', () => {
  it('accepts a full response with name', () => {
    expect(
      MessagePersonalityResponseSchema.safeParse({
        personalityId: 'personality-uuid',
        personalityName: 'Lila',
      }).success
    ).toBe(true);
  });

  it('accepts response with null personalityName (denormalized name may be absent)', () => {
    expect(
      MessagePersonalityResponseSchema.safeParse({
        personalityId: 'personality-uuid',
        personalityName: null,
      }).success
    ).toBe(true);
  });

  it('accepts response without personalityName at all (optional field)', () => {
    expect(
      MessagePersonalityResponseSchema.safeParse({ personalityId: 'personality-uuid' }).success
    ).toBe(true);
  });

  it('rejects missing personalityId', () => {
    expect(MessagePersonalityResponseSchema.safeParse({ personalityName: 'Lila' }).success).toBe(
      false
    );
  });
});

const VALID_PERSIST_REQUEST = {
  channelId: '123456789012345678',
  guildId: '876543210987654321',
  personalityId: '550e8400-e29b-41d4-a716-446655440000',
  personaId: '550e8400-e29b-41d4-a716-446655440001',
  content: 'Hello from the assistant.',
  chunkMessageIds: ['111111111111111111', '222222222222222222'],
  userMessageTime: '2026-06-04T12:00:00.000Z',
};

describe('PersistAssistantMessageRequestSchema', () => {
  it('accepts a valid multi-chunk request', () => {
    expect(PersistAssistantMessageRequestSchema.safeParse(VALID_PERSIST_REQUEST).success).toBe(
      true
    );
  });

  it('accepts null guildId (DM messages)', () => {
    expect(
      PersistAssistantMessageRequestSchema.safeParse({ ...VALID_PERSIST_REQUEST, guildId: null })
        .success
    ).toBe(true);
  });

  it('rejects empty chunkMessageIds (nothing was delivered)', () => {
    expect(
      PersistAssistantMessageRequestSchema.safeParse({
        ...VALID_PERSIST_REQUEST,
        chunkMessageIds: [],
      }).success
    ).toBe(false);
  });

  it('rejects non-snowflake chunk IDs', () => {
    expect(
      PersistAssistantMessageRequestSchema.safeParse({
        ...VALID_PERSIST_REQUEST,
        chunkMessageIds: ['not-a-snowflake'],
      }).success
    ).toBe(false);
  });

  it('rejects empty content', () => {
    expect(
      PersistAssistantMessageRequestSchema.safeParse({ ...VALID_PERSIST_REQUEST, content: '' })
        .success
    ).toBe(false);
  });

  it('rejects non-UUID personalityId', () => {
    expect(
      PersistAssistantMessageRequestSchema.safeParse({
        ...VALID_PERSIST_REQUEST,
        personalityId: 'lila',
      }).success
    ).toBe(false);
  });

  it('rejects non-ISO userMessageTime', () => {
    expect(
      PersistAssistantMessageRequestSchema.safeParse({
        ...VALID_PERSIST_REQUEST,
        userMessageTime: 'yesterday',
      }).success
    ).toBe(false);
  });
});

describe('PersistAssistantMessageResponseSchema', () => {
  it('accepts a created response without matched', () => {
    expect(
      PersistAssistantMessageResponseSchema.safeParse({ id: 'row-uuid', created: true }).success
    ).toBe(true);
  });

  it('accepts an existing-row response with matched', () => {
    expect(
      PersistAssistantMessageResponseSchema.safeParse({
        id: 'row-uuid',
        created: false,
        matched: false,
      }).success
    ).toBe(true);
  });
});

const VALID_USER_PERSIST_REQUEST = {
  channelId: '123456789012345678',
  guildId: '876543210987654321',
  personalityId: '550e8400-e29b-41d4-a716-446655440000',
  personaId: '550e8400-e29b-41d4-a716-446655440001',
  content: 'Hello bot!\n\n[Image: cat.png]',
  discordMessageId: '111111111111111111',
  messageTime: '2026-06-04T12:00:00.000Z',
};

describe('PersistUserMessageRequestSchema', () => {
  it('accepts a metadata-free request (plain text message)', () => {
    expect(PersistUserMessageRequestSchema.safeParse(VALID_USER_PERSIST_REQUEST).success).toBe(
      true
    );
  });

  it('accepts structured messageMetadata (references + forwarded flag)', () => {
    expect(
      PersistUserMessageRequestSchema.safeParse({
        ...VALID_USER_PERSIST_REQUEST,
        messageMetadata: {
          isForwarded: true,
          referencedMessages: [
            {
              discordMessageId: '222222222222222222',
              authorUsername: 'other',
              authorDisplayName: 'Other User',
              content: 'referenced text',
              timestamp: '2026-06-04T11:59:00.000Z',
              locationContext: 'same-channel',
            },
          ],
        },
      }).success
    ).toBe(true);
  });

  it('accepts null guildId (DM messages)', () => {
    expect(
      PersistUserMessageRequestSchema.safeParse({ ...VALID_USER_PERSIST_REQUEST, guildId: null })
        .success
    ).toBe(true);
  });

  it('rejects empty content', () => {
    expect(
      PersistUserMessageRequestSchema.safeParse({ ...VALID_USER_PERSIST_REQUEST, content: '' })
        .success
    ).toBe(false);
  });

  it('rejects a non-snowflake discordMessageId', () => {
    expect(
      PersistUserMessageRequestSchema.safeParse({
        ...VALID_USER_PERSIST_REQUEST,
        discordMessageId: 'nope',
      }).success
    ).toBe(false);
  });

  it('rejects non-ISO messageTime', () => {
    expect(
      PersistUserMessageRequestSchema.safeParse({
        ...VALID_USER_PERSIST_REQUEST,
        messageTime: 'yesterday',
      }).success
    ).toBe(false);
  });
});

describe('PersistUserMessageResponseSchema', () => {
  it('accepts a created response without matched', () => {
    expect(
      PersistUserMessageResponseSchema.safeParse({ id: 'row-uuid', created: true }).success
    ).toBe(true);
  });

  it('accepts an existing-row response with matched', () => {
    expect(
      PersistUserMessageResponseSchema.safeParse({
        id: 'row-uuid',
        created: false,
        matched: false,
      }).success
    ).toBe(true);
  });

  it('rejects a response missing created', () => {
    expect(PersistUserMessageResponseSchema.safeParse({ id: 'row-uuid' }).success).toBe(false);
  });
});

const VALID_SYNC_REQUEST = {
  channelId: '123456789012345678',
  personalityId: '550e8400-e29b-41d4-a716-446655440000',
  observedMessages: [
    {
      discordMessageId: '111111111111111111',
      content: 'observed content',
      createdAt: '2026-06-04T12:00:00.000Z',
    },
  ],
};

describe('ConversationSyncRequestSchema', () => {
  it('accepts a valid snapshot', () => {
    expect(ConversationSyncRequestSchema.safeParse(VALID_SYNC_REQUEST).success).toBe(true);
  });

  it('accepts empty content (voice messages render empty on Discord)', () => {
    expect(
      ConversationSyncRequestSchema.safeParse({
        ...VALID_SYNC_REQUEST,
        observedMessages: [{ ...VALID_SYNC_REQUEST.observedMessages[0], content: '' }],
      }).success
    ).toBe(true);
  });

  it('rejects an empty snapshot (no messages observed means nothing to sync)', () => {
    expect(
      ConversationSyncRequestSchema.safeParse({ ...VALID_SYNC_REQUEST, observedMessages: [] })
        .success
    ).toBe(false);
  });

  it('rejects non-ISO createdAt', () => {
    expect(
      ConversationSyncRequestSchema.safeParse({
        ...VALID_SYNC_REQUEST,
        observedMessages: [{ ...VALID_SYNC_REQUEST.observedMessages[0], createdAt: 'now' }],
      }).success
    ).toBe(false);
  });
});

describe('ConversationSyncResponseSchema', () => {
  it('accepts zero-work results', () => {
    expect(ConversationSyncResponseSchema.safeParse({ updated: 0, deleted: 0 }).success).toBe(true);
  });

  it('rejects negative counts', () => {
    expect(ConversationSyncResponseSchema.safeParse({ updated: -1, deleted: 0 }).success).toBe(
      false
    );
  });
});

describe('LoadPersonalityInternalResponseSchema', () => {
  it('accepts a null personality (not found / no access is a normal outcome)', () => {
    expect(LoadPersonalityInternalResponseSchema.safeParse({ personality: null }).success).toBe(
      true
    );
  });

  it('accepts a minimal valid LoadedPersonality', () => {
    const result = LoadPersonalityInternalResponseSchema.safeParse({
      personality: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Lila',
        displayName: 'Lila',
        slug: 'lila',
        ownerId: '550e8400-e29b-41d4-a716-446655440002',
        systemPrompt: 'You are Lila.',
        model: 'anthropic/claude-sonnet-4.6',
        temperature: 1,
        contextWindowTokens: 200000,
        characterInfo: 'info',
        personalityTraits: 'traits',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a personality missing required fields', () => {
    expect(
      LoadPersonalityInternalResponseSchema.safeParse({ personality: { id: 'x', name: 'y' } })
        .success
    ).toBe(false);
  });
});

describe('RoutingContextRequestSchema', () => {
  const valid = {
    discordId: '278863839632818186',
    username: 'lila',
    displayName: 'Lila',
    personalityId: '550e8400-e29b-41d4-a716-446655440002',
  };

  it('accepts a minimal valid request (isBot omitted)', () => {
    expect(RoutingContextRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an explicit isBot flag', () => {
    expect(RoutingContextRequestSchema.safeParse({ ...valid, isBot: true }).success).toBe(true);
  });

  it('rejects a non-snowflake discordId (shape-validated, not just length)', () => {
    // discordId gates provisioning — a malformed id would create a junk user
    // shell keyed on it. Snowflakes are 17-20 digits.
    expect(
      RoutingContextRequestSchema.safeParse({ ...valid, discordId: 'not-a-snowflake' }).success
    ).toBe(false);
    expect(RoutingContextRequestSchema.safeParse({ ...valid, discordId: '123' }).success).toBe(
      false
    );
  });

  it('accepts a blank displayName (user without a global display name)', () => {
    expect(RoutingContextRequestSchema.safeParse({ ...valid, displayName: '' }).success).toBe(true);
  });

  it('rejects an empty discordId', () => {
    expect(RoutingContextRequestSchema.safeParse({ ...valid, discordId: '' }).success).toBe(false);
  });

  it('rejects an empty username', () => {
    expect(RoutingContextRequestSchema.safeParse({ ...valid, username: '' }).success).toBe(false);
  });

  it('rejects a non-UUID personalityId', () => {
    expect(
      RoutingContextRequestSchema.safeParse({ ...valid, personalityId: 'not-a-uuid' }).success
    ).toBe(false);
  });

  it('rejects a missing personalityId', () => {
    const { personalityId: _omit, ...withoutPersonality } = valid;
    expect(RoutingContextRequestSchema.safeParse(withoutPersonality).success).toBe(false);
  });
});

describe('RoutingContextResponseSchema', () => {
  const valid = {
    userId: '550e8400-e29b-41d4-a716-446655440000',
    personaId: '550e8400-e29b-41d4-a716-446655440003',
    personaName: 'Nyx',
    timezone: 'UTC',
    contextEpoch: '2026-06-20T00:00:00.000Z',
  };

  it('accepts a fully-populated bundle', () => {
    expect(RoutingContextResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an empty-string personaId (system-default fallback)', () => {
    expect(RoutingContextResponseSchema.safeParse({ ...valid, personaId: '' }).success).toBe(true);
  });

  it('accepts null personaName and null contextEpoch', () => {
    expect(
      RoutingContextResponseSchema.safeParse({ ...valid, personaName: null, contextEpoch: null })
        .success
    ).toBe(true);
  });

  it('rejects a non-UUID userId', () => {
    expect(RoutingContextResponseSchema.safeParse({ ...valid, userId: 'not-a-uuid' }).success).toBe(
      false
    );
  });

  it('rejects a non-UUID, non-empty personaId', () => {
    expect(
      RoutingContextResponseSchema.safeParse({ ...valid, personaId: 'not-a-uuid' }).success
    ).toBe(false);
  });

  it('rejects a non-ISO contextEpoch', () => {
    expect(
      RoutingContextResponseSchema.safeParse({ ...valid, contextEpoch: 'yesterday' }).success
    ).toBe(false);
  });
});

describe('SecretRotationStatusResponseSchema', () => {
  const entry = {
    name: 'byok-encryption-key',
    rotatedAt: '2026-07-17T00:00:00.000Z',
    intervalDays: 180,
    overdueDays: 0,
  };

  it('accepts a well-formed status payload', () => {
    expect(
      SecretRotationStatusResponseSchema.safeParse({ entries: [entry], overdueCount: 0 }).success
    ).toBe(true);
  });

  it('accepts an empty ledger', () => {
    expect(
      SecretRotationStatusResponseSchema.safeParse({ entries: [], overdueCount: 0 }).success
    ).toBe(true);
  });

  it('rejects a negative overdueDays (server must clamp, not emit debt)', () => {
    expect(
      SecretRotationStatusResponseSchema.safeParse({
        entries: [{ ...entry, overdueDays: -1 }],
        overdueCount: 0,
      }).success
    ).toBe(false);
  });

  it('rejects a non-ISO rotatedAt', () => {
    expect(
      SecretRotationStatusResponseSchema.safeParse({
        entries: [{ ...entry, rotatedAt: 'yesterday' }],
        overdueCount: 0,
      }).success
    ).toBe(false);
  });

  it('rejects a non-positive intervalDays', () => {
    expect(
      SecretRotationStatusResponseSchema.safeParse({
        entries: [{ ...entry, intervalDays: 0 }],
        overdueCount: 0,
      }).success
    ).toBe(false);
  });
});

describe('SecretRotationEntrySchema', () => {
  const entry = {
    name: 'byok-encryption-key',
    rotatedAt: '2026-07-17T00:00:00.000Z',
    intervalDays: 180,
    overdueDays: 0,
  };

  it('accepts a well-formed entry', () => {
    expect(SecretRotationEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('rejects an empty or over-long name (VarChar(50) ledger key)', () => {
    expect(SecretRotationEntrySchema.safeParse({ ...entry, name: '' }).success).toBe(false);
    expect(SecretRotationEntrySchema.safeParse({ ...entry, name: 'x'.repeat(51) }).success).toBe(
      false
    );
  });

  it('requires every field (no partial ledger rows on the wire)', () => {
    const { overdueDays: _dropped, ...partial } = entry;
    expect(SecretRotationEntrySchema.safeParse(partial).success).toBe(false);
  });
});
