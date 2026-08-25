import { describe, it, expect } from 'vitest';
import {
  DiscordSnowflakeSchema,
  RecentUsersResponseSchema,
  DmSessionSetRequestSchema,
  DmSessionSetResponseSchema,
  GuildMemberInfoRecordRequestSchema,
  GuildMemberInfoRecordResponseSchema,
  StampUserActivityRequestSchema,
  StampUserActivityResponseSchema,
  RecordCommandEventRequestSchema,
  RecordCommandEventResponseSchema,
  ExportSmokeStartRequestSchema,
  ExportSmokeExpectedCountsSchema,
  ExportSmokeStartResponseSchema,
  ExportSmokeStatusRequestSchema,
  ExportSmokeStatusResponseSchema,
  CommandEventChannelKindSchema,
  CommandEventOutcomeSchema,
  MessagePersonalityResponseSchema,
  PersistAssistantMessageRequestSchema,
  PersistAssistantMessageResponseSchema,
  PatchForwardedOriginRequestSchema,
  PatchForwardedOriginResponseSchema,
  PersistUserMessageRequestSchema,
  PersistUserMessageResponseSchema,
  ConversationSyncRequestSchema,
  ConversationSyncResponseSchema,
  LoadPersonalityInternalResponseSchema,
  RoutingContextRequestSchema,
  RoutingContextResponseSchema,
  SecretRotationEntrySchema,
  SecretRotationStatusResponseSchema,
  RetentionPreviewUserSchema,
  RetentionPreviewResponseSchema,
  RetentionPurgeRequestSchema,
  RetentionPurgeResponseSchema,
  RetentionReconcileOffDbResponseSchema,
  RetentionNotifyRequestSchema,
  RetentionNotifyResponseSchema,
  RetentionNotifyCohortUserSchema,
  RetentionNotifyFilterRequestSchema,
  RetentionNotifyFilterResponseSchema,
  RetentionNotifyReportRequestSchema,
  RetentionNotifyReportResponseSchema,
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

describe('GuildMemberInfoRecordRequestSchema and GuildMemberInfoRecordResponseSchema', () => {
  const valid = {
    guildId: '123456789012345678',
    discordUserId: '987654321098765432',
    info: { roles: ['Admin'], displayColor: '#FF00FF', joinedAt: '2024-01-01T00:00:00.000Z' },
  };

  it('request accepts a full membership observation', () => {
    expect(GuildMemberInfoRecordRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('request accepts the roles-only shape a colourless member produces', () => {
    expect(
      GuildMemberInfoRecordRequestSchema.safeParse({ ...valid, info: { roles: [] } }).success
    ).toBe(true);
  });

  it('request rejects a non-snowflake guild id', () => {
    expect(
      GuildMemberInfoRecordRequestSchema.safeParse({ ...valid, guildId: 'not-a-snowflake' }).success
    ).toBe(false);
  });

  it('request rejects an observation missing its roles array', () => {
    // `roles` is what the emptiness check reads; an absent array would make
    // `isEmptyGuildInfo` throw rather than decide.
    expect(
      GuildMemberInfoRecordRequestSchema.safeParse({ ...valid, info: { displayColor: '#FFF' } })
        .success
    ).toBe(false);
  });

  it('response reports whether a user row matched', () => {
    expect(GuildMemberInfoRecordResponseSchema.safeParse({ recorded: false }).success).toBe(true);
    expect(GuildMemberInfoRecordResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('StampUserActivityRequestSchema and StampUserActivityResponseSchema', () => {
  it('request accepts a valid Discord snowflake', () => {
    expect(
      StampUserActivityRequestSchema.safeParse({ discordId: '123456789012345678' }).success
    ).toBe(true);
  });

  it('request rejects a non-snowflake discordId', () => {
    expect(StampUserActivityRequestSchema.safeParse({ discordId: 'not-a-snowflake' }).success).toBe(
      false
    );
  });

  it('request rejects a missing discordId', () => {
    expect(StampUserActivityRequestSchema.safeParse({}).success).toBe(false);
  });

  it('response accepts stamped true and false', () => {
    expect(StampUserActivityResponseSchema.safeParse({ stamped: true }).success).toBe(true);
    expect(StampUserActivityResponseSchema.safeParse({ stamped: false }).success).toBe(true);
  });

  it('response rejects a non-boolean stamped', () => {
    expect(StampUserActivityResponseSchema.safeParse({ stamped: 'yes' }).success).toBe(false);
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

  it('accepts a request with no thinkingContent (the model produced no trace)', () => {
    const parsed = PersistAssistantMessageRequestSchema.safeParse(VALID_PERSIST_REQUEST);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.thinkingContent).toBeUndefined();
  });

  /**
   * Sentinel-survival: Zod strips undeclared keys, so a `thinkingContent` that
   * is missing from this schema would be deleted between bot-client's POST and
   * the gateway's write — silently, with no parse error, leaving the column
   * null forever. Asserting `success` alone cannot catch that (an unknown key
   * is stripped, not rejected), so this pins the VALUE surviving the parse.
   */
  it('preserves thinkingContent through the parse instead of stripping it', () => {
    const sentinel = 'SENTINEL-TRACE-a1b2c3: the model reasoned about castles.';

    const parsed = PersistAssistantMessageRequestSchema.safeParse({
      ...VALID_PERSIST_REQUEST,
      thinkingContent: sentinel,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.thinkingContent).toBe(sentinel);
  });

  it('rejects a non-string thinkingContent', () => {
    expect(
      PersistAssistantMessageRequestSchema.safeParse({
        ...VALID_PERSIST_REQUEST,
        thinkingContent: 42,
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

describe('RetentionPreviewUserSchema', () => {
  const user = {
    discordId: '900000000000000071',
    username: 'inactiveuser',
    inactiveSince: '2025-01-01T00:00:00.000Z',
    reason: 'unreachable' as const,
    ownedCharacters: { toDelete: 2, toReHome: 1 },
  };

  it('accepts both eligibility reasons', () => {
    expect(RetentionPreviewUserSchema.safeParse(user).success).toBe(true);
    expect(RetentionPreviewUserSchema.safeParse({ ...user, reason: 'account_gone' }).success).toBe(
      true
    );
  });

  it('rejects an unknown reason (the purge branches on it)', () => {
    expect(RetentionPreviewUserSchema.safeParse({ ...user, reason: 'inactive' }).success).toBe(
      false
    );
  });

  it('ACCEPTS a malformed stored discordId — the report must display the anomaly', () => {
    // A legacy prod row holds the literal 'unknown'; snowflake validation
    // here crashed the preview CLI and silenced the daily nag the moment the
    // bystander arm made the cohort non-empty. Display surfaces fail open.
    expect(RetentionPreviewUserSchema.safeParse({ ...user, discordId: 'unknown' }).success).toBe(
      true
    );
  });

  it('ACCEPTS an empty username — nag delivery outranks field validity', () => {
    // Same fail-open doctrine as the discordId above: the username is a
    // display-only identity token, and a malformed or blank stored value must
    // never crash the CLI or silence the daily nag. The rendering surfaces
    // omit the token instead.
    expect(RetentionPreviewUserSchema.safeParse({ ...user, username: '' }).success).toBe(true);
    expect(RetentionPreviewUserSchema.safeParse({ ...user, username: '*weird*' }).success).toBe(
      true
    );
  });

  it('REQUIRES the username field — a missing one must not silently strip', () => {
    // The client transport Zod-parses in strip mode, so an undeclared field
    // vanishes before any consumer sees it; the producer always supplies this
    // one (the column is NOT NULL).
    const withoutUsername = {
      discordId: user.discordId,
      inactiveSince: user.inactiveSince,
      reason: user.reason,
      ownedCharacters: user.ownedCharacters,
    };
    expect(RetentionPreviewUserSchema.safeParse(withoutUsername).success).toBe(false);
  });

  it('still rejects empty/oversized ids and negative character counts', () => {
    expect(RetentionPreviewUserSchema.safeParse({ ...user, discordId: '' }).success).toBe(false);
    expect(
      RetentionPreviewUserSchema.safeParse({ ...user, discordId: 'x'.repeat(33) }).success
    ).toBe(false);
    expect(
      RetentionPreviewUserSchema.safeParse({
        ...user,
        ownedCharacters: { toDelete: -1, toReHome: 0 },
      }).success
    ).toBe(false);
  });
});

describe('RetentionPreviewResponseSchema', () => {
  const response = {
    users: [],
    totals: {
      eligibleCount: 0,
      userbaseCount: 270,
      percentOfUserbase: 0,
      charactersToDelete: 0,
      charactersToReHome: 0,
      breakerWarning: false,
      reachableToNotify: 0,
      inGrace: 0,
      graceExpired: 0,
      bystander: 0,
    },
  };

  it('accepts an empty cohort (the healthy steady state)', () => {
    expect(RetentionPreviewResponseSchema.safeParse(response).success).toBe(true);
  });

  it('accepts a fractional percentage (one decimal place)', () => {
    const parsed = RetentionPreviewResponseSchema.safeParse({
      ...response,
      totals: { ...response.totals, eligibleCount: 26, percentOfUserbase: 9.6 },
    });
    expect(parsed.success).toBe(true);
  });

  it('requires the breaker flag (a missing warning must not read as false)', () => {
    const { breakerWarning: _dropped, ...totals } = response.totals;
    expect(RetentionPreviewResponseSchema.safeParse({ ...response, totals }).success).toBe(false);
  });
});

describe('RetentionPurgeRequestSchema', () => {
  const request = { discordId: '900000000000000001' };

  it('accepts a bare target — run context and override are optional', () => {
    expect(RetentionPurgeRequestSchema.safeParse(request).success).toBe(true);
  });

  it('accepts the full operator payload', () => {
    expect(
      RetentionPurgeRequestSchema.safeParse({
        ...request,
        runContext: 'ops retention:purge (prod)',
        breakerOverride: true,
      }).success
    ).toBe(true);
  });

  it('REQUIRES a target — an empty body must never mean "purge anything"', () => {
    expect(RetentionPurgeRequestSchema.safeParse({}).success).toBe(false);
  });

  it('ACCEPTS a malformed stored id — the operator must be able to purge the junk the preview surfaced', () => {
    // The id is a lookup key, not a trust boundary (parameterized SQL + the
    // in-tx eligibility re-check own safety); a nonexistent id skips as
    // already_gone. Empty and oversized ids stay rejected.
    expect(RetentionPurgeRequestSchema.safeParse({ discordId: 'unknown' }).success).toBe(true);
    expect(RetentionPurgeRequestSchema.safeParse({ discordId: '' }).success).toBe(false);
    expect(RetentionPurgeRequestSchema.safeParse({ discordId: 'x'.repeat(33) }).success).toBe(
      false
    );
  });

  it('rejects a non-boolean breaker override rather than coercing it', () => {
    // A truthy string like 'false' coercing to true would silently disable the
    // one ceiling --force is not allowed to bypass.
    expect(
      RetentionPurgeRequestSchema.safeParse({ ...request, breakerOverride: 'true' }).success
    ).toBe(false);
  });

  it('bounds the run-context label', () => {
    expect(
      RetentionPurgeRequestSchema.safeParse({ ...request, runContext: 'x'.repeat(201) }).success
    ).toBe(false);
  });
});

describe('RetentionPurgeResponseSchema', () => {
  it('accepts a completed purge with its character split', () => {
    expect(
      RetentionPurgeResponseSchema.safeParse({
        discordId: '900000000000000001',
        status: 'purged',
        charactersDeleted: 2,
        charactersReHomed: 1,
      }).success
    ).toBe(true);
  });

  it('accepts each skip reason', () => {
    for (const reason of ['already_gone', 'no_longer_eligible', 'breaker_tripped']) {
      expect(
        RetentionPurgeResponseSchema.safeParse({
          discordId: '900000000000000001',
          status: 'skipped',
          reason,
        }).success
      ).toBe(true);
    }
  });

  it('rejects an unknown status or reason', () => {
    const base = { discordId: '900000000000000001' };
    expect(RetentionPurgeResponseSchema.safeParse({ ...base, status: 'failed' }).success).toBe(
      false
    );
    expect(
      RetentionPurgeResponseSchema.safeParse({ ...base, status: 'skipped', reason: 'whatever' })
        .success
    ).toBe(false);
  });

  it('rejects a negative character count', () => {
    expect(
      RetentionPurgeResponseSchema.safeParse({
        discordId: '900000000000000001',
        status: 'purged',
        charactersDeleted: -1,
      }).success
    ).toBe(false);
  });
});

describe('RetentionReconcileOffDbResponseSchema', () => {
  it('accepts a zero-work sweep (the common case)', () => {
    expect(
      RetentionReconcileOffDbResponseSchema.safeParse({ settled: 0, stillFailing: 0, remaining: 0 })
        .success
    ).toBe(true);
  });

  it('requires both counters — a missing one must not read as zero work done', () => {
    expect(RetentionReconcileOffDbResponseSchema.safeParse({ settled: 1 }).success).toBe(false);
  });

  it('rejects negative counters', () => {
    expect(
      RetentionReconcileOffDbResponseSchema.safeParse({
        settled: 0,
        stillFailing: -1,
        remaining: 0,
      }).success
    ).toBe(false);
  });
});

describe('RetentionNotifyRequestSchema', () => {
  it('accepts a bare run — every field is optional', () => {
    expect(RetentionNotifyRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts the full operator payload', () => {
    expect(
      RetentionNotifyRequestSchema.safeParse({
        dryRun: true,
        breakerOverride: true,
        runContext: 'first prod notify run',
      }).success
    ).toBe(true);
  });
});

describe('RetentionNotifyResponseSchema', () => {
  const response = {
    status: 'enqueued',
    cohortSize: 51,
    userbaseCount: 273,
    percentOfUserbase: 18.7,
    breakerWarning: true,
    batchesEnqueued: 2,
    recipients: [{ discordId: '900000000000000001', inactiveSince: '2025-01-01T00:00:00.000Z' }],
  };

  it('accepts the first-real-run shape (warn-breaker true, still enqueued)', () => {
    expect(RetentionNotifyResponseSchema.safeParse(response).success).toBe(true);
  });

  it('rejects an unknown status — the CLI branches on this enum', () => {
    expect(
      RetentionNotifyResponseSchema.safeParse({ ...response, status: 'partial' }).success
    ).toBe(false);
  });
});

describe('RetentionNotifyFilterRequestSchema', () => {
  it('rejects an empty batch — the worker must not ask a vacuous question', () => {
    expect(RetentionNotifyFilterRequestSchema.safeParse({ userIds: [] }).success).toBe(false);
  });
});

describe('RetentionNotifyReportRequestSchema', () => {
  it('accepts a single sent outcome (the per-recipient immediate report)', () => {
    expect(
      RetentionNotifyReportRequestSchema.safeParse({
        outcomes: [{ userId: 'a3bb189e-8bf9-3888-9912-ace4e6543002', status: 'sent' }],
      }).success
    ).toBe(true);
  });

  it('rejects an outcome status outside the delivery vocabulary', () => {
    expect(
      RetentionNotifyReportRequestSchema.safeParse({
        outcomes: [{ userId: 'a3bb189e-8bf9-3888-9912-ace4e6543002', status: 'skipped' }],
      }).success
    ).toBe(false);
  });
});

describe('RetentionNotifyCohortUserSchema', () => {
  it('accepts a cohort row and rejects a bare date (ISO datetime required)', () => {
    const row = { discordId: '900000000000000001', inactiveSince: '2025-01-01T00:00:00.000Z' };
    expect(RetentionNotifyCohortUserSchema.safeParse(row).success).toBe(true);
    expect(
      RetentionNotifyCohortUserSchema.safeParse({ ...row, inactiveSince: '2025-01-01' }).success
    ).toBe(false);
  });
});

describe('RetentionNotifyFilterResponseSchema', () => {
  it('accepts an empty still-eligible set (everyone became active)', () => {
    expect(
      RetentionNotifyFilterResponseSchema.safeParse({ stillEligibleUserIds: [] }).success
    ).toBe(true);
  });

  it('requires the field — a missing set must not read as empty', () => {
    expect(RetentionNotifyFilterResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('RetentionNotifyReportResponseSchema', () => {
  it('accepts a processed count and rejects a negative one', () => {
    expect(RetentionNotifyReportResponseSchema.safeParse({ processed: 1 }).success).toBe(true);
    expect(RetentionNotifyReportResponseSchema.safeParse({ processed: -1 }).success).toBe(false);
  });
});

describe('PatchForwardedOriginRequestSchema', () => {
  const VALID = {
    channelId: '123456789012345678',
    personalityId: '550e8400-e29b-41d4-a716-446655440000',
    personaId: '550e8400-e29b-41d4-a716-446655440001',
    messageTime: '2026-08-18T11:13:53.053Z',
    forwardedFrom: {
      authorName: 'COLD',
      authorId: '1472768398135001108',
      authorPersonalityId: '550e8400-e29b-41d4-a716-446655440002',
      timestamp: '2026-08-18T11:13:53.053Z',
    },
  };

  it('accepts a fully-resolved origin', () => {
    expect(PatchForwardedOriginRequestSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts an origin carrying only the timestamp', () => {
    // What a deleted or unreadable original leaves behind: the snapshot still
    // has a post time even when the author cannot be re-fetched.
    const result = PatchForwardedOriginRequestSchema.safeParse({
      ...VALID,
      forwardedFrom: { timestamp: '2026-08-18T11:13:53.053Z' },
    });
    expect(result.success).toBe(true);
  });

  it('preserves authorPersonalityId through the parse', () => {
    // The whole point of the field: an undeclared key would be stripped here
    // and the quote would render without a from_id, with nothing to show for
    // the resolution that produced it.
    const result = PatchForwardedOriginRequestSchema.safeParse(VALID);
    expect(result.success && result.data.forwardedFrom.authorPersonalityId).toBe(
      '550e8400-e29b-41d4-a716-446655440002'
    );
  });

  it('rejects a non-uuid personalityId', () => {
    // The row id is derived from this; a non-uuid would hash into a well-formed
    // id addressing nothing, and the miss would look like an ordinary absent row.
    expect(
      PatchForwardedOriginRequestSchema.safeParse({ ...VALID, personalityId: 'nope' }).success
    ).toBe(false);
  });

  it('rejects a non-datetime messageTime', () => {
    expect(
      PatchForwardedOriginRequestSchema.safeParse({ ...VALID, messageTime: 'yesterday' }).success
    ).toBe(false);
  });

  it('rejects a malformed origin timestamp', () => {
    // Strictness lives here rather than on forwardedOriginSchema itself:
    // that schema is also parsed over STORED rows via messageMetadataSchema,
    // where parseMessageMetadata discards the ENTIRE blob on any failure.
    expect(
      PatchForwardedOriginRequestSchema.safeParse({
        ...VALID,
        forwardedFrom: { ...VALID.forwardedFrom, timestamp: 'yesterday' },
      }).success
    ).toBe(false);
  });

  it('still accepts an origin with no timestamp at all', () => {
    // The tightening is on the VALUE, not on presence — an unresolvable
    // original legitimately yields an origin with neither author nor time.
    const { timestamp: _dropped, ...noTime } = VALID.forwardedFrom;
    expect(
      PatchForwardedOriginRequestSchema.safeParse({ ...VALID, forwardedFrom: noTime }).success
    ).toBe(true);
  });

  it('requires forwardedFrom to be present', () => {
    const { forwardedFrom: _omitted, ...withoutOrigin } = VALID;
    expect(PatchForwardedOriginRequestSchema.safeParse(withoutOrigin).success).toBe(false);
  });
});

describe('PatchForwardedOriginResponseSchema', () => {
  it('accepts both outcomes of the back-fill', () => {
    expect(PatchForwardedOriginResponseSchema.safeParse({ updated: true }).success).toBe(true);
    expect(PatchForwardedOriginResponseSchema.safeParse({ updated: false }).success).toBe(true);
  });

  it('rejects a missing updated flag', () => {
    // `updated: false` is a real answer (no row matched), so an absent field
    // must not be readable as one.
    expect(PatchForwardedOriginResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('CommandEventChannelKindSchema', () => {
  it('accepts each coarse location class and rejects anything else', () => {
    for (const kind of ['guild', 'dm', 'thread']) {
      expect(CommandEventChannelKindSchema.safeParse(kind).success).toBe(true);
    }
    // A channel ID must never pass — the kind is deliberately coarse.
    expect(CommandEventChannelKindSchema.safeParse('925094911961882704').success).toBe(false);
    expect(CommandEventChannelKindSchema.safeParse('group_dm').success).toBe(false);
  });
});

describe('CommandEventOutcomeSchema', () => {
  it('accepts each outcome class and rejects free text', () => {
    for (const outcome of ['ok', 'user_error', 'system_error', 'rate_limited', 'cancelled']) {
      expect(CommandEventOutcomeSchema.safeParse(outcome).success).toBe(true);
    }
    // Rendered messages are not outcomes — the column holds a closed enum.
    expect(CommandEventOutcomeSchema.safeParse('Something went wrong').success).toBe(false);
    expect(CommandEventOutcomeSchema.safeParse('error').success).toBe(false);
  });
});

describe('RecordCommandEventRequestSchema', () => {
  const VALID = {
    userId: '123456789012345678',
    channelKind: 'guild' as const,
    command: 'character.create',
    outcome: 'ok' as const,
    latencyMs: 42,
  };

  it('accepts the minimal shape with every optional field omitted', () => {
    expect(RecordCommandEventRequestSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts the full shape', () => {
    const result = RecordCommandEventRequestSchema.safeParse({
      ...VALID,
      guildId: '987654321098765432',
      channelKind: 'thread',
      characterId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      outcome: 'user_error',
      errorCode: 'ValidationError',
      context: { model_family: 'claude' },
    });
    expect(result.success).toBe(true);
  });

  it.each(['ok', 'user_error', 'system_error', 'rate_limited', 'cancelled'])(
    'accepts outcome %s',
    outcome => {
      expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, outcome }).success).toBe(true);
    }
  );

  it.each(['guild', 'dm', 'thread'])('accepts channelKind %s', channelKind => {
    expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, channelKind }).success).toBe(true);
  });

  it('rejects an unknown outcome', () => {
    expect(
      RecordCommandEventRequestSchema.safeParse({ ...VALID, outcome: 'exploded' }).success
    ).toBe(false);
  });

  it('rejects an unknown channelKind', () => {
    // 'voice' is a real Discord channel type but not a telemetry class — the
    // coarse set is deliberately closed.
    expect(
      RecordCommandEventRequestSchema.safeParse({ ...VALID, channelKind: 'voice' }).success
    ).toBe(false);
  });

  it('rejects a non-snowflake userId', () => {
    expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, userId: 'nope' }).success).toBe(
      false
    );
  });

  it('rejects a command longer than the column cap', () => {
    expect(
      RecordCommandEventRequestSchema.safeParse({ ...VALID, command: 'x'.repeat(101) }).success
    ).toBe(false);
    expect(
      RecordCommandEventRequestSchema.safeParse({ ...VALID, command: 'x'.repeat(100) }).success
    ).toBe(true);
  });

  it('rejects an empty command', () => {
    expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, command: '' }).success).toBe(
      false
    );
  });

  it('rejects an errorCode longer than the column cap', () => {
    expect(
      RecordCommandEventRequestSchema.safeParse({ ...VALID, errorCode: 'x'.repeat(101) }).success
    ).toBe(false);
  });

  it('rejects a negative or fractional latencyMs', () => {
    expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, latencyMs: -1 }).success).toBe(
      false
    );
    expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, latencyMs: 1.5 }).success).toBe(
      false
    );
    expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, latencyMs: 0 }).success).toBe(
      true
    );
  });

  it('rejects a non-uuid characterId', () => {
    expect(
      RecordCommandEventRequestSchema.safeParse({ ...VALID, characterId: 'not-a-uuid' }).success
    ).toBe(false);
  });

  it('accepts an arbitrary context KEY — the key strip is the handler, not the schema', () => {
    // Deliberate: rejecting an unknown key would 400 a fire-and-forget path.
    // The gateway handler drops the key and still records the event.
    const result = RecordCommandEventRequestSchema.safeParse({
      ...VALID,
      context: { model_family: 'claude', message_content: 'private' },
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['a nested object', { model_family: { smuggled: 'a whole message' } }],
    ['an array', { model_family: ['a', 'whole', 'message'] }],
    ['a null', { model_family: null }],
  ])('rejects %s as a context VALUE even under an allowlisted key', (_label, context) => {
    // The key allowlist cannot help here — `model_family` is allowlisted, so
    // a nested value would be copied through the strip verbatim. Closing the
    // value shape at the boundary is what makes the guard total.
    expect(RecordCommandEventRequestSchema.safeParse({ ...VALID, context }).success).toBe(false);
  });

  it('accepts scalar context values', () => {
    expect(
      RecordCommandEventRequestSchema.safeParse({
        ...VALID,
        context: { model_family: 'claude', provider: 1, voice_mode: true },
      }).success
    ).toBe(true);
  });
});

describe('RecordCommandEventResponseSchema', () => {
  it('requires the recorded flag', () => {
    expect(RecordCommandEventResponseSchema.safeParse({ recorded: true }).success).toBe(true);
    expect(RecordCommandEventResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('ExportSmokeStartRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(ExportSmokeStartRequestSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a stray field (strict, no request body expected)', () => {
    expect(ExportSmokeStartRequestSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

describe('ExportSmokeExpectedCountsSchema / ExportSmokeStartResponseSchema', () => {
  const VALID_COUNTS = {
    personas: [{ id: '829e4567-e89b-42d3-a456-426614174000', name: 'Alex' }],
    characters: [{ id: '829e4567-e89b-42d3-a456-426614174001', slug: 'my-character' }],
    conversationCountsByPersonalityId: { '829e4567-e89b-42d3-a456-426614174001': 3 },
    memoryCountsByPersonalityId: {},
    factCountsByPersonalityId: {},
    totals: { personas: 1, characters: 1, conversations: 3, memories: 0, facts: 0 },
    isSuperuser: false,
  };

  it('accepts a valid expected-counts payload', () => {
    expect(ExportSmokeExpectedCountsSchema.safeParse(VALID_COUNTS).success).toBe(true);
  });

  it('rejects a negative count', () => {
    expect(
      ExportSmokeExpectedCountsSchema.safeParse({
        ...VALID_COUNTS,
        conversationCountsByPersonalityId: { p1: -1 },
      }).success
    ).toBe(false);
  });

  it('accepts a valid start response envelope', () => {
    const result = ExportSmokeStartResponseSchema.safeParse({
      exportJobId: '829e4567-e89b-42d3-a456-426614174002',
      expectedCounts: VALID_COUNTS,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid exportJobId', () => {
    expect(
      ExportSmokeStartResponseSchema.safeParse({
        exportJobId: 'not-a-uuid',
        expectedCounts: VALID_COUNTS,
      }).success
    ).toBe(false);
  });
});

describe('ExportSmokeStatusRequestSchema / ExportSmokeStatusResponseSchema', () => {
  it('requires a uuid jobId', () => {
    expect(
      ExportSmokeStatusRequestSchema.safeParse({
        jobId: '829e4567-e89b-42d3-a456-426614174000',
      }).success
    ).toBe(true);
    expect(ExportSmokeStatusRequestSchema.safeParse({ jobId: 'not-a-uuid' }).success).toBe(false);
  });

  it('accepts a completed status with a download URL', () => {
    expect(
      ExportSmokeStatusResponseSchema.safeParse({
        status: 'completed',
        downloadUrl: 'https://example.invalid/exports/token',
      }).success
    ).toBe(true);
  });

  it('accepts a pending status with a null download URL', () => {
    expect(
      ExportSmokeStatusResponseSchema.safeParse({ status: 'pending', downloadUrl: null }).success
    ).toBe(true);
  });
});
