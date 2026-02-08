import { describe, it, expect } from 'vitest';
import {
  USER_REFERENCE_PATTERNS,
  RESOLVABLE_PERSONALITY_FIELDS,
  setPersonalityField,
} from './UserReferencePatterns.js';
import type { LoadedPersonality } from '@tzurot/common-types';

describe('UserReferencePatterns', () => {
  describe('USER_REFERENCE_PATTERNS', () => {
    describe('SHAPES_MARKDOWN', () => {
      it('should match @[username](user:uuid) format', () => {
        const text = '@[lbds137](user:98a94b95-cbd0-430b-8be2-602e1c75d8b0)';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.SHAPES_MARKDOWN)];

        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe('lbds137');
        expect(matches[0][2]).toBe('98a94b95-cbd0-430b-8be2-602e1c75d8b0');
      });

      it('should match multiple shapes references', () => {
        const text =
          '@[alice](user:11111111-1111-1111-1111-111111111111) and @[bob](user:22222222-2222-2222-2222-222222222222)';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.SHAPES_MARKDOWN)];

        expect(matches).toHaveLength(2);
      });

      it('should not match invalid UUIDs', () => {
        const text = '@[user](user:not-a-uuid)';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.SHAPES_MARKDOWN)];

        expect(matches).toHaveLength(0);
      });
    });

    describe('DISCORD_MENTION', () => {
      it('should match <@snowflake_id> format', () => {
        const text = '<@278863839632818186>';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.DISCORD_MENTION)];

        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe('278863839632818186');
      });

      it('should match nickname format <@!id>', () => {
        const text = '<@!123456789012345678>';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.DISCORD_MENTION)];

        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe('123456789012345678');
      });

      it('should not match IDs shorter than 17 digits', () => {
        const text = '<@1234567890>';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.DISCORD_MENTION)];

        expect(matches).toHaveLength(0);
      });
    });

    describe('SIMPLE_USERNAME', () => {
      it('should match @username format', () => {
        const text = 'Hello @lbds137, how are you?';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.SIMPLE_USERNAME)];

        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe('lbds137');
      });

      it('should not match shapes format as simple username', () => {
        const text = '@[username](user:12345678-1234-1234-1234-123456789012)';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.SIMPLE_USERNAME)];

        // The @ in shapes format should not be captured as a simple username
        expect(matches).toHaveLength(0);
      });

      it('should not match Discord format as simple username', () => {
        const text = '<@278863839632818186>';
        const matches = [...text.matchAll(USER_REFERENCE_PATTERNS.SIMPLE_USERNAME)];

        expect(matches).toHaveLength(0);
      });
    });
  });

  describe('RESOLVABLE_PERSONALITY_FIELDS', () => {
    it('should include systemPrompt and characterInfo', () => {
      expect(RESOLVABLE_PERSONALITY_FIELDS).toContain('systemPrompt');
      expect(RESOLVABLE_PERSONALITY_FIELDS).toContain('characterInfo');
    });
  });

  describe('setPersonalityField', () => {
    it('should set a field on the personality object', () => {
      const personality = { systemPrompt: 'original' } as LoadedPersonality;
      setPersonalityField(personality, 'systemPrompt', 'updated');

      expect(personality.systemPrompt).toBe('updated');
    });
  });
});
