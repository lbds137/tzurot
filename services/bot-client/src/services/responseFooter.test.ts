import { describe, it, expect, vi } from 'vitest';

const mockIsBotOwner = vi.fn();
vi.mock('@tzurot/common-types/utils/ownerMiddleware', () => ({
  isBotOwner: (id: string) => mockIsBotOwner(id),
}));

import { buildResponseFooter } from './responseFooter.js';

describe('buildResponseFooter', () => {
  it('is empty when nothing asks for a footer', () => {
    expect(buildResponseFooter({})).toBe('');
  });

  it('renders the model indicator from modelUsed', () => {
    const footer = buildResponseFooter({ modelUsed: 'model-b' });
    expect(footer).toContain('-# ');
    expect(footer).toContain('model-b');
  });

  it('omits the model indicator when showModelFooter is false', () => {
    expect(buildResponseFooter({ modelUsed: 'model-b', showModelFooter: false })).toBe('');
  });

  it('adds the incognito badge', () => {
    expect(buildResponseFooter({ incognitoModeActive: true })).toContain('-# ');
  });

  it('shows owner-only TTS notices to the bot owner only', () => {
    mockIsBotOwner.mockReturnValue(true);
    expect(buildResponseFooter({ ttsNotices: ['skipped'], recipientUserId: 'owner' })).toContain(
      'skipped'
    );
    mockIsBotOwner.mockReturnValue(false);
    expect(buildResponseFooter({ ttsNotices: ['skipped'], recipientUserId: 'other' })).toBe('');
  });

  it('drops TTS notices when there is no recipient (fail closed)', () => {
    mockIsBotOwner.mockReturnValue(true);
    expect(buildResponseFooter({ ttsNotices: ['skipped'] })).toBe('');
  });
});
