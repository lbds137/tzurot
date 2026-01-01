/**
 * Duration Configuration Utility
 *
 * A type-safe utility for handling user-configurable time durations.
 * Supports disabled state, human-readable input/output, and database storage.
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
 *
 * @see docs/planning/DURATION_UTILITY.md
 */

import parseDuration from 'parse-duration';

export interface DurationBounds {
  /** Minimum seconds (when enabled) */
  min?: number;
  /** Maximum seconds */
  max?: number;
}

export interface DurationValidation {
  valid: boolean;
  error?: string;
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

/** Strings that represent a disabled/off duration */
const DISABLED_STRINGS = ['off', 'disable', 'disabled', 'none', 'null', '0'];

/** Time unit definitions for formatting */
const TIME_UNITS: [number, string, string][] = [
  [7 * 24 * 60 * 60, 'week', 'weeks'],
  [24 * 60 * 60, 'day', 'days'],
  [60 * 60, 'hour', 'hours'],
  [60, 'minute', 'minutes'],
  [1, 'second', 'seconds'],
];

/**
 * Represents a configurable time duration that can be disabled.
 *
 * In the tiered settings hierarchy:
 * - At channel/personality level: null means "inherit from parent" (auto)
 * - At global level: null means "feature disabled"
 *
 * The Duration class treats null as disabled. The resolution service
 * handles the inheritance chain.
 */
export class Duration {
  private constructor(private readonly seconds: number | null) {}

  // ============================================================================
  // Factory Methods
  // ============================================================================

  /**
   * Parse a human-readable duration string
   * @param input - Duration string like "2h", "30m", "off", or null/undefined
   * @returns Duration instance
   * @throws DurationParseError if input is invalid
   */
  static parse(input: string | null | undefined): Duration {
    if (input === null || input === undefined) {
      return new Duration(null);
    }

    const normalized = input.trim().toLowerCase();

    // Check for disabled state
    if (DISABLED_STRINGS.includes(normalized)) {
      return new Duration(null);
    }

    // Use parse-duration library for flexible parsing
    const ms = parseDuration(normalized);
    if (ms === null || ms === undefined || ms <= 0) {
      throw new DurationParseError(`Invalid duration: "${input}"`);
    }

    // Convert to seconds - must be at least 1 second
    const seconds = Math.floor(ms / 1000);
    if (seconds <= 0) {
      throw new DurationParseError(`Duration too short (minimum 1 second): "${input}"`);
    }

    return new Duration(seconds);
  }

  /**
   * Create from database value (seconds)
   * @param seconds - Duration in seconds, or null for disabled
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

  /**
   * Create from seconds value
   * @param seconds - Duration in seconds
   */
  static fromSeconds(seconds: number): Duration {
    if (seconds <= 0) {
      throw new DurationParseError('Duration must be positive');
    }
    return new Duration(seconds);
  }

  // ============================================================================
  // Output Methods
  // ============================================================================

  /**
   * Get value for database storage
   * @returns Seconds as number, or null if disabled
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
   * @returns Human-readable string like "2 hours", "30 minutes", "Disabled"
   */
  toHuman(): string {
    if (this.seconds === null) {
      return 'Disabled';
    }

    for (const [divisor, singular, plural] of TIME_UNITS) {
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
   * @returns Compact string like "2h", "30m", "1w", "off"
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
   * @returns Date object representing the cutoff, or null if disabled
   */
  getCutoffDate(): Date | null {
    if (this.seconds === null) {
      return null;
    }
    return new Date(Date.now() - this.seconds * 1000);
  }

  /**
   * Check if a date is within the duration window
   * @param date - Date to check
   * @returns true if disabled (no cutoff = everything is valid), or if date is within window
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
