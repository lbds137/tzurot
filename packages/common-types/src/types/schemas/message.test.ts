/**
 * Message Schema Tests
 *
 * Validates Zod schemas for conversation messages and cross-channel history types.
 */

import { describe, it, expect } from 'vitest';
import { MessageRole } from '../../constants/index.js';
import {
  attachmentEnrichmentSchema,
  crossChannelMessageSchema,
  crossChannelHistoryGroupSchema,
  messageMetadataSchema,
  referencedMessageSchema,
  referenceAuthorRoleSchema,
  storedReferencedMessageSchema,
  type CrossChannelMessage,
  type CrossChannelHistoryGroupEntry,
} from './message.js';

describe('crossChannelMessageSchema', () => {
  it('should accept a valid message with all fields', () => {
    const msg: CrossChannelMessage = {
      id: 'msg-1',
      role: MessageRole.User,
      content: 'Hello from another channel',
      tokenCount: 10,
      createdAt: '2026-02-26T10:00:00.000Z',
      personaId: 'persona-1',
      personaName: 'Alice',
      discordUsername: 'alice#1234',
      personalityId: 'pers-1',
      personalityName: 'TestBot',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should accept a minimal message with only required fields', () => {
    const msg = {
      role: MessageRole.Assistant,
      content: 'Response',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBeUndefined();
      expect(result.data.tokenCount).toBeUndefined();
      expect(result.data.createdAt).toBeUndefined();
      expect(result.data.personaId).toBeUndefined();
      expect(result.data.personaName).toBeUndefined();
      expect(result.data.discordUsername).toBeUndefined();
      expect(result.data.personalityId).toBeUndefined();
      expect(result.data.personalityName).toBeUndefined();
    }
  });

  it('should reject invalid role value', () => {
    const msg = {
      role: 'invalid-role',
      content: 'Hello',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('should reject missing content', () => {
    const msg = {
      role: MessageRole.User,
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('should reject missing role', () => {
    const msg = {
      content: 'Hello',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

describe('crossChannelHistoryGroupSchema', () => {
  it('should accept a valid guild group', () => {
    const group: CrossChannelHistoryGroupEntry = {
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'g-1', name: 'Test Server' },
        channel: { id: 'ch-1', name: 'general', type: 'text' },
      },
      messages: [
        { role: MessageRole.User, content: 'Hello', personaName: 'Alice' },
        { role: MessageRole.Assistant, content: 'Hi there' },
      ],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });

  it('should accept a valid DM group', () => {
    const group: CrossChannelHistoryGroupEntry = {
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'Direct Message', type: 'dm' },
      },
      messages: [{ role: MessageRole.User, content: 'DM message' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });

  it('should reject invalid channelEnvironment type', () => {
    const group = {
      channelEnvironment: {
        type: 'invalid',
        channel: { id: 'ch-1', name: 'test', type: 'text' },
      },
      messages: [{ role: MessageRole.User, content: 'Hello' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(false);
  });

  it('should reject missing channel in environment', () => {
    const group = {
      channelEnvironment: { type: 'guild' },
      messages: [{ role: MessageRole.User, content: 'Hello' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(false);
  });

  it('should accept group with empty messages array', () => {
    const group = {
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      },
      messages: [],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });

  it('should reject when messages contain invalid role', () => {
    const group = {
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      },
      messages: [{ role: 'invalid', content: 'Hello' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(false);
  });

  it('should accept guild environment with optional thread and category', () => {
    const group = {
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'g-1', name: 'Server' },
        category: { id: 'cat-1', name: 'General' },
        channel: { id: 'ch-1', name: 'general', type: 'text' },
        thread: {
          id: 'thread-1',
          name: 'My Thread',
          parentChannel: { id: 'ch-1', name: 'general', type: 'text' },
        },
      },
      messages: [{ role: MessageRole.User, content: 'Thread message' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });
});

describe('referencedMessageSchema', () => {
  const base = {
    referenceNumber: 1,
    discordMessageId: 'd1',
    discordUserId: 'u1',
    authorUsername: 'someone',
    authorDisplayName: 'Someone',
    content: 'referenced',
    embeds: '',
    timestamp: '2026-06-01T00:00:00.000Z',
    locationContext: '',
  };

  it('accepts a minimal reference without authorIsBot (presence-encoded)', () => {
    const result = referencedMessageSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.success && result.data.authorIsBot).toBeUndefined();
  });

  it('accepts authorIsBot true for bot-authored references', () => {
    const result = referencedMessageSchema.safeParse({ ...base, authorIsBot: true });
    expect(result.success).toBe(true);
    expect(result.success && result.data.authorIsBot).toBe(true);
  });

  it('rejects a non-boolean authorIsBot', () => {
    const result = referencedMessageSchema.safeParse({ ...base, authorIsBot: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects an explicit false (presence-encoding enforced at parse time)', () => {
    const result = referencedMessageSchema.safeParse({ ...base, authorIsBot: false });
    expect(result.success).toBe(false);
  });

  it('accepts a reference without authorRole (legacy / pre-classifier)', () => {
    const result = referencedMessageSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.success && result.data.authorRole).toBeUndefined();
  });

  it('accepts a valid authorRole', () => {
    const result = referencedMessageSchema.safeParse({ ...base, authorRole: 'bot' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.authorRole).toBe('bot');
  });

  it('rejects an invalid authorRole', () => {
    const result = referencedMessageSchema.safeParse({ ...base, authorRole: 'system' });
    expect(result.success).toBe(false);
  });

  it('carries authorPersonalityId across the bot-client → worker boundary', () => {
    // bot-client resolves it; ai-worker renders `from_id` from it. Between
    // them the payload is parsed in strip mode, so an undeclared key would be
    // deleted with nothing failing — the same seam attachmentEnrichment sits on.
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const result = referencedMessageSchema.safeParse({ ...base, authorPersonalityId: id });
    expect(result.success).toBe(true);
    expect(result.success && result.data.authorPersonalityId).toBe(id);
  });

  it('accepts a reference without authorPersonalityId (human author, or a resolver miss)', () => {
    const result = referencedMessageSchema.safeParse(base);
    expect(result.success && result.data.authorPersonalityId).toBeUndefined();
  });
});

describe('referenceAuthorRoleSchema', () => {
  it('accepts the three valid roles', () => {
    for (const role of ['assistant', 'user', 'bot'] as const) {
      expect(referenceAuthorRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('rejects an unknown role', () => {
    expect(referenceAuthorRoleSchema.safeParse('system').success).toBe(false);
  });
});

describe('attachmentEnrichmentSchema', () => {
  const entry = { url: 'https://cdn/a.png', kind: 'image', description: 'a cat' };

  it('accepts both modalities', () => {
    expect(attachmentEnrichmentSchema.safeParse(entry).success).toBe(true);
    expect(
      attachmentEnrichmentSchema.safeParse({ ...entry, kind: 'voice', description: 'hello' })
        .success
    ).toBe(true);
  });

  it('rejects a modality with no element to render as', () => {
    // `file` is deliberately absent: RenderableFile has no enrichment slot, so
    // an entry claiming one could never be drawn.
    expect(attachmentEnrichmentSchema.safeParse({ ...entry, kind: 'file' }).success).toBe(false);
  });

  it('requires the URL — it is the key the enrichment is found by at replay', () => {
    const { url: _dropped, ...withoutUrl } = entry;
    expect(attachmentEnrichmentSchema.safeParse(withoutUrl).success).toBe(false);
  });
});

describe('storedReferencedMessageSchema — what survives the DB round trip', () => {
  // `parseMessageMetadata` runs this schema over every history row on the way
  // OUT of Postgres, in strip mode. An undeclared key is therefore deleted
  // silently between the INSERT and the renderer, which is precisely how a
  // reference's enrichment could stop being persisted without anything failing.
  const stored = {
    discordMessageId: 'msg-1',
    authorUsername: 'alice',
    authorDisplayName: 'Alice',
    content: 'look at this',
    timestamp: '2026-07-31T12:00:00.000Z',
    locationContext: '',
    attachmentEnrichment: [{ url: 'https://cdn/a.png', kind: 'image', description: 'a cat' }],
  };

  it('carries attachmentEnrichment through', () => {
    const parsed = storedReferencedMessageSchema.parse(stored);

    expect(parsed.attachmentEnrichment).toEqual(stored.attachmentEnrichment);
  });

  it('carries authorPersonalityId through, so a replayed quote can still bind by id', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    expect(
      storedReferencedMessageSchema.parse({ ...stored, authorPersonalityId: id })
        .authorPersonalityId
    ).toBe(id);
    expect(
      messageMetadataSchema.parse({
        referencedMessages: [{ ...stored, authorPersonalityId: id }],
      }).referencedMessages?.[0].authorPersonalityId
    ).toBe(id);
  });

  it('strips a key the schema does not declare', () => {
    const parsed = storedReferencedMessageSchema.parse({ ...stored, inventedField: 'gone' });

    expect(parsed).not.toHaveProperty('inventedField');
  });

  it('survives nested inside messageMetadata, which is the shape actually stored', () => {
    const parsed = messageMetadataSchema.parse({ referencedMessages: [stored] });

    expect(parsed.referencedMessages?.[0].attachmentEnrichment).toEqual(
      stored.attachmentEnrichment
    );
  });

  /**
   * The Zod strip is invisible to a mocked client: an undeclared key is deleted
   * before any consumer sees it, so a forward would silently render
   * unattributed again with every unit test still green. `isForwarded` was lost
   * exactly this way once (see the regression tests in schemas.test.ts); these
   * pin the survival of its successor at the boundary itself.
   */
  it('preserves forwardedFrom through the boundary parse', () => {
    const parsed = messageMetadataSchema.parse({
      isForwarded: true,
      forwardedFrom: {
        authorName: 'COLD',
        authorId: '1472768398135001108',
        timestamp: '2026-08-18T11:13:53.053Z',
        channelName: 'lilith',
      },
    });

    expect(parsed.forwardedFrom).toEqual({
      authorName: 'COLD',
      authorId: '1472768398135001108',
      timestamp: '2026-08-18T11:13:53.053Z',
      channelName: 'lilith',
    });
  });

  it('accepts a partially-resolved origin and a forward with none at all', () => {
    // The original was unreadable but the snapshot still carried its post time.
    expect(
      messageMetadataSchema.parse({
        forwardedFrom: { timestamp: '2026-08-18T11:13:53.053Z' },
      }).forwardedFrom
    ).toEqual({ timestamp: '2026-08-18T11:13:53.053Z' });

    // A row written before this field existed stays valid and simply has none.
    expect(messageMetadataSchema.parse({ isForwarded: true }).forwardedFrom).toBeUndefined();
  });
});
