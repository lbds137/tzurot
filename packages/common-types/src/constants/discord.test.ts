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
  stripMarkdownDelimiters,
  DISCORD_PROVIDER_CHOICES,
} from './discord.js';
import { AIProvider } from './ai.js';
import { GUEST_MODE_CATEGORY } from './error.js';

describe('Discord ID Validation', () => {
  describe('DISCORD_SNOWFLAKE constants', () => {
    it('should have correct length bounds', () => {
      expect(DISCORD_SNOWFLAKE.MIN_LENGTH).toBe(17);
      expect(DISCORD_SNOWFLAKE.MAX_LENGTH).toBe(20);
    });

    it('should have a regex pattern that matches 17-20 digit strings', () => {
      expect(DISCORD_SNOWFLAKE.PATTERN.test('12345678901234567')).toBe(true); // 17 digits
      expect(DISCORD_SNOWFLAKE.PATTERN.test('123456789012345678')).toBe(true); // 18 digits
      expect(DISCORD_SNOWFLAKE.PATTERN.test('1234567890123456789')).toBe(true); // 19 digits
      expect(DISCORD_SNOWFLAKE.PATTERN.test('12345678901234567890')).toBe(true); // 20 (u64 ceiling)
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

    it('should return true for 20-digit IDs (the u64 ceiling)', () => {
      expect(isValidDiscordId('12345678901234567890')).toBe(true);
    });

    it('should return false for too long IDs (21 digits)', () => {
      expect(isValidDiscordId('123456789012345678901')).toBe(false);
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
        '123456789012345678901', // too long (21 — past the u64 ceiling)
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

  describe('stripMarkdownDelimiters', () => {
    it('removes the characters that build a masked link or an angle-bracket URL', () => {
      expect(stripMarkdownDelimiters('[Free Nitro](http://evil.example)')).toBe(
        'Free Nitrohttp://evil.example'
      );
      expect(stripMarkdownDelimiters('<@everyone>')).toBe('@everyone');
    });

    it('leaves an ordinary model id untouched', () => {
      expect(stripMarkdownDelimiters('anthropic/claude-sonnet-4')).toBe(
        'anthropic/claude-sonnet-4'
      );
      expect(stripMarkdownDelimiters('z-ai/glm-5.3-flash:free')).toBe('z-ai/glm-5.3-flash:free');
    });

    it('CAN return an empty string from a non-empty input — callers must handle it', () => {
      // The schema behind these values (LlmConfigCreateSchema.model) is
      // `.min(1).max(200)` with no character restriction, so an all-delimiter
      // id passes validation and strips away to nothing. Any caller rendering
      // the result into a Discord embed field must skip the field rather than
      // emit an empty value, which throws at build time and takes the whole
      // embed with it.
      expect(stripMarkdownDelimiters('()')).toBe('');
      expect(stripMarkdownDelimiters('[]')).toBe('');
      expect(stripMarkdownDelimiters('<>')).toBe('');
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
      // The resolved model is named ONCE, as the arrow's target, and that is
      // where the link lives — no leading duplicate mention.
      expect(outOfCredit).toBe(
        'Model: expensive/primary → [free-model](<https://example.com/m>) (out of credit)'
      );

      const rateLimited = buildModelFooterText('paid-default', 'https://example.com/m', {
        quotaFallback: { fromModel: 'expensive/primary', category: 'quota_exceeded' },
      });
      expect(rateLimited).toBe(
        'Model: expensive/primary → [paid-default](<https://example.com/m>) (rate limited)'
      );

      // A live 429 classifies as rate_limit — renders the same "rate limited" reason.
      const rateLimitCat = buildModelFooterText('free-default', 'https://example.com/m', {
        quotaFallback: { fromModel: 'user/free-default', category: 'rate_limit' },
      });
      expect(rateLimitCat).toBe(
        'Model: user/free-default → [free-default](<https://example.com/m>) (rate limited)'
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

    it('renders the guest-mode substitution bare — no arrow, no parenthetical', () => {
      // The guest ladder swap is structural, not news: it happens every turn
      // for a free user, so it must render exactly as if quotaFallback were
      // absent — no arrow, no "(guest mode)" reason.
      const result = buildModelFooterText('glm-5.3-flash', 'https://example.com/m', {
        quotaFallback: { fromModel: 'expensive/paid-model', category: GUEST_MODE_CATEGORY },
      });
      expect(result).toBe('Model: [glm-5.3-flash](<https://example.com/m>)');
      expect(result).not.toContain('→');
      expect(result).not.toContain('guest mode');
    });

    it('renders bare for guest-mode even when from/to name the same model', () => {
      // The same-name collapse path and the guest-mode carve-out must not
      // interact badly — both land on the same bare output.
      const result = buildModelFooterText('glm-5.3-flash', 'https://example.com/m', {
        quotaFallback: { fromModel: 'z-ai/glm-5.3-flash', category: GUEST_MODE_CATEGORY },
      });
      expect(result).toBe('Model: [glm-5.3-flash](<https://example.com/m>)');
      expect(result).not.toContain('→');
      expect(result).not.toContain('guest mode');
    });

    it('composes the guest-mode carve-out with provider attribution and the auto badge', () => {
      // The carve-out only suppresses the swap chain — the rest of the line
      // (provider attribution, auto badge) must still render.
      const result = buildModelFooterText('glm-5.3-flash', 'https://example.com/m', {
        quotaFallback: { fromModel: 'expensive/paid-model', category: GUEST_MODE_CATEGORY },
        provider: 'zai-coding',
        withAutoBadge: true,
      });
      expect(result).toBe(
        'Model: [glm-5.3-flash](<https://example.com/m>) • via Z.AI Coding Plan • 📍 auto'
      );
      expect(result).not.toContain('→');
      expect(result).not.toContain('guest mode');
    });

    it('leaves a non-guest category rendering the swap chain, unchanged (regression pin)', () => {
      const result = buildModelFooterText('paid-default', 'https://example.com/m', {
        quotaFallback: { fromModel: 'expensive/primary', category: 'rate_limit' },
      });
      expect(result).toBe(
        'Model: expensive/primary → [paid-default](<https://example.com/m>) (rate limited)'
      );
    });

    it('keeps the namesSameModel collapse for a non-guest category', () => {
      const result = buildModelFooterText('glm-5.3-flash', 'https://example.com/m', {
        quotaFallback: { fromModel: 'z-ai/glm-5.3-flash', category: 'rate_limit' },
      });
      expect(result).toBe('Model: [glm-5.3-flash](<https://example.com/m>) (rate limited)');
      expect(result).not.toContain('→');
    });

    it('drops the chain when the swap only changed the ROUTE, keeping the reason', () => {
      // The observed footer: a user whose paid default IS the piggyback model
      // gets it served z.ai-direct under its bare id, and the chain rendered
      // "z-ai/glm-5.3-flash → glm-5.3-flash" — one model, two spellings, an
      // arrow implying a swap that never happened. The route change is real and
      // is already named by "• via Z.AI Coding Plan"; the reason stays because
      // it still explains why this model is serving.
      const result = buildModelFooterText('glm-5.3-flash', 'https://example.com/m', {
        quotaFallback: { fromModel: 'z-ai/glm-5.3-flash', category: 'credit_exhaustion' },
        provider: 'zai-coding',
        withAutoBadge: true,
      });
      expect(result).toBe(
        'Model: [glm-5.3-flash](<https://example.com/m>) (out of credit) • via Z.AI Coding Plan • 📍 auto'
      );
      expect(result).not.toContain('→');
    });

    it('drops the chain on an exact from/to match, and on a case-only difference', () => {
      expect(
        buildModelFooterText('some/model', 'https://example.com/m', {
          quotaFallback: { fromModel: 'some/model', category: 'rate_limit' },
        })
      ).toBe('Model: [some/model](<https://example.com/m>) (rate limited)');

      expect(
        buildModelFooterText('glm-5.3-flash', 'https://example.com/m', {
          quotaFallback: { fromModel: 'Z-AI/GLM-5.3-Flash', category: 'server_error' },
        })
      ).toBe('Model: [glm-5.3-flash](<https://example.com/m>) (provider error)');
    });

    it('keeps the chain for a non-z.ai prefix sharing a tail with the target', () => {
      // The collapse strips ONLY `z-ai/`, the one prefix the codebase adds and
      // drops for the same model across routes. Any other `<vendor>/<name>` vs
      // `<name>` pairing is a genuine swap between two different models, and
      // suppressing the arrow there would hide it. (The `user/free-default →
      // free-default` case above is the same invariant, from the live suite.)
      const result = buildModelFooterText('primary', 'https://example.com/m', {
        quotaFallback: { fromModel: 'expensive/primary', category: 'quota_exceeded' },
      });
      expect(result).toBe(
        'Model: expensive/primary → [primary](<https://example.com/m>) (rate limited)'
      );
    });

    it('sanitizes markdown-hostile characters in the quota-fallback source model', () => {
      const result = buildModelFooterText('free-model', 'https://example.com/m', {
        quotaFallback: { fromModel: 'bad[model](x)', category: 'quota_exceeded' },
      });
      expect(result).toContain('badmodelx → [free-model]');
    });

    it('names the resolved model exactly once on a swap', () => {
      // The point of the shape: the target must appear once, not twice — once
      // as a leading link and again after the arrow — which is what made the
      // swap footer visibly long.
      //
      // The count below proves "named once" only for a URL that does not
      // itself contain the model slug, which this stub deliberately does not.
      // Production URLs come from `buildModelInfoUrl`, which for some providers
      // DOES embed the model id in the path — so a raw occurrence count is the
      // wrong instrument for the real invariant. The invariant is positional:
      // the one READABLE mention sits right of the arrow, which the `toContain`
      // and the exact-string assertion pin directly.
      const result = buildModelFooterText('glm-4.5-air', 'https://example.com/m', {
        quotaFallback: { fromModel: 'z-ai/glm-5', category: 'quota_exceeded' },
        provider: 'zai-coding',
      });
      expect(result).toContain('→ [glm-4.5-air]');
      expect(result.split('glm-4.5-air')).toHaveLength(2); // one occurrence, given a slug-free stub URL
      expect(result).toBe(
        'Model: z-ai/glm-5 → [glm-4.5-air](<https://example.com/m>) (rate limited) • via Z.AI Coding Plan'
      );
    });

    it('leaves the no-swap footer byte-identical to the pre-move shape', () => {
      // The link only MOVES when there is an arrow to move it onto; with no
      // swap there is nothing to point at and the line must not change at all.
      expect(buildModelFooterText('glm-4.5-air', 'https://example.com/m')).toBe(
        'Model: [glm-4.5-air](<https://example.com/m>)'
      );
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
      // chat-capable allowlist keeps them out of the model footer even if a future
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
        // The swap shapes, where the link sits AFTER the arrow. These were
        // absent from this list while the regex required the link immediately
        // after "Model: " — so the one shape that could break the strip was
        // the one shape the round-trip never covered.
        buildModelFooterText('test/model', 'https://example.com/model', {
          quotaFallback: { fromModel: 'expensive/primary', category: 'model_not_found' },
        }),
        buildModelFooterText('test/model', 'https://example.com/model', {
          quotaFallback: { fromModel: 'expensive/primary', category: 'quota_exceeded' },
          provider: 'zai-coding',
          withAutoBadge: true,
        }),
        // Maximal shape: a quota swap AND both provider routes failing AND the
        // auto badge, all on one line. Reachable — DiscordResponseSender's
        // buildFooter forwards quotaFallback, fallbackProviderAttempted and
        // withAutoBadge from one options object, so nothing prevents them
        // co-occurring. This is the same untested-but-reachable combination
        // class that let the strip regex break in the first place.
        buildModelFooterText('test/model', 'https://example.com/model', {
          quotaFallback: { fromModel: 'expensive/primary', category: 'server_error' },
          provider: 'zai-coding',
          fallbackProviderAttempted: 'openrouter',
          withAutoBadge: true,
        }),
        // The route-only collapse: a reason with NO preceding arrow. The two
        // optional groups in the regex are independent, but only the
        // arrow-bearing combination was ever exercised here.
        buildModelFooterText('glm-5.3-flash', 'https://example.com/model', {
          quotaFallback: { fromModel: 'z-ai/glm-5.3-flash', category: 'timeout' },
          provider: 'zai-coding',
          withAutoBadge: true,
        }),
        // The guest-mode carve-out: a quotaFallback that renders BARE, with
        // neither arrow nor reason. It reaches the strip regex as the plain
        // no-fallback shape, and is listed so the carve-out stays covered
        // here rather than silently degrading one of the shapes above.
        buildModelFooterText('glm-5.3-flash', 'https://example.com/model', {
          quotaFallback: { fromModel: 'expensive/primary', category: GUEST_MODE_CATEGORY },
          provider: 'zai-coding',
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

    it('still strips the PRE-MOVE footer shape stored in channel history', () => {
      // Messages written before the link moved onto the arrow target are still
      // in the DB and still get fed back to the model. The builder can no
      // longer emit these, so they are written out literally — a regex that
      // only satisfies the current builder would silently start leaking them.
      const legacy = [
        '-# Model: [free-model](<https://example.com/m>) • expensive/primary → free-model (guest mode)',
        '-# Model: [free-model](<https://example.com/m>) • expensive/primary → free-model (rate limited) • via Z.AI Coding Plan',
        '-# Model: [gpt-4](<https://example.com/m>) • via OpenRouter • 📍 auto',
      ];
      for (const line of legacy) {
        BOT_FOOTER_PATTERNS.MODEL.lastIndex = 0;
        expect(line.replace(BOT_FOOTER_PATTERNS.MODEL, ''), line).toBe('');
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

    describe('routing arm', () => {
      it('renders the routed model when there is no quota fallback', () => {
        const result = buildModelFooterText('openrouter/auto', 'https://example.com/m', {
          routedModel: 'anthropic/claude-x',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe(
          'Model: openrouter/auto → [anthropic/claude-x](<https://example.com/routed>) (routed)'
        );
      });

      it('does not fire when routedModel is undefined', () => {
        const result = buildModelFooterText('openrouter/auto', 'https://example.com/m', {
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe('Model: [openrouter/auto](<https://example.com/m>)');
      });

      it('does not fire when routedModel is an empty string', () => {
        const result = buildModelFooterText('openrouter/auto', 'https://example.com/m', {
          routedModel: '',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe('Model: [openrouter/auto](<https://example.com/m>)');
      });

      it('does not fire for a directly-requested model the provider echoes under a different spelling', () => {
        // Observed production shape: modelUsed was requested directly (not a
        // router alias), and the provider's response_metadata.model_name came
        // back with the vendor prefix dropped. This input alone cannot show
        // WHICH guard suppressed the arm — namesSameModel strips exactly that
        // prefix, so it would suppress this case too. The next test uses a
        // spelling no prefix-stripping collapses, which is what isolates the
        // alias gate as the guard doing the work.
        const result = buildModelFooterText('z-ai/glm-5.3-flash', 'https://example.com/m', {
          routedModel: 'glm-5.3-flash',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe('Model: [z-ai/glm-5.3-flash](<https://example.com/m>)');
        expect(result).not.toContain('(routed)');
      });

      it('does not fire for a directly-requested model whose echoed spelling is not covered by namesSameModel', () => {
        // The case the old inequality-only condition got wrong: no prefix
        // stripping would have collapsed these two spellings, so only gating
        // on modelUsed being a router alias prevents a false "(routed)".
        const result = buildModelFooterText('some/model-v2', 'https://example.com/m', {
          routedModel: 'some/model-v2-0613',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe('Model: [some/model-v2](<https://example.com/m>)');
        expect(result).not.toContain('(routed)');
      });

      it('fires genuine routing with the observed production pair', () => {
        const result = buildModelFooterText('openrouter/auto', 'https://example.com/m', {
          routedModel: 'google/gemini-3-pro-image-preview',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe(
          'Model: openrouter/auto → [google/gemini-3-pro-image-preview](<https://example.com/routed>) (routed)'
        );
      });

      // ModelFooterOptions is exported, so a caller other than the one that
      // builds this URL today could pass an empty string. An arrow pointing at
      // an empty link target is worse than no arrow.
      it('does not fire when routedModelUrl is an empty string', () => {
        const result = buildModelFooterText('openrouter/auto', 'https://example.com/m', {
          routedModel: 'google/gemini-3-pro-image-preview',
          routedModelUrl: '',
        });
        expect(result).toBe('Model: [openrouter/auto](<https://example.com/m>)');
        expect(result).not.toContain('(routed)');
      });

      // The alias gate alone would let this through: modelUsed IS an alias, so
      // only namesSameModel suppresses an arrow pointing at the alias itself.
      // Reaching it needs the provider to echo the alias back rather than the
      // model it picked, which is why nothing else here exercises the guard.
      it('does not fire when the provider echoes the alias back as the served model', () => {
        const result = buildModelFooterText('openrouter/auto', 'https://example.com/m', {
          routedModel: 'openrouter/auto',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe('Model: [openrouter/auto](<https://example.com/m>)');
        expect(result).not.toContain('(routed)');
      });

      it('fires for the free router alias', () => {
        const result = buildModelFooterText('openrouter/free', 'https://example.com/m', {
          routedModel: 'google/gemini-3-pro-image-preview',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe(
          'Model: openrouter/free → [google/gemini-3-pro-image-preview](<https://example.com/routed>) (routed)'
        );
      });

      it('a non-guest quota fallback wins over routing, with no (routed) anywhere', () => {
        const result = buildModelFooterText('paid-default', 'https://example.com/m', {
          quotaFallback: { fromModel: 'expensive/primary', category: 'rate_limit' },
          routedModel: 'anthropic/claude-x',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe(
          'Model: expensive/primary → [paid-default](<https://example.com/m>) (rate limited)'
        );
        expect(result).not.toContain('(routed)');
      });

      // Settled composition rule: routing fires ONLY when quotaFallback is
      // strictly undefined — a guest-mode substitution already owns the model
      // line, so it renders bare with no arrow and no "(routed)", exactly as
      // if routedModel had never been passed.
      it('composition rule: a guest-mode quota fallback suppresses routing entirely', () => {
        // modelUsed is a router alias here specifically so this test still
        // proves the composition rule post-fix: guest mode suppresses
        // routing even when the requested model IS an alias, not merely
        // because the alias gate would have blocked it anyway.
        const result = buildModelFooterText('openrouter/free', 'https://example.com/m', {
          quotaFallback: { fromModel: 'expensive/paid-model', category: GUEST_MODE_CATEGORY },
          routedModel: 'anthropic/claude-x',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe('Model: [openrouter/free](<https://example.com/m>)');
        expect(result).not.toContain('→');
        expect(result).not.toContain('(routed)');
      });

      it('strips markdown delimiters from a masked-link routed model id', () => {
        const result = buildModelFooterText('openrouter/auto', 'https://example.com/m', {
          routedModel: '[Free Nitro](http://evil.example)',
          routedModelUrl: 'https://example.com/routed',
        });
        expect(result).toBe(
          'Model: openrouter/auto → [Free Nitrohttp://evil.example](<https://example.com/routed>) (routed)'
        );
        expect(result).not.toContain('](http://evil.example)');
      });
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
