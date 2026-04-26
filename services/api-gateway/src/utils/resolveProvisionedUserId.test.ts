import { describe, it, expect } from 'vitest';
import type { ProvisionedRequest } from '../types.js';
import { resolveProvisionedUserId } from './resolveProvisionedUserId.js';

describe('resolveProvisionedUserId', () => {
  it('returns req.provisionedUserId when middleware attached it', () => {
    const req = {
      userId: 'discord-123',
      provisionedUserId: 'internal-uuid-abc',
    } as ProvisionedRequest;

    expect(resolveProvisionedUserId(req)).toBe('internal-uuid-abc');
  });

  it('throws when called on a request without provisionedUserId', () => {
    // Defense-in-depth: should be impossible if requireProvisionedUser middleware
    // is mounted on the route. Throwing surfaces middleware-misconfiguration
    // bugs at the first request rather than producing silent data corruption.
    const req = {
      userId: 'discord-123',
      // provisionedUserId intentionally absent
    } as ProvisionedRequest;

    expect(() => resolveProvisionedUserId(req)).toThrow(
      /requireProvisionedUser middleware is missing/
    );
  });
});
