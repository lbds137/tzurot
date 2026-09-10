/**
 * Tests for the shared per-user row formatting used by every retention job
 * surface (live report, nag, rehearsal).
 */

import { describe, it, expect } from 'vitest';
import { formatRetentionUserLines, MAX_LISTED_USERS } from './retentionRows.js';
import type { RetentionPreviewUser } from './types.js';

function makeUser(overrides: Partial<RetentionPreviewUser> = {}): RetentionPreviewUser {
  return {
    discordId: '990000000000000000',
    username: 'inactive0',
    inactiveSince: '2025-09-01T00:00:00.000Z',
    reason: 'unreachable',
    ownedCharacters: { toDelete: 1, toReHome: 0 },
    ...overrides,
  };
}

describe('formatRetentionUserLines', () => {
  it('renders all three identity tokens per user line', () => {
    const lines = formatRetentionUserLines([makeUser()]);

    expect(lines[0]).toContain('<@990000000000000000>');
    expect(lines[0]).toContain('@inactive0');
    expect(lines[0]).toContain('`990000000000000000`');
  });

  it('escapes markdown in the username (user-controlled text in an owner embed)', () => {
    const lines = formatRetentionUserLines([makeUser({ username: '*bold*`tick`' })]);

    expect(lines[0]).toContain('\\*bold\\*\\`tick\\`');
    expect(lines[0]).not.toContain('@*bold*');
  });

  it('omits the username token entirely when the stored username is empty', () => {
    const lines = formatRetentionUserLines([makeUser({ username: '   ' })]);

    expect(lines[0]).toContain('<@990000000000000000> — `990000000000000000`');
    expect(lines[0]).not.toContain('@ —');
  });

  it('renders the bystander reason label', () => {
    const lines = formatRetentionUserLines([makeUser({ reason: 'bystander' })]);

    expect(lines[0]).toContain('never used directly');
  });

  it('caps the listed users and reports the overflow with no note', () => {
    const users = Array.from({ length: 14 }, (_, i) =>
      makeUser({ discordId: `99000000000000${String(i).padStart(4, '0')}` })
    );

    const lines = formatRetentionUserLines(users);

    expect(lines).toHaveLength(MAX_LISTED_USERS + 1);
    expect(lines[MAX_LISTED_USERS]).toBe('…and 4 more');
  });

  it('appends the overflow note when one is supplied', () => {
    const users = Array.from({ length: 12 }, (_, i) =>
      makeUser({ discordId: `99000000000000${String(i).padStart(4, '0')}` })
    );

    const lines = formatRetentionUserLines(users, '(see the preview CLI)');

    expect(lines[MAX_LISTED_USERS]).toBe('…and 2 more (see the preview CLI)');
  });

  it('renders no overflow line when the cohort fits within the cap', () => {
    const lines = formatRetentionUserLines([makeUser()]);

    expect(lines).toHaveLength(1);
  });
});
