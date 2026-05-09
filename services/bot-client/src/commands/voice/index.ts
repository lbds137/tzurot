/**
 * Voice Command Group
 *
 * Unified namespace for voice configuration:
 *
 * - /voice tts browse|set|clear|set-default|clear-default — TTS provider config
 * - /voice voices browse|delete|clear — cloned-voice lifecycle
 *
 * Consolidates the former /settings tts and /settings voices surfaces under
 * a single top-level command. Symmetric subcommand naming (set / clear /
 * set-default / clear-default) replaces the legacy mix of set/reset/default/
 * clear-default. The same shape will extend to /voice stt, /voice provider
 * for the bundled-default semantic, and a /voice view dashboard when added.
 *
 * The legacy /settings tts and /settings voices subcommand groups remain
 * registered as deprecation stubs that ephemerally redirect users to the
 * new paths.
 */

import { SlashCommandBuilder } from 'discord.js';
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';
import { DestructiveCustomIds } from '../../utils/customIds.js';

// TTS handlers
import { handleTtsBrowseOverrides } from './tts/browse.js';
import { handleTtsSet } from './tts/set.js';
import { handleTtsClear } from './tts/clear.js';
import { handleTtsSetDefault } from './tts/set-default.js';
import { handleTtsClearDefault } from './tts/clear-default.js';
import { handleAutocomplete as handleTtsAutocomplete } from './tts/autocomplete.js';

// Voices handlers
import {
  handleBrowseVoices,
  handleVoiceBrowsePagination,
  isVoiceBrowseInteraction,
} from './voices/browse.js';
import { handleDeleteVoice, handleVoiceAutocomplete } from './voices/delete.js';
import {
  handleClearVoices,
  handleVoiceClearButton,
  handleVoiceClearModal,
  VOICE_CLEAR_OPERATION,
} from './voices/clear.js';

import { buildVoiceTtsSubcommandGroup } from './tts/subcommandBuilder.js';
import { buildVoiceVoicesSubcommandGroup } from './voices/subcommandBuilder.js';

const logger = createLogger('voice-command');

const ttsRouter = createTypedSubcommandRouter(
  {
    browse: handleTtsBrowseOverrides,
    set: handleTtsSet,
    clear: handleTtsClear,
    'set-default': handleTtsSetDefault,
    'clear-default': handleTtsClearDefault,
  },
  { logger, logPrefix: '[Voice/Tts]' }
);

const voicesRouter = createTypedSubcommandRouter(
  {
    browse: handleBrowseVoices,
    delete: handleDeleteVoice,
    clear: handleClearVoices,
  },
  { logger, logPrefix: '[Voice/Voices]' }
);

async function execute(context: SafeCommandContext): Promise<void> {
  const group = context.getSubcommandGroup();
  const deferredCtx = context as DeferredCommandContext;

  if (group === 'tts') {
    await ttsRouter(deferredCtx);
  } else if (group === 'voices') {
    await voicesRouter(deferredCtx);
  } else {
    logger.warn({ group }, 'Unknown voice subcommand group');
    await deferredCtx.editReply({ content: '❌ Unknown voice group.' });
  }
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup();

  if (subcommandGroup === 'tts') {
    await handleTtsAutocomplete(interaction);
    return;
  }
  if (subcommandGroup === 'voices') {
    // getFocused only inside the branch that reads it — avoids dead
    // computation when autocompleting /voice tts options.
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'voice') {
      await handleVoiceAutocomplete(interaction);
      return;
    }
  }
  await interaction.respond([]);
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (isVoiceBrowseInteraction(interaction.customId)) {
    await handleVoiceBrowsePagination(interaction);
    return;
  }

  if (DestructiveCustomIds.isDestructive(interaction.customId)) {
    const parsed = DestructiveCustomIds.parse(interaction.customId);
    if (parsed?.operation === VOICE_CLEAR_OPERATION) {
      await handleVoiceClearButton(interaction);
      return;
    }
  }

  logger.warn({ customId: interaction.customId }, 'Unknown button customId');
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (DestructiveCustomIds.isDestructive(interaction.customId)) {
    const parsed = DestructiveCustomIds.parse(interaction.customId);
    if (parsed?.operation === VOICE_CLEAR_OPERATION) {
      await handleVoiceClearModal(interaction);
      return;
    }
  }

  logger.warn({ customId: interaction.customId }, 'Unknown modal customId');
}

// Voice command currently has no select menus. Reserved for the /voice view
// dashboard. Returns Promise.resolve() rather than being marked async so we
// satisfy defineCommand's Promise<void> contract without an unnecessary
// microtask tick (and without tripping the require-await lint).
function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  logger.debug({ customId: interaction.customId }, 'Unhandled select menu in voice command');
  return Promise.resolve();
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Voice configuration: TTS providers + cloned voices')
    .addSubcommandGroup(buildVoiceTtsSubcommandGroup)
    .addSubcommandGroup(buildVoiceVoicesSubcommandGroup),
  deferralMode: 'ephemeral',
  execute,
  autocomplete,
  handleButton,
  handleModal,
  handleSelectMenu,
  // settings-voices prefix preserved so pre-deploy pagination embeds created
  // by the legacy /settings voices browse remain routable post-deploy. Safe
  // to rename to voice-voices once the deprecation stubs are removed (tracked
  // in backlog/inbox.md).
  componentPrefixes: ['settings-voices'],
});
