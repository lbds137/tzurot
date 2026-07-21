/**
 * BYOK access validation for /voice tts set/default.
 *
 * Block at command time when the selected TTS config requires a provider
 * key (mistral, elevenlabs) the user hasn't configured. Self-hosted is
 * always allowed (no key required). Council called this out as the
 * "user-friendly fail-fast" UX shape: better to block at command time
 * than let the user think the command succeeded but later get a
 * synthesis-time error.
 *
 * Fail-open on transient gateway errors: if the BYOK check itself fails
 * (gateway down, network blip), let the user proceed and let ai-worker's
 * dispatcher enforce at synthesis. Mirrors the
 * `commands/preset/override/guestModeValidation.ts` pattern.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type TtsConfigSummary } from '@tzurot/common-types/schemas/api/tts-config';
import { isSelfHostedTtsProvider } from '@tzurot/common-types/services/tts/TtsProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

const logger = createLogger('voice-tts-byok-validation');

export interface ByokAccessOutcome {
  /** True when the user lacks the BYOK key for this config; the handler should bail. */
  blocked: boolean;
  /**
   * Diagnostic reason recorded on the audit trail:
   *  - `self-hosted`: provider doesn't need a key, allowed unconditionally
   *  - `has-key`: ElevenLabs probe (`/user/voices`) returned 200 → key present
   *  - `check-skipped`: non-elevenlabs BYOK provider, no command-time probe
   *    available — ai-worker enforces at synthesis. Distinct from `has-key`
   *    so log analysis can tell "verified vs. deferred."
   *  - `check-failed`: probe attempted but returned a non-404 error → fail-open
   *  - `no-config-found`: configId not in user-visible list → fail-open
   *  - `blocked-byok`: probe returned 404 → user blocked at command time
   */
  reason:
    | 'self-hosted'
    | 'has-key'
    | 'check-skipped'
    | 'check-failed'
    | 'no-config-found'
    | 'blocked-byok';
}

/**
 * Look up the selected TTS config + user's audio-provider keys, then decide
 * whether to block.
 *
 * Returns `{ blocked: true, reason: 'blocked-byok' }` when:
 *   - The config exists, requires a BYOK provider, AND the user lacks the key
 *
 * Returns `{ blocked: false, reason: ... }` for all other paths, including
 * fail-open on transient gateway errors. The caller proceeds with the
 * underlying mutation; the ai-worker dispatcher's `isAvailable()` is the
 * second-line defense.
 */
export async function checkTtsByokAccess(
  context: DeferredCommandContext,
  configId: string,
  userClient: UserClient
): Promise<ByokAccessOutcome> {
  const userId = context.user.id;

  // Fetch the user's visible TTS configs (globals + user-owned). This
  // validates that the configId is real AND surfaces the provider field.
  const configsResult = await userClient.listUserTtsConfigs();
  if (!configsResult.ok) {
    logger.warn(
      { userId, status: configsResult.status },
      'TTS config list fetch failed — failing open, ai-worker will enforce at synthesis'
    );
    return { blocked: false, reason: 'check-failed' };
  }

  const config: TtsConfigSummary | undefined = configsResult.data.configs.find(
    c => c.id === configId
  );
  if (config === undefined) {
    // Defensive: autocomplete should have constrained the choice. If somehow
    // the configId isn't in the list, fail-open so the gateway 404 is the
    // user-facing error (more precise than our generic "not found").
    logger.warn({ userId, configId }, 'TTS config not in user-visible list — failing open');
    return { blocked: false, reason: 'no-config-found' };
  }

  // Self-hosted: no key required, always allowed
  if (isSelfHostedTtsProvider(config.provider)) {
    return { blocked: false, reason: 'self-hosted' };
  }

  // ElevenLabs: probe via /user/voices, which is the existing ElevenLabs
  // voices endpoint. 404 = no ElevenLabs key configured → block at command
  // time so the user gets immediate feedback. Other errors fail-open.
  if (config.provider === 'elevenlabs') {
    const keysResult = await userClient.listVoices();
    if (!keysResult.ok) {
      if (keysResult.status === 404) {
        const embed = new EmbedBuilder()
          .setTitle('🔑 API Key Required')
          .setColor(DISCORD_COLORS.WARNING)
          .setDescription(
            `**${config.name}** uses the **${config.provider}** TTS provider, which requires your own API key.\n\n` +
              `Use **\`/settings apikey set provider:${config.provider}\`** to configure your key, then try again.`
          )
          .setTimestamp();
        await context.editReply({ embeds: [embed] });
        logger.info(
          { userId, configId, configName: config.name, provider: config.provider },
          'Blocked TTS set: no ElevenLabs key configured'
        );
        return { blocked: true, reason: 'blocked-byok' };
      }
      // Other errors (500, etc.): fail-open
      logger.warn(
        { userId, status: keysResult.status },
        'Voice keys check failed — failing open, ai-worker will enforce at synthesis'
      );
      return { blocked: false, reason: 'check-failed' };
    }
    return { blocked: false, reason: 'has-key' };
  }

  // Other BYOK providers (mistral, future): the /user/voices endpoint is
  // ElevenLabs-specific, so probing it would inversely block users who have
  // a Mistral key but no ElevenLabs setup — exactly the users PR 3b enables.
  // Fail-open at command time and let ai-worker's TtsDispatcher.isAvailable()
  // enforce the per-provider key check at synthesis. The autocomplete still
  // surfaces the provider tag so users see what they're picking.
  // Backlog: a dedicated /user/audio-provider-keys endpoint would let us
  // gate at command time across providers; deferred to a follow-up.
  //
  // Reason `check-skipped` (vs `has-key`): truthful in audit logs about
  // whether a verification ran, since this branch defers the decision.
  logger.debug(
    { userId, configId, configName: config.name, provider: config.provider },
    'Skipping command-time BYOK probe for non-elevenlabs provider — ai-worker enforces at synthesis'
  );
  return { blocked: false, reason: 'check-skipped' };
}
