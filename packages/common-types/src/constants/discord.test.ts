/**
 * Tests for Discord constants and validation helpers
 */

import { describe, it, expect } from 'vitest';
import { DISCORD_SNOWFLAKE, isValidDiscordId, filterValidDiscordIds } from './discord.js';

describe('Discord ID Validation', () => {
  describe('DISCORD_SNOWFLAKE constants', () => {
    it('should have correct length bounds', () => {
      expect(DISCORD_SNOWFLAKE.MIN_LENGTH).toBe(17);
      expect(DISCORD_SNOWFLAKE.MAX_LENGTH).toBe(19);
    });

    it('should have a regex pattern that matches 17-19 digit strings', () => {
      expect(DISCORD_SNOWFLAKE.PATTERN.test('12345678901234567')).toBe(true); // 17 digits
      expect(DISCORD_SNOWFLAKE.PATTERN.test('123456789012345678')).toBe(true); // 18 digits
      expect(DISCORD_SNOWFLAKE.PATTERN.test('1234567890123456789')).toBe(true); // 19 digits
    });
  });

  describe('isValidDiscordId', () => {
    it('should return true for valid 17-digit snowflake IDs', () => {
      expect(isValidDiscordId('12345678901234567')).toBe(true);
    });

    it('should return true for valid 18-digit snowflake IDs', () => {
      expect(isValidDiscordId('123456789012345678')).toBe(true);
    });

    it('should return true for valid 19-digit snowflake IDs', () => {
      expect(isValidDiscordId('1234567890123456789')).toBe(true);
    });

    it('should return false for too short IDs (16 digits)', () => {
      expect(isValidDiscordId('1234567890123456')).toBe(false);
    });

    it('should return false for too long IDs (20 digits)', () => {
      expect(isValidDiscordId('12345678901234567890')).toBe(false);
    });

    it('should return false for non-numeric strings', () => {
      expect(isValidDiscordId('channel-abc')).toBe(false);
      expect(isValidDiscordId('abc12345678901234567')).toBe(false);
      expect(isValidDiscordId('12345678901234567abc')).toBe(false);
    });

    it('should return false for empty strings', () => {
      expect(isValidDiscordId('')).toBe(false);
    });

    it('should return false for strings with spaces', () => {
      expect(isValidDiscordId('123456789 012345678')).toBe(false);
    });

    it('should return false for strings with special characters', () => {
      expect(isValidDiscordId('123456789-012345678')).toBe(false);
      expect(isValidDiscordId('123456789_012345678')).toBe(false);
    });
  });

  describe('filterValidDiscordIds', () => {
    it('should filter out invalid IDs and keep valid ones', () => {
      const input = [
        '123456789012345678', // valid
        'channel-abc', // invalid
        '234567890123456789', // valid
        '123', // too short
        '12345678901234567890', // too long
      ];
      const result = filterValidDiscordIds(input);
      expect(result).toEqual(['123456789012345678', '234567890123456789']);
    });

    it('should return empty array when all IDs are invalid', () => {
      const input = ['abc', 'def', '123'];
      const result = filterValidDiscordIds(input);
      expect(result).toEqual([]);
    });

    it('should return all IDs when all are valid', () => {
      const input = ['123456789012345678', '234567890123456789', '345678901234567890'];
      const result = filterValidDiscordIds(input);
      expect(result).toEqual(input);
    });

    it('should handle empty array', () => {
      const result = filterValidDiscordIds([]);
      expect(result).toEqual([]);
    });
  });
});
