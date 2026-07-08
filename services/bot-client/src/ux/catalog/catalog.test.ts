import { describe, it, expect } from 'vitest';
import { CATALOG } from './catalog.js';
import type { MessageSpec } from './types.js';

/** Walk every intent in the catalog with representative args. */
function allSpecs(): { path: string; spec: MessageSpec }[] {
  return [
    { path: 'error.notFound', spec: CATALOG.error.notFound('Character') },
    {
      path: 'error.notFound+autocomplete',
      spec: CATALOG.error.notFound('Character', { autocomplete: true }),
    },
    { path: 'error.userRetryable', spec: CATALOG.error.userRetryable('Invalid slug.') },
    { path: 'error.transient', spec: CATALOG.error.transient("Couldn't reach the server.") },
    { path: 'error.uncertainWrite', spec: CATALOG.error.uncertainWrite('preset') },
    {
      path: 'error.uncertainWrite+refresh',
      spec: CATALOG.error.uncertainWrite('preset', { refreshAffordance: true }),
    },
    { path: 'error.committedUnconfirmed', spec: CATALOG.error.committedUnconfirmed('preset') },
    {
      path: 'error.committedUnconfirmed+refresh',
      spec: CATALOG.error.committedUnconfirmed('preset', { refreshAffordance: true }),
    },
    { path: 'error.gatewayRejection', spec: CATALOG.error.gatewayRejection('Slug already taken') },
    { path: 'error.operationFailed', spec: CATALOG.error.operationFailed('create the character') },
    { path: 'error.permissionDenied', spec: CATALOG.error.permissionDenied('edit this') },
    { path: 'error.validation', spec: CATALOG.error.validation('Name must be 1-255 characters.') },
    { path: 'error.commandFailed', spec: CATALOG.error.commandFailed() },
    { path: 'error.interactionFailed', spec: CATALOG.error.interactionFailed() },
    { path: 'success.banner', spec: CATALOG.success.banner('Deleted character', 'Luna') },
    { path: 'success.done', spec: CATALOG.success.done('Timezone updated.') },
    { path: 'progress.working', spec: CATALOG.progress.working('Importing') },
    { path: 'progress.sessionExpired', spec: CATALOG.progress.sessionExpired() },
    { path: 'progress.sessionExpired+cmd', spec: CATALOG.progress.sessionExpired('/memory') },
    { path: 'info.note', spec: CATALOG.info.note('Only the first 5 respond.') },
  ];
}

describe('CATALOG', () => {
  it('OUTCOME-HONESTY INVARIANT: uncertain/committed-unconfirmed specs never invite a retry', () => {
    // The core rule of the catalog (design §4.2): a write whose outcome is
    // unknown must never render a retry invitation — that's the duplicate-write
    // bug. The regex covers synonyms: "trying again" carries the exact same
    // invitation as "try again" and must not dodge on morphology.
    const RETRY_INVITATION = /try(?:ing)?\s+again|retry|re-?submit/i;
    for (const { path, spec } of allSpecs()) {
      if (spec.outcome === 'uncertain' || spec.outcome === 'committed-unconfirmed') {
        expect(spec.text, `${path} must not invite a retry`).not.toMatch(RETRY_INVITATION);
        expect(spec.personaText ?? '', `${path} personaText must not invite a retry`).not.toMatch(
          RETRY_INVITATION
        );
      }
    }
  });

  it('no spec text carries a hand-written emoji prefix (renderer owns glyphs)', () => {
    for (const { path, spec } of allSpecs()) {
      expect(spec.text, `${path} must be pre-emoji`).not.toMatch(/^(?:❌|⚠️|✅|⏳|⏰|🔄|ℹ️)/u);
    }
  });

  it('canonical retry wording: user-retryable says "try again", transient says "try again later"', () => {
    expect(CATALOG.error.userRetryable('X.').text).toMatch(/Please try again\.$/);
    expect(CATALOG.error.transient('X.').text).toMatch(/Please try again later\.$/);
  });

  it('not-found appends the autocomplete steer only when requested', () => {
    expect(CATALOG.error.notFound('Preset').text).toBe('Preset not found.');
    expect(CATALOG.error.notFound('Preset', { autocomplete: true }).text).toContain(
      'Use autocomplete'
    );
  });

  it('uncertain/committed shapes name the Refresh affordance only when it exists', () => {
    expect(CATALOG.error.uncertainWrite('preset', { refreshAffordance: true }).text).toContain(
      '🔄 Refresh'
    );
    expect(CATALOG.error.uncertainWrite('preset').text).not.toContain('Refresh');
    expect(
      CATALOG.error.committedUnconfirmed('preset', { refreshAffordance: true }).text
    ).toContain('🔄 Refresh');
    expect(CATALOG.error.committedUnconfirmed('preset').text).not.toContain('Refresh');
  });

  it('success banner keeps the established shape (bold verb · name)', () => {
    expect(CATALOG.success.banner('Deleted preset', 'Fast').text).toBe('**Deleted preset** · Fast');
  });
});
