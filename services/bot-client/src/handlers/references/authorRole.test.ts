import { describe, it, expect } from 'vitest';
import { classifyReferenceAuthorRole, type AuthorRoleSignals } from './authorRole.js';

const OUR_BOT_ID = 'bot-app-123';
const PROXY_ID = 'pluralkit-app-999';
const PROXY_IDS: readonly string[] = [PROXY_ID];

function signals(partial: Partial<AuthorRoleSignals> = {}): AuthorRoleSignals {
  return {
    webhookId: null,
    authorIsBot: false,
    applicationId: null,
    clientUserId: OUR_BOT_ID,
    ...partial,
  };
}

describe('classifyReferenceAuthorRole', () => {
  it('classifies a real human (no webhook, not a bot) as user', () => {
    expect(classifyReferenceAuthorRole(signals())).toBe('user');
  });

  it('classifies our own bot webhook (applicationId === clientUserId) as assistant', () => {
    expect(
      classifyReferenceAuthorRole(signals({ webhookId: 'wh-1', applicationId: OUR_BOT_ID }))
    ).toBe('assistant');
  });

  it('classifies our own persona regardless of authorIsBot flag shape', () => {
    // Webhook messages carry author.bot=true and a webhookId; either gates "machine".
    expect(
      classifyReferenceAuthorRole(
        signals({ webhookId: 'wh-1', authorIsBot: true, applicationId: OUR_BOT_ID })
      )
    ).toBe('assistant');
  });

  it('classifies a known proxy webhook (PluralKit/TupperBox) as user', () => {
    expect(
      classifyReferenceAuthorRole(
        signals({ webhookId: 'wh-pk', applicationId: PROXY_ID }),
        PROXY_IDS
      )
    ).toBe('user');
  });

  it('classifies a non-persona, non-proxy bot/webhook as bot', () => {
    expect(
      classifyReferenceAuthorRole(
        signals({ webhookId: 'wh-other', applicationId: 'some-other-bot' }),
        PROXY_IDS
      )
    ).toBe('bot');
  });

  it('classifies an unrecognized applicationId as bot (catch-all)', () => {
    // An applicationId neither ours nor a known proxy falls into the bot catch-all.
    expect(
      classifyReferenceAuthorRole(signals({ webhookId: 'wh-x', applicationId: 'unrecognized-app' }))
    ).toBe('bot');
  });

  it('promotes a known proxy (PluralKit) to user via the default allowlist', () => {
    // PluralKit's real applicationId is in KNOWN_PROXY_APP_IDS → a proxied human reads
    // as role="user", not bot. (No injected set — exercises the production default.)
    expect(
      classifyReferenceAuthorRole(
        signals({ webhookId: 'wh-pk', applicationId: '466378653216014359' })
      )
    ).toBe('user');
  });

  it('promotes a known proxy (TupperBox) to user via the default allowlist', () => {
    // TupperBox's real applicationId is in KNOWN_PROXY_APP_IDS → a proxied human reads
    // as role="user". Guards against a typo silently dropping TupperBox to the bot path.
    expect(
      classifyReferenceAuthorRole(
        signals({ webhookId: 'wh-tb', applicationId: '431544605209788416' })
      )
    ).toBe('user');
  });

  it('classifies a webhook with no applicationId as bot (not our persona, no proxy match)', () => {
    expect(classifyReferenceAuthorRole(signals({ webhookId: 'wh-x', applicationId: null }))).toBe(
      'bot'
    );
  });

  it('does not crash or misclassify when clientUserId is undefined', () => {
    // Degraded path (client.user not ready): a webhook can't be confirmed as ours.
    expect(
      classifyReferenceAuthorRole(
        signals({ webhookId: 'wh-1', applicationId: OUR_BOT_ID, clientUserId: undefined })
      )
    ).toBe('bot');
  });

  it('treats an authorIsBot account with no webhook as machine-authored', () => {
    // A classic bot account (not a webhook) is still not a human.
    expect(
      classifyReferenceAuthorRole(
        signals({ authorIsBot: true, applicationId: 'mee6-app' }),
        PROXY_IDS
      )
    ).toBe('bot');
  });
});
