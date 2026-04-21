import { describe, it, expect, vi } from 'vitest';
import type { UserService } from '@tzurot/common-types';
import type { ProvisionedRequest } from '../types.js';
import { resolveProvisionedUserId } from './resolveProvisionedUserId.js';

function mockUserService(shellReturn: string): UserService {
  return {
    getOrCreateUserShell: vi.fn().mockResolvedValue(shellReturn),
  } as unknown as UserService;
}

describe('resolveProvisionedUserId', () => {
  it('returns req.provisionedUserId when middleware attached it (common path)', async () => {
    const req = {
      userId: 'discord-123',
      provisionedUserId: 'internal-uuid-abc',
    } as ProvisionedRequest;
    const userService = mockUserService('shell-uuid-should-not-be-used');

    const result = await resolveProvisionedUserId(req, userService, 'discord-123');

    expect(result).toBe('internal-uuid-abc');
    // Structural proof the provisioned path won: shell must NOT have been called.
    expect(userService.getOrCreateUserShell).not.toHaveBeenCalled();
  });

  it('falls back to getOrCreateUserShell when middleware fell through (shadow-mode)', async () => {
    const req = {
      userId: 'discord-123',
      // provisionedUserId intentionally absent — middleware shadow-mode
      // fell through (missing/malformed headers, bot user, etc.)
    } as ProvisionedRequest;
    const userService = mockUserService('shell-uuid-fallback');

    const result = await resolveProvisionedUserId(req, userService, 'discord-123');

    expect(result).toBe('shell-uuid-fallback');
    expect(userService.getOrCreateUserShell).toHaveBeenCalledWith('discord-123');
  });
});
