/**
 * Tests for memory command personality resolution helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveOptionalPersonality, resolveRequiredPersonality } from './resolveHelpers.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

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
    const result = await resolveOptionalPersonality(context, 'user-123', null);
    expect(result).toBeUndefined();
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
  });

  it('should return undefined when personalityInput is empty string', async () => {
    const result = await resolveOptionalPersonality(context, 'user-123', '');
    expect(result).toBeUndefined();
    expect(mockResolvePersonalityId).not.toHaveBeenCalled();
  });

  it('should return resolved ID when personality is found', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid');

    const result = await resolveOptionalPersonality(context, 'user-123', 'my-persona');
    expect(result).toBe('personality-uuid');
    expect(mockResolvePersonalityId).toHaveBeenCalledWith('user-123', 'my-persona');
  });

  it('should return null and send error reply when personality is not found', async () => {
    mockResolvePersonalityId.mockResolvedValue(null);

    const result = await resolveOptionalPersonality(context, 'user-123', 'unknown');
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({
      content:
        '❌ Personality "unknown" not found. Use autocomplete to select a valid personality.',
    });
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
    mockResolvePersonalityId.mockResolvedValue('personality-uuid');

    const result = await resolveRequiredPersonality(context, 'user-123', 'my-persona');
    expect(result).toBe('personality-uuid');
    expect(mockResolvePersonalityId).toHaveBeenCalledWith('user-123', 'my-persona');
  });

  it('should return null and send error reply when personality is not found', async () => {
    mockResolvePersonalityId.mockResolvedValue(null);

    const result = await resolveRequiredPersonality(context, 'user-123', 'unknown');
    expect(result).toBeNull();
    expect(mockEditReply).toHaveBeenCalledWith({
      content:
        '❌ Personality "unknown" not found. Use autocomplete to select a valid personality.',
    });
  });

  it('should not send error reply on success', async () => {
    mockResolvePersonalityId.mockResolvedValue('personality-uuid');

    await resolveRequiredPersonality(context, 'user-123', 'my-persona');
    expect(mockEditReply).not.toHaveBeenCalled();
  });
});
