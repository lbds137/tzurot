/**
 * Tests for Discord constants and validation helpers
 */

import { describe, it, expect } from 'vitest';
import {
  DISCORD_SNOWFLAKE,
  isValidDiscordId,
  filterValidDiscordIds,
  BOT_FOOTER_TEXT,
  BOT_FOOTER_PATTERNS,
  buildModelFooterText,
  DISCORD_PROVIDER_CHOICES,
} from './discord.js';
import { AIProvider } from './ai.js';

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

// DISCORD_ID_PREFIX, buildDiscordPersonaId, and extractDiscordId were deleted.
// The `discord:XXXX` format is now strictly internal
// to bot-client's ExtendedContextPersonaResolver module; the common-types
// exports were never used in production code outside that module and
// lingered as a cross-package API that shouldn't exist. The internal
// equivalent is `INTERNAL_DISCORD_ID_PREFIX` exported from
// `ExtendedContextPersonaResolver` (in bot-client).

describe('Bot Footer Text Constants', () => {
  describe('BOT_FOOTER_TEXT', () => {
    it('should have expected footer text values', () => {
      expect(BOT_FOOTER_TEXT.AUTO_BADGE_COMPACT).toBe(' • 📍 auto');
      expect(BOT_FOOTER_TEXT.AUTO_RESPONSE).toBe('📍 auto-response');
      expect(BOT_FOOTER_TEXT.FRESH_MODE).toBe('🌱 Fresh Mode • Memories not being used');
      expect(BOT_FOOTER_TEXT.INCOGNITO_MODE).toBe('👻 Incognito Mode • Memories not being saved');
    });

    it('should match corresponding BOT_FOOTER_PATTERNS', () => {
      // Verify text constants produce strings that match their patterns
      const autoResponse = `-# ${BOT_FOOTER_TEXT.AUTO_RESPONSE}`;
      expect(BOT_FOOTER_PATTERNS.AUTO_RESPONSE.test(autoResponse)).toBe(true);

      const freshMode = `-# ${BOT_FOOTER_TEXT.FRESH_MODE}`;
      // Reset regex state (global flag)
      BOT_FOOTER_PATTERNS.FRESH_MODE.lastIndex = 0;
      expect(BOT_FOOTER_PATTERNS.FRESH_MODE.test(freshMode)).toBe(true);

      const incognitoMode = `-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`;
      BOT_FOOTER_PATTERNS.INCOGNITO_MODE.lastIndex = 0;
      expect(BOT_FOOTER_PATTERNS.INCOGNITO_MODE.test(incognitoMode)).toBe(true);
    });

    it('legacy focus-mode pattern still strips the pre-rename footer', () => {
      const legacyFooter = '-# 🔒 Focus Mode • LTM retrieval disabled';
      BOT_FOOTER_PATTERNS.LEGACY_FOCUS_MODE.lastIndex = 0;
      expect(BOT_FOOTER_PATTERNS.LEGACY_FOCUS_MODE.test(legacyFooter)).toBe(true);
    });
  });

  describe('buildModelFooterText', () => {
    it('should build basic model footer without auto badge', () => {
      const result = buildModelFooterText('gpt-4', 'https://openrouter.ai/models/gpt-4');
      expect(result).toBe('Model: [gpt-4](<https://openrouter.ai/models/gpt-4>)');
    });

    it('should build model footer with auto badge when requested', () => {
      const result = buildModelFooterText('gpt-4', 'https://openrouter.ai/models/gpt-4', {
        withAutoBadge: true,
      });
      expect(result).toBe('Model: [gpt-4](<https://openrouter.ai/models/gpt-4>) • 📍 auto');
    });

    it('appends explicit provider attribution for a known provider', () => {
      const openRouter = buildModelFooterText('z-ai/glm-5.2', 'https://example.com/m', {
        provider: 'openrouter',
      });
      expect(openRouter).toBe('Model: [z-ai/glm-5.2](<https://example.com/m>) • via OpenRouter');

      const zai = buildModelFooterText('glm-5.2', 'https://example.com/m', {
        provider: 'zai-coding',
      });
      expect(zai).toBe('Model: [glm-5.2](<https://example.com/m>) • via Z.AI Coding Plan');
    });

    it('orders provider attribution before the auto badge', () => {
      const result = buildModelFooterText('glm-5.2', 'https://example.com/m', {
        provider: 'zai-coding',
        withAutoBadge: true,
      });
      expect(result).toBe(
        'Model: [glm-5.2](<https://example.com/m>) • via Z.AI Coding Plan • 📍 auto'
      );
    });

    it('announces a quota fallback as a model swap with the reason', () => {
      const outOfCredit = buildModelFooterText('free-model', 'https://example.com/m', {
        quotaFallback: { fromModel: 'expensive/primary', category: 'credit_exhaustion' },
      });
      expect(outOfCredit).toBe(
        'Model: [free-model](<https://example.com/m>) • expensive/primary → free-model (out of credit)'
      );

      const rateLimited = buildModelFooterText('paid-default', 'https://example.com/m', {
        quotaFallback: { fromModel: 'expensive/primary', category: 'quota_exceeded' },
      });
      expect(rateLimited).toBe(
        'Model: [paid-default](<https://example.com/m>) • expensive/primary → paid-default (rate limited)'
      );

      // A live 429 classifies as rate_limit — renders the same "rate limited" reason.
      const rateLimitCat = buildModelFooterText('free-default', 'https://example.com/m', {
        quotaFallback: { fromModel: 'user/free-default', category: 'rate_limit' },
      });
      expect(rateLimitCat).toBe(
        'Model: [free-default](<https://example.com/m>) • user/free-default → free-default (rate limited)'
      );
    });

    it('renders per-category wording for the D12 descent categories (map completeness)', () => {
      const cases: Array<[string, string]> = [
        ['model_not_found', 'model unavailable'],
        ['server_error', 'provider error'],
        ['timeout', 'timed out'],
        ['network', 'network error'],
        ['empty_response', 'empty response'],
        ['censored', 'model refused'],
        ['content_policy', 'model refused'],
      ];
      for (const [category, wording] of cases) {
        const result = buildModelFooterText('floor-model', 'https://example.com/m', {
          quotaFallback: { fromModel: 'expensive/primary', category: category as never },
        });
        expect(result, category).toContain(`(${wording})`);
      }
    });

    it('sanitizes markdown-hostile characters in the quota-fallback source model', () => {
      const result = buildModelFooterText('free-model', 'https://example.com/m', {
        quotaFallback: { fromModel: 'bad[model](x)', category: 'quota_exceeded' },
      });
      expect(result).toContain('badmodelx → free-model');
    });

    it('renders the full route chain when a fallback attempt also failed', () => {
      // Both-routes-failed error: the footer names every route that was tried,
      // primary first, so neither attempt is mis-attributed as the only one.
      const result = buildModelFooterText('glm-4.7', 'https://example.com/m', {
        provider: 'zai-coding',
        fallbackProviderAttempted: 'openrouter',
      });
      expect(result).toBe(
        'Model: [glm-4.7](<https://example.com/m>) • via Z.AI Coding Plan → OpenRouter (both routes failed)'
      );
    });

    it('orders the route chain before the auto badge', () => {
      const result = buildModelFooterText('glm-4.7', 'https://example.com/m', {
        provider: 'zai-coding',
        fallbackProviderAttempted: 'openrouter',
        withAutoBadge: true,
      });
      expect(result).toBe(
        'Model: [glm-4.7](<https://example.com/m>) • via Z.AI Coding Plan → OpenRouter (both routes failed) • 📍 auto'
      );
    });

    it('falls back to single-provider attribution when the fallback label is unknown', () => {
      // Unknown fallback provider → no chain; the known primary still renders.
      expect(
        buildModelFooterText('glm-4.7', 'https://example.com/m', {
          provider: 'zai-coding',
          fallbackProviderAttempted: 'not-a-provider',
        })
      ).toBe('Model: [glm-4.7](<https://example.com/m>) • via Z.AI Coding Plan');
      // Unknown PRIMARY suppresses attribution entirely — a chain with an
      // unattributable first hop would be more confusing than nothing.
      expect(
        buildModelFooterText('glm-4.7', 'https://example.com/m', {
          provider: 'not-a-provider',
          fallbackProviderAttempted: 'openrouter',
        })
      ).toBe('Model: [glm-4.7](<https://example.com/m>)');
    });

    it('omits provider attribution for an unknown or absent provider', () => {
      expect(buildModelFooterText('gpt-4', 'https://example.com/m')).toBe(
        'Model: [gpt-4](<https://example.com/m>)'
      );
      expect(
        buildModelFooterText('gpt-4', 'https://example.com/m', { provider: 'not-a-provider' })
      ).toBe('Model: [gpt-4](<https://example.com/m>)');
    });

    it('never surfaces a VOICE provider as an LLM footer label (structural guard)', () => {
      // elevenlabs / mistral are in DISCORD_PROVIDER_CHOICES but are voice providers; the
      // LLM_FOOTER_PROVIDERS allowlist keeps them out of the model footer even if a future
      // change wired one into the LLM `providerUsed` path.
      for (const voiceProvider of ['elevenlabs', 'mistral']) {
        expect(
          buildModelFooterText('gpt-4', 'https://example.com/m', { provider: voiceProvider })
        ).toBe('Model: [gpt-4](<https://example.com/m>)');
      }
    });

    it('should produce output that matches BOT_FOOTER_PATTERNS.MODEL', () => {
      // Every shape the builder can emit must be strippable by the footer regex,
      // or footers leak into stored history / duplicate-detection comparisons.
      const cases = [
        buildModelFooterText('test/model', 'https://example.com/model'),
        buildModelFooterText('test/model', 'https://example.com/model', { withAutoBadge: true }),
        buildModelFooterText('test/model', 'https://example.com/model', { provider: 'openrouter' }),
        buildModelFooterText('test/model', 'https://example.com/model', {
          provider: 'zai-coding',
          withAutoBadge: true,
        }),
        buildModelFooterText('test/model', 'https://example.com/model', {
          provider: 'zai-coding',
          fallbackProviderAttempted: 'openrouter',
          withAutoBadge: true,
        }),
      ];
      for (const built of cases) {
        const line = `-# ${built}`;
        BOT_FOOTER_PATTERNS.MODEL.lastIndex = 0;
        expect(BOT_FOOTER_PATTERNS.MODEL.test(line)).toBe(true);
        // And the strip removes the entire footer line, leaving nothing behind.
        expect(line.replace(BOT_FOOTER_PATTERNS.MODEL, '')).toBe('');
      }
    });

    it('should sanitize model name to prevent markdown injection', () => {
      // Brackets and angle brackets could break markdown link syntax
      const malicious = 'model[with]<brackets>(and)parens';
      const result = buildModelFooterText(malicious, 'https://example.com/model');
      // Should strip all brackets/parens from model name
      expect(result).toBe('Model: [modelwithbracketsandparens](<https://example.com/model>)');
      expect(result).not.toContain('[with]');
      expect(result).not.toContain('<brackets>');
    });
  });
});

describe('DISCORD_PROVIDER_CHOICES', () => {
  it('should have an entry for every AIProvider enum value', () => {
    // Guard test: catches the failure mode where a new AIProvider is added to
    // the enum (and the runtime path is wired up — validators, ModelFactory
    // branch, etc.) but the slash-command argument-choices list is missed.
    // Without this assertion, /settings apikey set <provider> silently omits
    // the new provider and users can't add their key — which is exactly what
    // happened with zai-coding.
    const enumValues = Object.values(AIProvider) as string[];
    const choiceValues = DISCORD_PROVIDER_CHOICES.map(c => c.value);

    for (const enumValue of enumValues) {
      expect(choiceValues).toContain(enumValue);
    }
  });

  it('should not have orphan choices that point to non-existent enum values', () => {
    // Inverse guard: catches the opposite failure where a choice references
    // a string value that doesn't match any current enum member (e.g., after
    // an enum rename without updating the choices).
    const enumValues = Object.values(AIProvider) as string[];
    for (const choice of DISCORD_PROVIDER_CHOICES) {
      expect(enumValues).toContain(choice.value);
    }
  });
});
