import { describe, it, expect } from 'vitest';
import {
  TYPE_LABELS,
  MODE_LABELS,
  SCOPE_LABELS,
  SCOPE_LABEL_LIST,
  formatScopeWithId,
  parseScopeInput,
  formatTypeLabel,
} from './denyLabels.js';

describe('TYPE_LABELS', () => {
  it('maps USER to User', () => {
    expect(TYPE_LABELS.USER).toBe('User');
  });

  it('maps GUILD to Server', () => {
    expect(TYPE_LABELS.GUILD).toBe('Server');
  });
});

describe('MODE_LABELS', () => {
  it('maps BLOCK to Block', () => {
    expect(MODE_LABELS.BLOCK).toBe('Block');
  });

  it('maps MUTE to Mute', () => {
    expect(MODE_LABELS.MUTE).toBe('Mute');
  });
});

describe('SCOPE_LABELS', () => {
  it('maps BOT to Bot-wide', () => {
    expect(SCOPE_LABELS.BOT).toBe('Bot-wide');
  });

  it('maps GUILD to Server', () => {
    expect(SCOPE_LABELS.GUILD).toBe('Server');
  });

  it('maps CHANNEL to Channel', () => {
    expect(SCOPE_LABELS.CHANNEL).toBe('Channel');
  });

  it('maps PERSONALITY to Character', () => {
    expect(SCOPE_LABELS.PERSONALITY).toBe('Character');
  });
});

describe('SCOPE_LABEL_LIST', () => {
  it('renders the exact comma-joined list with a trailing "or"', () => {
    expect(SCOPE_LABEL_LIST).toBe('Bot-wide, Server, Channel, or Character');
  });
});

describe('formatScopeWithId', () => {
  it('renders BOT scope without the scope ID', () => {
    expect(formatScopeWithId('BOT', '*')).toBe('Bot-wide');
  });

  it('renders GUILD scope with the scope ID', () => {
    expect(formatScopeWithId('GUILD', 'guild-123')).toBe('Server: guild-123');
  });

  it('renders CHANNEL scope with the scope ID', () => {
    expect(formatScopeWithId('CHANNEL', 'chan-456')).toBe('Channel: chan-456');
  });

  it('renders PERSONALITY scope with the scope ID', () => {
    expect(formatScopeWithId('PERSONALITY', 'pers-789')).toBe('Character: pers-789');
  });

  it('renders the scope ID plain by default (browse metadata rows)', () => {
    expect(formatScopeWithId('CHANNEL', 'chan-456')).toBe('Channel: chan-456');
  });

  it('renders the scope ID plain when monospaceId is explicitly false', () => {
    expect(formatScopeWithId('CHANNEL', 'chan-456', { monospaceId: false })).toBe(
      'Channel: chan-456'
    );
  });

  it('wraps the scope ID in backticks when monospaceId is set (detail card)', () => {
    expect(formatScopeWithId('CHANNEL', 'chan-456', { monospaceId: true })).toBe(
      'Channel: `chan-456`'
    );
  });

  it('renders BOT scope without backticks or a colon even when monospaceId is set', () => {
    expect(formatScopeWithId('BOT', '*', { monospaceId: true })).toBe('Bot-wide');
  });
});

describe('parseScopeInput', () => {
  it.each([
    ['GUILD', 'GUILD'],
    ['guild', 'GUILD'],
    ['Server', 'GUILD'],
    ['server', 'GUILD'],
    ['BOT', 'BOT'],
    ['bot', 'BOT'],
    ['Bot-wide', 'BOT'],
    ['bot-wide', 'BOT'],
    ['CHANNEL', 'CHANNEL'],
    ['channel', 'CHANNEL'],
    ['Channel', 'CHANNEL'],
    ['PERSONALITY', 'PERSONALITY'],
    ['personality', 'PERSONALITY'],
    ['Character', 'PERSONALITY'],
    ['character', 'PERSONALITY'],
  ])('resolves %s to %s', (input, expected) => {
    expect(parseScopeInput(input)).toBe(expected);
  });

  it('trims surrounding whitespace', () => {
    expect(parseScopeInput('  Server  ')).toBe('GUILD');
  });

  it('returns null for an invalid input', () => {
    expect(parseScopeInput('nonsense')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseScopeInput('')).toBeNull();
  });
});

describe('formatTypeLabel', () => {
  it('formats USER', () => {
    expect(formatTypeLabel('USER')).toBe('User');
  });

  it('formats GUILD', () => {
    expect(formatTypeLabel('GUILD')).toBe('Server');
  });

  it('is case-insensitive', () => {
    expect(formatTypeLabel('user')).toBe('User');
    expect(formatTypeLabel('guild')).toBe('Server');
  });

  it('returns the input unchanged for an unknown type', () => {
    expect(formatTypeLabel('WEIRD')).toBe('WEIRD');
  });

  it('round-trips an unrecognized key unchanged (map-derived, not literal-matched)', () => {
    expect(formatTypeLabel('CHANNEL')).toBe('CHANNEL');
  });

  it('resolves a key differing only in case through the map', () => {
    expect(formatTypeLabel('gUiLd')).toBe('Server');
  });
});
