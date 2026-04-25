import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock isBotOwner before import — we need to control admin determination per test
const mockIsBotOwner = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types', () => ({
  isBotOwner: mockIsBotOwner,
}));

import type { DiagnosticLog } from './types.js';
import { computeViewContext } from './viewContext.js';

const OWNER_DISCORD_ID = '111111111111111111';
const NON_OWNER_DISCORD_ID = '222222222222222222';
const ADMIN_DISCORD_ID = '999999999999999999';

function buildLog(personalityOwnerDiscordId?: string): DiagnosticLog {
  return {
    id: 'log-123',
    requestId: 'req-456',
    personalityId: 'pers-uuid',
    userId: OWNER_DISCORD_ID,
    guildId: 'guild-1',
    channelId: 'chan-1',
    model: 'glm-4.7',
    provider: 'z-ai',
    durationMs: 1000,
    createdAt: '2026-04-25T17:00:00Z',
    data: {
      meta: {
        requestId: 'req-456',
        personalityId: 'pers-uuid',
        personalityName: 'TestPersonality',
        personalityOwnerDiscordId,
        userId: OWNER_DISCORD_ID,
        guildId: 'guild-1',
        channelId: 'chan-1',
        timestamp: '2026-04-25T17:00:00Z',
      },
      // Other fields are not relevant to context computation
    } as DiagnosticLog['data'],
  };
}

describe('computeViewContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns canViewCharacter:true when inspector IS the personality owner', () => {
    mockIsBotOwner.mockReturnValue(false);
    const log = buildLog(OWNER_DISCORD_ID);
    const ctx = computeViewContext(log, OWNER_DISCORD_ID);
    expect(ctx.canViewCharacter).toBe(true);
  });

  it('returns canViewCharacter:false when inspector is NOT the personality owner', () => {
    mockIsBotOwner.mockReturnValue(false);
    const log = buildLog(OWNER_DISCORD_ID);
    const ctx = computeViewContext(log, NON_OWNER_DISCORD_ID);
    expect(ctx.canViewCharacter).toBe(false);
  });

  it('returns canViewCharacter:true when inspector is the bot admin (regardless of ownership)', () => {
    mockIsBotOwner.mockReturnValue(true);
    const log = buildLog(OWNER_DISCORD_ID);
    const ctx = computeViewContext(log, ADMIN_DISCORD_ID);
    expect(ctx.canViewCharacter).toBe(true);
    expect(mockIsBotOwner).toHaveBeenCalledWith(ADMIN_DISCORD_ID);
  });

  it('returns canViewCharacter:true for legacy logs without personalityOwnerDiscordId (backward compat)', () => {
    // Logs written before PR-#898 do not carry the owner field. Pre-PR behavior
    // was "show everything" — preserve that for the 24h transition window.
    mockIsBotOwner.mockReturnValue(false);
    const log = buildLog(undefined);
    const ctx = computeViewContext(log, NON_OWNER_DISCORD_ID);
    expect(ctx.canViewCharacter).toBe(true);
  });

  it('does not treat empty string ownerDiscordId as undefined (legacy fallback only triggers on undefined)', () => {
    mockIsBotOwner.mockReturnValue(false);
    const log = buildLog('');
    const ctx = computeViewContext(log, NON_OWNER_DISCORD_ID);
    // Empty string !== NON_OWNER_DISCORD_ID, and admin is false; so redact.
    expect(ctx.canViewCharacter).toBe(false);
  });
});
