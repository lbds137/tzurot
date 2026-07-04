/**
 * Tests for UserContextResolver
 *
 * The resolver now delegates provisioning + persona cascade + epoch to the
 * gateway's `routing-context` endpoint; these tests mock the `ServiceClient`
 * and assert the request shape + response→`UserContextResult` mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveUserContext } from './UserContextResolver.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { ServiceClient } from '@tzurot/clients';

const createMockPersonality = (): LoadedPersonality =>
  ({
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    ownerId: 'owner-uuid-test',
    systemPrompt: 'Test prompt',
    model: 'test-model',
    provider: 'openrouter',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 131072,
    characterInfo: '',
    personalityTraits: '',
    voiceEnabled: false,
  }) as LoadedPersonality;

const OK_DATA = {
  userId: '550e8400-e29b-41d4-a716-446655440000',
  personaId: '550e8400-e29b-41d4-a716-446655440003',
  personaName: 'Alice',
  timezone: 'America/New_York',
  contextEpoch: null as string | null,
};

function depsWith(routingContextCreate: ReturnType<typeof vi.fn>): {
  serviceClient: ServiceClient;
} {
  return { serviceClient: { routingContextCreate } as unknown as ServiceClient };
}

describe('resolveUserContext', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('maps a successful response to the UserContextResult shape', async () => {
    const deps = depsWith(vi.fn().mockResolvedValue({ ok: true, data: OK_DATA }));
    const user = { id: 'discord-user-123', username: 'alice', bot: false };

    const result = await resolveUserContext(user, createMockPersonality(), 'Alice Display', deps);

    expect(result).toEqual({
      internalUserId: '550e8400-e29b-41d4-a716-446655440000',
      discordUserId: 'discord-user-123',
      personaId: '550e8400-e29b-41d4-a716-446655440003',
      personaName: 'Alice',
      userTimezone: 'America/New_York',
      contextEpoch: undefined,
      history: [],
    });
  });

  it('calls routingContextCreate with the author + personality facts', async () => {
    const routingContextCreate = vi.fn().mockResolvedValue({ ok: true, data: OK_DATA });
    const user = { id: 'discord-123', username: 'bob', bot: false };

    await resolveUserContext(
      user,
      createMockPersonality(),
      'Bob Display',
      depsWith(routingContextCreate)
    );

    expect(routingContextCreate).toHaveBeenCalledWith({
      discordId: 'discord-123',
      username: 'bob',
      displayName: 'Bob Display',
      isBot: false,
      personalityId: '550e8400-e29b-41d4-a716-446655440002',
    });
  });

  it('parses an ISO contextEpoch into a Date', async () => {
    const deps = depsWith(
      vi.fn().mockResolvedValue({
        ok: true,
        data: { ...OK_DATA, contextEpoch: '2024-06-01T00:00:00.000Z' },
      })
    );
    const user = { id: 'discord-123', username: 'alice' };

    const result = await resolveUserContext(user, createMockPersonality(), 'Alice', deps);

    expect(result.contextEpoch).toEqual(new Date('2024-06-01T00:00:00.000Z'));
  });

  it('maps a null contextEpoch to undefined', async () => {
    const deps = depsWith(
      vi.fn().mockResolvedValue({ ok: true, data: { ...OK_DATA, contextEpoch: null } })
    );
    const user = { id: 'discord-123', username: 'alice' };

    const result = await resolveUserContext(user, createMockPersonality(), 'Alice', deps);

    expect(result.contextEpoch).toBeUndefined();
  });

  it('passes a null personaName through', async () => {
    const deps = depsWith(
      vi.fn().mockResolvedValue({ ok: true, data: { ...OK_DATA, personaName: null } })
    );
    const user = { id: 'discord-123', username: 'alice' };

    const result = await resolveUserContext(user, createMockPersonality(), 'Alice', deps);

    expect(result.personaName).toBeNull();
  });

  it('returns an empty history array (deferred to the caller)', async () => {
    const deps = depsWith(vi.fn().mockResolvedValue({ ok: true, data: OK_DATA }));
    const user = { id: 'discord-123', username: 'alice' };

    const result = await resolveUserContext(user, createMockPersonality(), 'Alice', deps);

    expect(result.history).toEqual([]);
  });

  it('throws the bot-author message only for a bot 400', async () => {
    const deps = depsWith(
      vi.fn().mockResolvedValue({ ok: false, error: 'bot author', status: 400 })
    );
    const user = { id: 'bot-123', username: 'bot', bot: true };

    await expect(resolveUserContext(user, createMockPersonality(), 'Bot', deps)).rejects.toThrow(
      'Cannot process messages from bots'
    );
  });

  it('surfaces the real status for a bot author whose request fails non-400', async () => {
    // A bot reaching the endpoint AND a non-400 failure must not be masked as a
    // bot-rejection — the operator needs the real cause. status:0 is the
    // transport's sentinel for a non-HTTP failure (timeout / network error /
    // response-contract drift); a real 5xx carries its own HTTP status instead.
    const deps = depsWith(
      vi.fn().mockResolvedValue({ ok: false, error: 'upstream timeout', status: 0 })
    );
    const user = { id: 'bot-123', username: 'bot', bot: true };

    await expect(resolveUserContext(user, createMockPersonality(), 'Bot', deps)).rejects.toThrow(
      /status 0.*upstream timeout/
    );
  });

  it('throws a status-bearing error when a non-bot request fails', async () => {
    const deps = depsWith(
      vi.fn().mockResolvedValue({ ok: false, error: 'gateway exploded', status: 503 })
    );
    const user = { id: 'discord-123', username: 'alice', bot: false };

    await expect(resolveUserContext(user, createMockPersonality(), 'Alice', deps)).rejects.toThrow(
      /status 503.*gateway exploded/
    );
  });

  it('surfaces the real status for a NON-bot request that 400s (not the bot message)', async () => {
    // A non-bot 400 (e.g. malformed input slipping past local validation) must
    // fall through to the generic status-bearing error, never the bot wording.
    const deps = depsWith(
      vi.fn().mockResolvedValue({ ok: false, error: 'validation error', status: 400 })
    );
    const user = { id: 'discord-123', username: 'alice', bot: false };

    await expect(resolveUserContext(user, createMockPersonality(), 'Alice', deps)).rejects.toThrow(
      /status 400.*validation error/
    );
  });
});
