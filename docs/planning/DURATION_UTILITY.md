# Duration Configuration Utility

> **Status**: Planning
> **Created**: 2026-01-01
> **Purpose**: Reusable time duration parsing, validation, and display for Discord commands

## Overview

A type-safe utility for handling user-configurable time durations across the codebase. Supports disabled state, human-readable input/output, and database storage.

## Null Semantics Clarification

**Important**: In the tiered settings hierarchy, `null` has different meanings at different levels:

| Level | `null` Means | Example |
|-------|--------------|---------|
| **Channel/Personality** | "Inherit from parent" (auto) | `maxAge: null` → follow global default |
| **Global (AdminSettings)** | "Feature disabled" | `extendedContextMaxAge: null` → no age filtering |

**The Duration class handles this by**:
- `Duration.parse(null)` → returns a disabled Duration
- `Duration.fromDb(null)` → returns a disabled Duration
- When resolving tiered settings, the resolver service handles the inheritance chain

**Resolution Example**:
```typescript
// Personality maxAge = null (auto), Channel maxAge = null (auto), Global maxAge = 3600
// Resolved: 3600 seconds (1 hour)

// Personality maxAge = null (auto), Channel maxAge = null (auto), Global maxAge = null
// Resolved: null (disabled - no age filtering)
```

## Use Cases

| Feature | Example Setting | Notes |
|---------|-----------------|-------|
| Extended context staleness | `24h`, `off` | Ignore messages older than X |
| Usage stats lookback | `7d`, `30d` | Time window for statistics |
| Memory search window | `1w`, `30d` | LTM query time bounds |
| Rate limit windows | `1h`, `15m` | Cooldown periods |

## Design

### Storage: Seconds as Nullable Integer

```prisma
model AdminSettings {
  extendedContextMaxAge  Int?  // Seconds. null = disabled (no age limit)
}
```

**Why seconds?**
- Granular enough for any Discord use case
- Simple SQL queries: `WHERE created_at > NOW() - interval '${seconds} seconds'`
- `null` naturally represents "disabled"
- PostgreSQL `Int` supports up to ~68 years

### Input Parsing

Accept human-readable strings:

| Input | Meaning |
|-------|---------|
| `off`, `disable`, `none`, `0` | Disabled |
| `30m`, `30min`, `30 minutes` | 30 minutes |
| `2h`, `2hr`, `2 hours` | 2 hours |
| `1d`, `1 day` | 1 day |
| `1w`, `1 week` | 1 week |

### The Duration Class

```typescript
// packages/common-types/src/utils/Duration.ts

import parseDuration from 'parse-duration';

export interface DurationBounds {
  min?: number;  // Minimum seconds (when enabled)
  max?: number;  // Maximum seconds
}

export interface DurationValidation {
  valid: boolean;
  error?: string;
}

/**
 * Represents a configurable time duration that can be disabled.
 *
 * @example
 * const d = Duration.parse('2h');
 * d.toSeconds();     // 7200
 * d.toHuman();       // "2 hours"
 * d.isEnabled;       // true
 * d.getCutoffDate(); // Date object 2 hours ago
 *
 * @example
 * const disabled = Duration.parse('off');
 * disabled.isEnabled;  // false
 * disabled.toSeconds(); // null
 * disabled.toHuman();   // "Disabled"
 */
export class Duration {
  private constructor(private readonly seconds: number | null) {}

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Parse a human-readable duration string
   * @param input - Duration string like "2h", "30m", "off"
   */
  static parse(input: string | null | undefined): Duration {
    if (input === null || input === undefined) {
      return new Duration(null);
    }

    const normalized = input.trim().toLowerCase();

    // Check for disabled state
    if (['off', 'disable', 'disabled', 'none', 'null', '0'].includes(normalized)) {
      return new Duration(null);
    }

    // Use parse-duration library for flexible parsing
    const ms = parseDuration(normalized);
    if (ms === null || ms === undefined || ms <= 0) {
      throw new DurationParseError(`Invalid duration: "${input}"`);
    }

    return new Duration(Math.floor(ms / 1000));
  }

  /**
   * Create from database value (seconds)
   */
  static fromDb(seconds: number | null): Duration {
    return new Duration(seconds);
  }

  /**
   * Create a disabled duration
   */
  static disabled(): Duration {
    return new Duration(null);
  }

  // ============================================================================
  // Output Methods
  // ============================================================================

  /**
   * Get value for database storage
   */
  toDb(): number | null {
    return this.seconds;
  }

  /**
   * Get raw seconds (null if disabled)
   */
  toSeconds(): number | null {
    return this.seconds;
  }

  /**
   * Get milliseconds (null if disabled)
   */
  toMs(): number | null {
    return this.seconds !== null ? this.seconds * 1000 : null;
  }

  /**
   * Format for human display
   * @example "2 hours", "30 minutes", "1 week", "Disabled"
   */
  toHuman(): string {
    if (this.seconds === null) {
      return 'Disabled';
    }

    const units: [number, string, string][] = [
      [7 * 24 * 60 * 60, 'week', 'weeks'],
      [24 * 60 * 60, 'day', 'days'],
      [60 * 60, 'hour', 'hours'],
      [60, 'minute', 'minutes'],
      [1, 'second', 'seconds'],
    ];

    for (const [divisor, singular, plural] of units) {
      if (this.seconds >= divisor) {
        const value = Math.floor(this.seconds / divisor);
        const remainder = this.seconds % divisor;

        // If it divides evenly, use clean format
        if (remainder === 0) {
          return `${value} ${value === 1 ? singular : plural}`;
        }
      }
    }

    return `${this.seconds} seconds`;
  }

  /**
   * Format as compact string (for command options)
   * @example "2h", "30m", "1w", "off"
   */
  toCompact(): string {
    if (this.seconds === null) {
      return 'off';
    }

    const weeks = Math.floor(this.seconds / (7 * 24 * 60 * 60));
    if (weeks > 0 && this.seconds % (7 * 24 * 60 * 60) === 0) {
      return `${weeks}w`;
    }

    const days = Math.floor(this.seconds / (24 * 60 * 60));
    if (days > 0 && this.seconds % (24 * 60 * 60) === 0) {
      return `${days}d`;
    }

    const hours = Math.floor(this.seconds / (60 * 60));
    if (hours > 0 && this.seconds % (60 * 60) === 0) {
      return `${hours}h`;
    }

    const minutes = Math.floor(this.seconds / 60);
    if (minutes > 0 && this.seconds % 60 === 0) {
      return `${minutes}m`;
    }

    return `${this.seconds}s`;
  }

  // ============================================================================
  // Query Helpers
  // ============================================================================

  /**
   * Whether the duration is enabled (not null/disabled)
   */
  get isEnabled(): boolean {
    return this.seconds !== null;
  }

  /**
   * Get the cutoff date (now - duration)
   * Returns null if disabled
   */
  getCutoffDate(): Date | null {
    if (this.seconds === null) {
      return null;
    }
    return new Date(Date.now() - this.seconds * 1000);
  }

  /**
   * Check if a date is within the duration window
   * Returns true if disabled (no cutoff = everything is valid)
   */
  isWithinWindow(date: Date): boolean {
    if (this.seconds === null) {
      return true; // Disabled = no filtering
    }
    return date.getTime() >= Date.now() - this.seconds * 1000;
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validate against bounds
   * Disabled state is always valid (unless bounds.requireEnabled)
   */
  validate(bounds: DurationBounds): DurationValidation {
    if (this.seconds === null) {
      return { valid: true }; // Disabled is valid
    }

    if (bounds.min !== undefined && this.seconds < bounds.min) {
      const minDuration = Duration.fromDb(bounds.min);
      return {
        valid: false,
        error: `Duration must be at least ${minDuration.toHuman()}`,
      };
    }

    if (bounds.max !== undefined && this.seconds > bounds.max) {
      const maxDuration = Duration.fromDb(bounds.max);
      return {
        valid: false,
        error: `Duration cannot exceed ${maxDuration.toHuman()}`,
      };
    }

    return { valid: true };
  }
}

/**
 * Error thrown when duration parsing fails
 */
export class DurationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DurationParseError';
  }
}
```

### Discord Autocomplete Handler

```typescript
// services/bot-client/src/utils/durationAutocomplete.ts

import type { AutocompleteInteraction } from 'discord.js';

/**
 * Common duration presets for autocomplete
 */
const DURATION_PRESETS = [
  { name: 'Disabled (no limit)', value: 'off' },
  { name: '15 minutes', value: '15m' },
  { name: '1 hour', value: '1h' },
  { name: '6 hours', value: '6h' },
  { name: '24 hours (1 day)', value: '24h' },
  { name: '3 days', value: '3d' },
  { name: '7 days (1 week)', value: '7d' },
  { name: '14 days (2 weeks)', value: '14d' },
  { name: '30 days', value: '30d' },
];

/**
 * Handle duration autocomplete for Discord commands
 */
export async function handleDurationAutocomplete(
  interaction: AutocompleteInteraction,
  presets: typeof DURATION_PRESETS = DURATION_PRESETS
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase().trim();

  let choices: { name: string; value: string }[];

  if (!focused) {
    // Show default presets
    choices = presets;
  } else if (focused === 'off' || focused.startsWith('dis') || focused.startsWith('no')) {
    // User typing "off", "disable", "none"
    choices = [{ name: 'Disabled (no limit)', value: 'off' }];
  } else {
    // Try to parse as number + suggest units
    const num = parseInt(focused.replace(/[^0-9]/g, ''));

    if (!isNaN(num) && num > 0) {
      choices = [
        { name: `${num} minutes`, value: `${num}m` },
        { name: `${num} hours`, value: `${num}h` },
        { name: `${num} days`, value: `${num}d` },
        { name: `${num} weeks`, value: `${num}w` },
      ];
    } else {
      // Filter presets by search
      choices = presets.filter(
        p => p.name.toLowerCase().includes(focused) || p.value.includes(focused)
      );
    }
  }

  await interaction.respond(choices.slice(0, 25));
}
```

### Usage Example

```typescript
// In a command handler
import { Duration, DurationParseError } from '@tzurot/common-types';

async function handleSetStaleness(interaction: ChatInputCommandInteraction) {
  const input = interaction.options.getString('duration', true);

  try {
    const duration = Duration.parse(input);

    // Validate bounds (min 5 minutes, max 30 days)
    const validation = duration.validate({
      min: 5 * 60,        // 5 minutes
      max: 30 * 24 * 60 * 60,  // 30 days
    });

    if (!validation.valid) {
      await interaction.editReply(`❌ ${validation.error}`);
      return;
    }

    // Save to database
    await prisma.adminSettings.update({
      where: { id: 1 },
      data: { extendedContextMaxAge: duration.toDb() },
    });

    // User feedback
    if (duration.isEnabled) {
      const cutoff = duration.getCutoffDate()!;
      await interaction.editReply(
        `✅ Extended context staleness set to **${duration.toHuman()}**.\n` +
        `Messages before <t:${Math.floor(cutoff.getTime() / 1000)}:R> will be ignored.`
      );
    } else {
      await interaction.editReply(
        `✅ Extended context staleness **disabled**. No age limit on messages.`
      );
    }
  } catch (error) {
    if (error instanceof DurationParseError) {
      await interaction.editReply(
        `❌ Invalid duration format. Try "2h", "30m", "1d", or "off".`
      );
    } else {
      throw error;
    }
  }
}
```

### In Extended Context Fetcher

```typescript
// Using the duration for filtering
const maxAge = Duration.fromDb(settings.extendedContextMaxAge);

const messages = fetchedMessages.filter(msg => {
  // If maxAge is disabled, include all messages
  // If enabled, filter out messages older than cutoff
  return maxAge.isWithinWindow(msg.createdAt);
});
```

## Migration

### Update Admin Usage Command

Replace hardcoded choices with autocomplete:

```typescript
// Before
.addChoices(
  { name: 'Last 24 hours', value: '24h' },
  { name: 'Last 7 days', value: '7d' },
  { name: 'Last 30 days', value: '30d' }
)

// After
.setAutocomplete(true)
```

Add autocomplete handler and parse with `Duration.parse()`.

## Dependencies

- `parse-duration` - Flexible duration string parsing
  - Lightweight, well-maintained
  - Handles edge cases we don't want to write ourselves

```bash
pnpm add parse-duration
pnpm add -D @types/parse-duration
```

## Testing

```typescript
describe('Duration', () => {
  describe('parse', () => {
    it('parses minutes', () => {
      expect(Duration.parse('30m').toSeconds()).toBe(30 * 60);
      expect(Duration.parse('30min').toSeconds()).toBe(30 * 60);
      expect(Duration.parse('30 minutes').toSeconds()).toBe(30 * 60);
    });

    it('parses hours', () => {
      expect(Duration.parse('2h').toSeconds()).toBe(2 * 60 * 60);
    });

    it('parses days', () => {
      expect(Duration.parse('1d').toSeconds()).toBe(24 * 60 * 60);
    });

    it('parses disabled state', () => {
      expect(Duration.parse('off').isEnabled).toBe(false);
      expect(Duration.parse('disable').isEnabled).toBe(false);
      expect(Duration.parse('none').isEnabled).toBe(false);
      expect(Duration.parse('0').isEnabled).toBe(false);
    });

    it('throws on invalid input', () => {
      expect(() => Duration.parse('invalid')).toThrow(DurationParseError);
      expect(() => Duration.parse('-5m')).toThrow(DurationParseError);
    });
  });

  describe('toHuman', () => {
    it('formats nicely', () => {
      expect(Duration.parse('2h').toHuman()).toBe('2 hours');
      expect(Duration.parse('1d').toHuman()).toBe('1 day');
      expect(Duration.parse('off').toHuman()).toBe('Disabled');
    });
  });

  describe('validation', () => {
    it('enforces minimum', () => {
      const result = Duration.parse('1m').validate({ min: 5 * 60 });
      expect(result.valid).toBe(false);
    });

    it('allows disabled regardless of bounds', () => {
      const result = Duration.parse('off').validate({ min: 5 * 60 });
      expect(result.valid).toBe(true);
    });
  });
});
```
