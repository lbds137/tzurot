/**
 * Timezone constant tests
 *
 * The offset labels are derived at render time, so every fixture pins an
 * explicit instant well inside a DST regime rather than near a transition.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  TIMEZONE_OPTIONS,
  getTimezoneInfo,
  isValidTimezone,
  timezoneDisplayName,
  timezoneOffsetLabel,
} from './timezone.js';

// Mid-July and mid-January: months away from any transition in the zones used
// below, so neither fixture straddles a boundary.
const SUMMER = new Date('2026-07-15T12:00:00Z');
const WINTER = new Date('2026-01-15T12:00:00Z');

describe('timezoneOffsetLabel', () => {
  it('renders London as UTC+1 during British Summer Time', () => {
    expect(timezoneOffsetLabel('Europe/London', SUMMER)).toBe('UTC+1');
  });

  it('renders London as UTC+0 outside British Summer Time', () => {
    expect(timezoneOffsetLabel('Europe/London', WINTER)).toBe('UTC+0');
  });

  it('renders New York as UTC-4 in summer and UTC-5 in winter', () => {
    expect(timezoneOffsetLabel('America/New_York', SUMMER)).toBe('UTC-4');
    expect(timezoneOffsetLabel('America/New_York', WINTER)).toBe('UTC-5');
  });

  it('renders a zero offset as UTC+0 rather than a bare UTC', () => {
    expect(timezoneOffsetLabel('UTC', SUMMER)).toBe('UTC+0');
    expect(timezoneOffsetLabel('UTC', WINTER)).toBe('UTC+0');
  });

  it('keeps a half-hour offset intact', () => {
    expect(timezoneOffsetLabel('Asia/Kolkata', SUMMER)).toBe('UTC+5:30');
  });

  it('follows a southern-hemisphere zone on its own DST schedule', () => {
    expect(timezoneOffsetLabel('Pacific/Auckland', SUMMER)).toBe('UTC+12');
    expect(timezoneOffsetLabel('Pacific/Auckland', WINTER)).toBe('UTC+13');
  });

  it('returns Unknown for a string Intl cannot format as a zone', () => {
    expect(timezoneOffsetLabel('Not/AZone', SUMMER)).toBe('Unknown');
  });

  it('returns Unknown when Intl yields no time-zone-name part', () => {
    // A valid zone, so the catch arm cannot be what produces 'Unknown'.
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockReturnValue([{ type: 'literal', value: '7/15/2026' }]);

    try {
      expect(timezoneOffsetLabel('UTC', SUMMER)).toBe('Unknown');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults to the current instant when no date is given', () => {
    expect(timezoneOffsetLabel('UTC')).toBe('UTC+0');
  });
});

describe('timezoneDisplayName', () => {
  it('pairs the label with the offset derived at that instant', () => {
    expect(timezoneDisplayName('Europe/London', SUMMER)).toBe('London (GMT/BST) - UTC+1');
    expect(timezoneDisplayName('Europe/London', WINTER)).toBe('London (GMT/BST) - UTC+0');
  });

  it('falls back to the bare IANA value for a zone outside the list', () => {
    expect(timezoneDisplayName('Antarctica/Troll', SUMMER)).toBe('Antarctica/Troll');
  });
});

describe('TIMEZONE_OPTIONS', () => {
  it('stores no offset on any entry', () => {
    for (const tz of TIMEZONE_OPTIONS) {
      expect(tz).not.toHaveProperty('offset');
    }
  });

  it('lists only zones Intl can format', () => {
    for (const tz of TIMEZONE_OPTIONS) {
      expect(timezoneOffsetLabel(tz.value, SUMMER)).not.toBe('Unknown');
    }
  });
});

describe('getTimezoneInfo and isValidTimezone', () => {
  it('finds a listed zone and misses an unlisted one', () => {
    expect(getTimezoneInfo('Asia/Tokyo')?.label).toBe('Japan Standard');
    expect(getTimezoneInfo('Antarctica/Troll')).toBeUndefined();
  });

  it('accepts any valid IANA zone and rejects a nonsense string', () => {
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidTimezone('Antarctica/Troll')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });
});
