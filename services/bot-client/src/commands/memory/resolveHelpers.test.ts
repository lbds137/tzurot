/**
 * Tests for memory command personality resolution helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveOptionalPersonality, resolveRequiredPersonality } from './resolveHelpers.js';
import {
  AUTOCOMPLETE_ERROR_SENTINEL,
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
} from '../../utils/apiCheck.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { UserClient } from '@tzurot/clients';

function mkUser(discordId = 'user-123'): UserClient {
  // Cache-key only — `actor` is the only field resolvePersonalityId reads via
  // the mocked autocomplete module. Cast through unknown to bypass the full
  // typed-client surface.
  return { actor: discordId } as unknown as UserClient;
}

// Mock the autocomplete module
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: vi.fn(),
}));

import { resolvePersonalityId } from './autocomplete.js';
const mockResolvePersonalityId = vi.mocked(resolvePersonalityId);

const mockEditReply = vi.fn().mockResolvedValue(undefined);

function createMockContext(): DeferredCommandContext {
  return {
    user: { id: 'user-123' },
    editReply: mockEditReply,
  } as unknown as DeferredCommandContext;
}

describe('resolveOptionalPersonality', () => {
  let context: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return undefined when personalityInput is null', async () => {
    const result = await resolveOptionalPersonality(context, mkUser(), null);
    expect(result).toBeUndefined();
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
  });

  it('should return undefined when personalityInput is empty string', async () => {
    const result = await resolveOptionalPersonality(context, mkUser(), '');
    expect(result).toBeUndefined();
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
  });

  it('should return resolved ID when personality is found', async () => {
    mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid' });

    const user = mkUser();
    const result = await resolveOptionalPersonality(context, user, 'my-persona');
    expect(result).toBe('personality-uuid');
    expect(mockResolvePersonalityId).toHaveBeenCalledWith(user, 'my-persona');
  });

  it('should return null and send error reply when personality is not found', async () => {
    mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

    const result = await resolveOptionalPersonality(context, mkUser(), 'unknown');
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Character "unknown" not found. Use autocomplete to select a valid option.',
    });
  });

  it('returns null and sends autocomplete-unavailable reply when the list is unavailable (infra)', async () => {
    mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

    const result = await resolveOptionalPersonality(context, mkUser(), 'my-persona');
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
  });

  // Guards the sentinel path so the user gets "autocomplete unavailable"
  // wording (which suggests retrying) instead of the generic "not found"
  // message (which suggests the personality doesn't exist). The predicate
  // must short-circuit BEFORE `resolvePersonalityId` — otherwise the sentinel
  // flows through, fails the slug lookup, and the user sees the wrong error.
  it('returns null and sends autocomplete-unavailable reply when input is the sentinel', async () => {
    const result = await resolveOptionalPersonality(context, mkUser(), AUTOCOMPLETE_ERROR_SENTINEL);
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
    });
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
  });
});

describe('resolveRequiredPersonality', () => {
  let context: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return resolved ID when personality is found', async () => {
    mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid' });

    const user = mkUser();
    const result = await resolveRequiredPersonality(context, user, 'my-persona');
    expect(result).toBe('personality-uuid');
    expect(mockResolvePersonalityId).toHaveBeenCalledWith(user, 'my-persona');
  });

  it('should return null and send error reply when personality is not found', async () => {
    mockResolvePersonalityId.mockResolvedValue({ kind: 'not-found' });

    const result = await resolveRequiredPersonality(context, mkUser(), 'unknown');
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Character "unknown" not found. Use autocomplete to select a valid option.',
    });
  });

  it('returns null and sends autocomplete-unavailable reply when the list is unavailable (infra)', async () => {
    mockResolvePersonalityId.mockResolvedValue({ kind: 'unavailable' });

    const result = await resolveRequiredPersonality(context, mkUser(), 'my-persona');
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
  });

  it('should not send error reply on success', async () => {
    mockResolvePersonalityId.mockResolvedValue({ kind: 'found', id: 'personality-uuid' });

    await resolveRequiredPersonality(context, mkUser(), 'my-persona');
    expect(mockEditReply).not.toHaveBeenCalled();
  });

  it('returns null and sends autocomplete-unavailable reply when input is the sentinel', async () => {
    const result = await resolveRequiredPersonality(context, mkUser(), AUTOCOMPLETE_ERROR_SENTINEL);
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
    });
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
  });
});
