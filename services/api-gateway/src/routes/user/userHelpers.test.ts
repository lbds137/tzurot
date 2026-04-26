/**
 * Tests for shared user helpers (getOrCreateInternalUser)
 */

import { describe, it, expect } from 'vitest';
import { getOrCreateInternalUser } from './userHelpers.js';
import type { ProvisionedRequest } from '../../types.js';

describe('getOrCreateInternalUser', () => {
  it('returns the provisioned UUIDs attached by the requireProvisionedUser middleware', () => {
    const req = {
      userId: 'discord-123',
      provisionedUserId: 'user-uuid-from-middleware',
      provisionedDefaultPersonaId: 'persona-uuid-from-middleware',
    } as ProvisionedRequest;

    expect(getOrCreateInternalUser(req)).toEqual({
      id: 'user-uuid-from-middleware',
      defaultPersonaId: 'persona-uuid-from-middleware',
    });
  });

  it('throws when provisionedUserId is missing', () => {
    // Defense-in-depth: should be impossible if requireProvisionedUser middleware
    // is mounted on the route. Throwing surfaces middleware-misconfiguration.
    const req = {
      userId: 'discord-123',
      // provisionedUserId intentionally absent
    } as ProvisionedRequest;

    expect(() => getOrCreateInternalUser(req)).toThrow(
      /requireProvisionedUser middleware is missing/
    );
  });

  it('throws when provisionedDefaultPersonaId is missing', () => {
    // Same invariant as above — middleware always attaches both fields together
    // (both come from `getOrCreateUser`'s ProvisionedUser return type, which
    // structurally guarantees non-null defaultPersonaId).
    const req = {
      userId: 'discord-123',
      provisionedUserId: 'user-uuid',
      // provisionedDefaultPersonaId intentionally absent
    } as ProvisionedRequest;

    expect(() => getOrCreateInternalUser(req)).toThrow(
      /requireProvisionedUser middleware is missing/
    );
  });
});
