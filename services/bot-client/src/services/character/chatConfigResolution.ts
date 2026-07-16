/**
 * Shared LLM-config resolution for the two chat entry paths — the message
 * pipeline (`PersonalityChatManager`, serving reply/mention/activation) and the
 * `/character chat` slash command (`chat.ts`). Both resolve the cascade config
 * from the gateway and derive extended-context settings from it; keeping ONE
 * copy here is what lets the slash path honour user/channel overrides instead of
 * silently running as if resolution had failed.
 *
 * The error fallback uses hardcoded defaults (NOT the personality's LlmConfig
 * columns) — those memory/context columns are retired; the config cascade is the
 * sole source now.
 */

import { MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import { type SettingSource } from '@tzurot/common-types/schemas/api/adminSettings';
import { type ConfigResolutionResult } from '@tzurot/common-types/types/configResolution';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { UserClient } from '@tzurot/clients';

const logger = createLogger('chatConfigResolution');

/** Extended-context settings with per-field source attribution. */
export interface ExtendedContextSettings {
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  sources: {
    maxMessages: SettingSource;
    maxAge: SettingSource;
    maxImages: SettingSource;
  };
}

/**
 * Resolve LLM config from the gateway cascade, applying user/channel overrides.
 * Falls back to hardcoded defaults on error so a transient gateway blip degrades
 * gracefully rather than failing the request. The fallback deliberately does NOT
 * read personality LlmConfig columns — those are retired; defaults mirror the
 * cascade's own baseline.
 */
export async function resolveChatLlmConfig(
  userClient: UserClient,
  personality: LoadedPersonality,
  channelId?: string
): Promise<ConfigResolutionResult> {
  const result = await userClient.resolveUserLlmConfig({
    personalityId: personality.id,
    personalityConfig: personality,
    channelId,
  });

  if (!result.ok) {
    logger.warn(
      { userId: userClient.actor, personalityId: personality.id, error: result.error },
      'Failed to resolve config, using hardcoded defaults'
    );
    return {
      config: {
        model: personality.model,
        maxMessages: MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
        maxAge: null,
        maxImages: MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
      },
      source: 'hardcoded',
    };
  }

  // Cast bridges the runtime ConfigResolutionResult shape (declared on the
  // server, in services/LlmConfigResolver.ts) and the schema's narrower
  // declared response (only required fields, rest .passthrough()).
  return result.data as unknown as ConfigResolutionResult;
}

/**
 * Build extended-context settings from a resolved config. Prefers per-field
 * cascade overrides (`overrides.sources`) when present so each setting can be
 * attributed to its tier of origin; otherwise falls to the resolved config's
 * values (or hardcoded defaults) under a single source label.
 */
export function buildExtendedContextSettings(
  resolvedConfig: ConfigResolutionResult
): ExtendedContextSettings {
  const { config, source, overrides } = resolvedConfig;

  if (overrides !== undefined) {
    return {
      maxMessages: overrides.maxMessages,
      maxAge: overrides.maxAge,
      maxImages: overrides.maxImages,
      sources: {
        maxMessages: overrides.sources.maxMessages,
        maxAge: overrides.sources.maxAge,
        maxImages: overrides.sources.maxImages,
      },
    };
  }

  // ConfigResolutionSource includes a TTS-only tier 'free-default' that
  // SettingSource (dashboard taxonomy) doesn't share. LLM resolution never
  // produces it in practice; narrow defensively in case the union widens.
  const settingSource: SettingSource = source === 'free-default' ? 'hardcoded' : source;
  return {
    maxMessages: config.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
    maxAge: config.maxAge ?? null,
    maxImages: config.maxImages ?? MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
    sources: {
      maxMessages: settingSource,
      maxAge: settingSource,
      maxImages: settingSource,
    },
  };
}
