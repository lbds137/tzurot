import { describe, it, expect } from 'vitest';
import {
  adjustRefusedWebhookUsername,
  deriveBotSuffix,
  stripBotSuffix,
  extractPersonalityName,
  resolveWebhookAwareDisplayName,
  WEBHOOK_USERNAME_MAX_LENGTH,
} from './webhookNaming.js';

const HAIR = String.fromCodePoint(0x200a);

describe('deriveBotSuffix', () => {
  it('produces canonical " · BotName" from a simple tag', () => {
    expect(deriveBotSuffix('Tzurot')).toBe(' · Tzurot');
  });

  it('strips a legacy "#NNNN" discriminator before deriving the suffix', () => {
    expect(deriveBotSuffix('Tzurot#1234')).toBe(' · Tzurot');
  });

  it('uses the right-hand side when the tag already contains the canonical separator', () => {
    expect(deriveBotSuffix('Dev · Tzurot')).toBe(' · Tzurot');
  });

  it('uses the right-hand side when the tag contains the legacy separator', () => {
    expect(deriveBotSuffix('Dev | Tzurot')).toBe(' · Tzurot');
  });

  it('returns "" for null/undefined/empty input', () => {
    expect(deriveBotSuffix(null)).toBe('');
    expect(deriveBotSuffix(undefined)).toBe('');
    expect(deriveBotSuffix('')).toBe('');
  });

  it('returns "" when the tag is only whitespace or only a discriminator', () => {
    expect(deriveBotSuffix('   ')).toBe('');
    expect(deriveBotSuffix('#1234')).toBe('');
  });

  // Pin the production bot-tag shapes so a future tag change is caught here
  // before reaching prod. If the tags below ever change, update the assertions
  // alongside the rename.
  it('handles the dev bot tag', () => {
    expect(deriveBotSuffix('Rotzot · תשב#3778')).toBe(' · תשב');
  });

  it('handles the prod bot tag', () => {
    expect(deriveBotSuffix('Tzurot · שבת#9971')).toBe(' · שבת');
  });

  it('keeps the full right-hand side when a tag contains multiple separators', () => {
    // Production tags are simple ("Rotzot · תשב"), but a future compound
    // tag like "A · B · C" should yield " · B · C" — anything to the right
    // of the first separator is part of the bot's display name.
    expect(deriveBotSuffix('A · B · C')).toBe(' · B · C');
    expect(deriveBotSuffix('A | B | C')).toBe(' · B | C');
  });
});

describe('stripBotSuffix', () => {
  const suffix = ' · Tzurot';

  it('strips the canonical " · BotName" suffix', () => {
    expect(stripBotSuffix('Weaver · Tzurot', suffix)).toBe('Weaver');
  });

  it('strips the legacy " | BotName" suffix (back-compat for old messages)', () => {
    expect(stripBotSuffix('Weaver | Tzurot', suffix)).toBe('Weaver');
  });

  it('returns null when the username does not end with either suffix form', () => {
    expect(stripBotSuffix('Weaver', suffix)).toBeNull();
    expect(stripBotSuffix('Weaver · OtherBot', suffix)).toBeNull();
  });

  it('handles personality names containing the canonical separator inside the name', () => {
    // "A · B" is a valid personality displayName; only the trailing suffix should be stripped.
    expect(stripBotSuffix('A · B · Tzurot', suffix)).toBe('A · B');
  });

  it('handles personality names containing the legacy separator inside the name', () => {
    expect(stripBotSuffix('A | B · Tzurot', suffix)).toBe('A | B');
  });

  it('returns null when either argument is empty', () => {
    expect(stripBotSuffix('', suffix)).toBeNull();
    expect(stripBotSuffix('Weaver · Tzurot', '')).toBeNull();
  });

  it('trims whitespace introduced by the suffix boundary', () => {
    // The current separator already starts with a space, so slicing it produces
    // a trailing-space-free result — but defend against accidental double-space.
    expect(stripBotSuffix('Weaver  · Tzurot', suffix)).toBe('Weaver');
  });

  it('strips suffixes containing non-ASCII characters (Hebrew prod/dev bot names)', () => {
    expect(stripBotSuffix('Weaver · תשב', ' · תשב')).toBe('Weaver');
    expect(stripBotSuffix('Weaver · שבת', ' · שבת')).toBe('Weaver');
    // Legacy form back-compat with non-ASCII suffix
    expect(stripBotSuffix('Weaver | שבת', ' · שבת')).toBe('Weaver');
  });
});

describe('extractPersonalityName', () => {
  it('strips the suffix when present', () => {
    expect(extractPersonalityName('Weaver · Tzurot', ' · Tzurot')).toBe('Weaver');
  });

  it('falls back to the raw username when no suffix matches', () => {
    expect(extractPersonalityName('Weaver', ' · Tzurot')).toBe('Weaver');
  });

  it('falls back to the raw username when botSuffix is empty', () => {
    expect(extractPersonalityName('Weaver · Tzurot', '')).toBe('Weaver · Tzurot');
  });
});

describe('resolveWebhookAwareDisplayName', () => {
  it('strips our suffix only for webhook-authored names', () => {
    expect(resolveWebhookAwareDisplayName('COLD · Tzurot', 'wh-1', 'Tzurot#1234')).toBe('COLD');
    // Human (no webhookId): untouched even when the name happens to match.
    expect(resolveWebhookAwareDisplayName('COLD · Tzurot', null, 'Tzurot#1234')).toBe(
      'COLD · Tzurot'
    );
    // Foreign webhook: no suffix to strip, passthrough.
    expect(resolveWebhookAwareDisplayName('Some Other Bot', 'wh-2', 'Tzurot#1234')).toBe(
      'Some Other Bot'
    );
    // Degraded: no bot tag means no derivable suffix, raw name over guessing.
    expect(resolveWebhookAwareDisplayName('COLD · Tzurot', 'wh-1', undefined)).toBe(
      'COLD · Tzurot'
    );
  });
});

describe('adjustRefusedWebhookUsername', () => {
  const suffix = ' · Tzurot';

  it('inserts one hair space after the first character of a refused word', () => {
    const out = adjustRefusedWebhookUsername('Discord Helper', suffix);
    const codePoints = Array.from(out).map(c => c.codePointAt(0));

    expect(codePoints.filter(cp => cp === 0x200a)).toHaveLength(1);
    expect(codePoints[1]).toBe(0x200a);
    expect(out.split(HAIR).join('')).toBe('Discord Helper · Tzurot');
  });

  it('breaks an uppercase refused word', () => {
    expect(adjustRefusedWebhookUsername('DISCORD', suffix)).toBe(`D${HAIR}ISCORD${suffix}`);
  });

  it('breaks clyde in the middle of a name', () => {
    expect(adjustRefusedWebhookUsername('My Clyde Hook', suffix)).toBe(
      `My C${HAIR}lyde Hook${suffix}`
    );
  });

  it('breaks every occurrence, not only the first', () => {
    expect(adjustRefusedWebhookUsername('discord and discord', suffix)).toBe(
      `d${HAIR}iscord and d${HAIR}iscord${suffix}`
    );
  });

  it('clamps a 100-character name so the whole username fits the cap', () => {
    const out = adjustRefusedWebhookUsername('a'.repeat(100), suffix);

    expect(out).toBe(`${'a'.repeat(70)}… · Tzurot`);
    expect(out.length).toBe(WEBHOOK_USERNAME_MAX_LENGTH);
  });

  it('never leaves a lone surrogate at the cut point', () => {
    // 69 ASCII characters, then an astral code point, then two more characters.
    // A naive slice to the budget would split the surrogate pair.
    const name = `${'x'.repeat(69)}${String.fromCodePoint(0x1f600)}yy`;
    const out = adjustRefusedWebhookUsername(name, suffix);

    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(WEBHOOK_USERNAME_MAX_LENGTH);
  });

  it('leaves a short clean name unchanged apart from the suffix', () => {
    expect(adjustRefusedWebhookUsername('Weaver', suffix)).toBe(`Weaver${suffix}`);
  });

  it('trims trailing whitespace before the ellipsis when the cut lands after a space', () => {
    // The 70th kept character is a space, so the kept text would end "x… " without trimEnd.
    const name = `${'x'.repeat(69)} ${'y'.repeat(30)}`;
    const out = adjustRefusedWebhookUsername(name, suffix);

    expect(out).toBe(`${'x'.repeat(69)}…${suffix}`);
    expect(out.includes(' …')).toBe(false);
  });
});

describe('stripBotSuffix recovers a hair-space-adjusted name', () => {
  const suffix = ' · Tzurot';

  it('strips back to the original name from a canonical adjusted username', () => {
    const adjusted = adjustRefusedWebhookUsername('Discord Helper', suffix);
    expect(stripBotSuffix(adjusted, suffix)).toBe('Discord Helper');
  });

  it('strips back to the original name from a legacy-separator adjusted username', () => {
    expect(stripBotSuffix(`D${HAIR}iscord Helper | Tzurot`, suffix)).toBe('Discord Helper');
  });

  it('reads a trimmed adjusted username back as the trimmed text without hair spaces', () => {
    // Documented lossy case: the trimmed `…` is kept, the hair space is removed.
    const adjusted = adjustRefusedWebhookUsername(`Discord ${'y'.repeat(100)}`, suffix);

    expect(stripBotSuffix(adjusted, suffix)).toBe(`Discord ${'y'.repeat(61)}…`);
    expect(stripBotSuffix(adjusted, suffix)?.includes(HAIR)).toBe(false);
  });
});
