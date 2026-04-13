import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendError = vi.fn();
vi.mock('./responseHelpers.js', () => ({
  sendError: (...args: unknown[]) => mockSendError(...args),
}));

vi.mock('./errorResponses.js', () => ({
  ErrorResponses: {
    validationError: (msg: string) => ({ error: 'VALIDATION', message: msg }),
  },
}));

import { resolveUserIdOrSendError } from './routeHelpers.js';
import type { UserService } from '@tzurot/common-types';

describe('resolveUserIdOrSendError', () => {
  const mockRes = {} as never;
  const mockGetOrCreateUser = vi.fn();
  const mockUserService = { getOrCreateUser: mockGetOrCreateUser } as unknown as UserService;

  beforeEach(() => vi.resetAllMocks());

  it('returns the internal user UUID on success', async () => {
    mockGetOrCreateUser.mockResolvedValue('internal-uuid-abc');

    const result = await resolveUserIdOrSendError(mockUserService, 'discord-123', mockRes);

    expect(result).toBe('internal-uuid-abc');
    expect(mockGetOrCreateUser).toHaveBeenCalledWith('discord-123', 'discord-123');
    expect(mockSendError).not.toHaveBeenCalled();
  });

  it('returns null and sends validation error when user is a bot', async () => {
    mockGetOrCreateUser.mockResolvedValue(null);

    const result = await resolveUserIdOrSendError(mockUserService, 'bot-456', mockRes);

    expect(result).toBeNull();
    expect(mockSendError).toHaveBeenCalledOnce();
  });

  it('sends the unified error message "Cannot create user for bot"', async () => {
    mockGetOrCreateUser.mockResolvedValue(null);

    await resolveUserIdOrSendError(mockUserService, 'bot-456', mockRes);

    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({ message: 'Cannot create user for bot' })
    );
  });

  it('passes the same discord ID as both discordId and username args', async () => {
    // Current call-site convention: username doubles as discordId since real username
    // isn't available at the route layer. Preserved by the helper.
    mockGetOrCreateUser.mockResolvedValue('uuid');

    await resolveUserIdOrSendError(mockUserService, 'discord-xyz', mockRes);

    expect(mockGetOrCreateUser).toHaveBeenCalledWith('discord-xyz', 'discord-xyz');
  });
});
