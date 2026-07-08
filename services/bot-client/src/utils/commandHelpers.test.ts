/**
 * Tests for commandHelpers utilities (the shared embed factories — the
 * error-reply helpers formerly here were dead code and are gone; error
 * messaging flows through ux/catalog + replySpec).
 */

import { describe, it, expect, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: {
      SUCCESS: 0x57f287,
      ERROR: 0xed4245,
      WARNING: 0xfee75c,
      BLURPLE: 0x5865f2,
    },
  };
});

import {
  createSuccessEmbed,
  createInfoEmbed,
  createErrorEmbed,
  createWarningEmbed,
  createDangerEmbed,
} from './commandHelpers.js';

describe('commandHelpers', () => {
  describe('embed creators', () => {
    it('createSuccessEmbed should create success colored embed', () => {
      const embed = createSuccessEmbed('Test Title', 'Test Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.title).toBe('Test Title');
      expect(embed.data.description).toBe('Test Description');
      expect(embed.data.color).toBe(0x57f287); // SUCCESS color
    });

    it('createInfoEmbed should create blurple colored embed', () => {
      const embed = createInfoEmbed('Test Title', 'Test Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.title).toBe('Test Title');
      expect(embed.data.color).toBe(0x5865f2); // BLURPLE color
    });

    it('createInfoEmbed should work without description', () => {
      const embed = createInfoEmbed('Test Title');

      expect(embed.data.description).toBeUndefined();
    });

    it('createErrorEmbed should create error colored embed', () => {
      const embed = createErrorEmbed('Error Title', 'Error Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBe(0xed4245); // ERROR color
    });

    it('createWarningEmbed should create warning colored embed', () => {
      const embed = createWarningEmbed('Warning Title', 'Warning Description');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBe(0xfee75c); // WARNING color
    });

    it('createDangerEmbed should use the ERROR color (destructive intent)', () => {
      const embed = createDangerEmbed('Delete Everything?', 'This cannot be undone.');

      expect(embed).toBeInstanceOf(EmbedBuilder);
      expect(embed.data.color).toBe(0xed4245); // ERROR color, semantically danger
    });
  });
});
