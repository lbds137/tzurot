/**
 * Wallet Set Subcommand
 * Opens a modal for secure API key input
 *
 * Security:
 * - Uses Discord Modal for API key input (more secure than slash command args)
 * - API keys are NEVER visible in slash command history
 * - Response is ephemeral (only visible to the user)
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { API_KEY_FORMATS } from '@tzurot/common-types/constants/wallet';
import { settingsApikeySetOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ModalCommandContext } from '../../../utils/commandContext/types.js';
import { buildToolkitModal } from '../../../utils/modal/toolkit.js';
import { ApikeyCustomIds } from '../../../utils/customIds.js';

const logger = createLogger('settings-apikey-set');

/**
 * Handle /settings apikey set <provider> subcommand
 * Shows a modal for secure API key input
 *
 * Receives ModalCommandContext (has showModal method!)
 * because this subcommand uses deferralMode: 'modal'.
 */
export async function handleSetKey(context: ModalCommandContext): Promise<void> {
  const options = settingsApikeySetOptions(context.interaction);
  const provider = options.provider() as AIProvider;

  // Determine provider display name and help text
  const providerInfo = getProviderInfo(provider);

  // Single short line for security — a paragraph field would soft-wrap the
  // key across lines and invite partial-selection copy mistakes.
  const modal = buildToolkitModal({
    customId: ApikeyCustomIds.set(provider),
    title: `Set ${providerInfo.displayName} API Key`,
    items: [
      {
        kind: 'text',
        id: 'apiKey',
        label: `${providerInfo.displayName} API Key`,
        description: providerInfo.helpUrl.length > 0 ? `Get a key: ${providerInfo.helpUrl}` : '',
        style: 'short',
        placeholder: providerInfo.placeholder,
        required: true,
        minLength: 10,
        maxLength: 200,
      },
    ],
  });

  await context.showModal(modal);

  logger.info({ provider, userId: context.user.id }, 'Showing API key input modal');
}

/**
 * Get provider-specific information for display
 */
function getProviderInfo(provider: AIProvider): {
  displayName: string;
  placeholder: string;
  helpUrl: string;
} {
  switch (provider) {
    case AIProvider.OpenRouter:
      return {
        displayName: 'OpenRouter',
        placeholder: API_KEY_FORMATS.OPENROUTER_PLACEHOLDER,
        helpUrl: 'https://openrouter.ai/keys',
      };
    case AIProvider.ElevenLabs:
      return {
        displayName: 'ElevenLabs',
        placeholder: API_KEY_FORMATS.ELEVENLABS_PLACEHOLDER,
        helpUrl: 'https://elevenlabs.io/app/settings/api-keys',
      };
    case AIProvider.ZaiCoding:
      return {
        displayName: 'Z.AI Coding Plan',
        placeholder: API_KEY_FORMATS.ZAI_CODING_PLACEHOLDER,
        helpUrl: 'https://z.ai/manage-apikey/apikey-list',
      };
    case AIProvider.Mistral:
      return {
        displayName: 'Mistral (Voxtral TTS/STT)',
        placeholder: 'Your Mistral API key (console.mistral.ai)',
        helpUrl: 'https://console.mistral.ai/api-keys',
      };
    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      return {
        displayName: _exhaustive,
        placeholder: 'Your API key',
        helpUrl: '',
      };
    }
  }
}
