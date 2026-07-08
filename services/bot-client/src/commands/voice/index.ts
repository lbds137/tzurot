/**
 * Voice Command Group
 *
 * Unified namespace for voice configuration:
 *
 * - /voice tts browse|set|clear|set-default|clear-default — TTS provider config (per-character + user-default)
 * - /voice stt set|clear — transcription provider preference (user-scoped; STT is speaker-bound)
 * - /voice voices browse|delete|clear — cloned-voice lifecycle
 * - /voice view <character> — unified TTS+STT+voices dashboard
 */

import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { defineCommand } from '../../utils/defineCommand.js';
import { createTypedSubcommandRouter } from '../../utils/subcommandRouter.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';
import { DestructiveCustomIds } from '../../utils/customIds.js';

// TTS handlers
import {
  handleTtsBrowse,
  handleTtsBrowseSelect,
  handleTtsBrowseButton,
  isTtsOverrideInteraction,
  TTS_OVERRIDE_PREFIX,
} from './tts/browse.js';
import { handleTtsSet } from './tts/set.js';
import { handleTtsClear } from './tts/clear.js';
import { handleTtsSetDefault } from './tts/set-default.js';
import { handleTtsClearDefault } from './tts/clear-default.js';
import { handleAutocomplete as handleTtsAutocomplete } from './tts/autocomplete.js';

// STT handlers (set / clear — user-scoped, no per-character)
import { handleSttSet } from './stt/set.js';
import { handleSttClear } from './stt/clear.js';

// View handler
import { handleVoiceView } from './view.js';

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
import { buildVoiceSttSubcommandGroup } from './stt/subcommandBuilder.js';

import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';

const logger = createLogger('voice-command');

const ttsRouter = createTypedSubcommandRouter(
  {
    browse: handleTtsBrowse,
    set: handleTtsSet,
    clear: handleTtsClear,
    'set-default': handleTtsSetDefault,
    'clear-default': handleTtsClearDefault,
  },
  { logger, logPrefix: '[Voice/Tts]' }
);

const sttRouter = createTypedSubcommandRouter(
  {
    set: handleSttSet,
    clear: handleSttClear,
  },
  { logger, logPrefix: '[Voice/Stt]' }
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
    return;
  }
  if (group === 'stt') {
    await sttRouter(deferredCtx);
    return;
  }
  if (group === 'voices') {
    await voicesRouter(deferredCtx);
    return;
  }

  // No subcommand group → top-level subcommand (currently only `view`)
  const subcommand = context.getSubcommand();
  if (subcommand === 'view') {
    await handleVoiceView(deferredCtx);
    return;
  }

  logger.warn({ group, subcommand }, 'Unknown voice subcommand');
  await deferredCtx.editReply({
    content: renderSpec(CATALOG.error.validation('Unknown voice subcommand.')),
  });
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup();

  if (subcommandGroup === 'tts') {
    await handleTtsAutocomplete(interaction);
    return;
  }
  if (subcommandGroup === 'voices') {
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'voice') {
      await handleVoiceAutocomplete(interaction);
      return;
    }
  }

  // Top-level subcommands (e.g. /voice view) — only `character` is autocompleted.
  if (subcommandGroup === null) {
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'character') {
      await handlePersonalityAutocomplete(interaction, {
        optionName: 'character',
        ownedOnly: false,
        showVisibility: true,
        valueField: 'id',
      });
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

  if (isTtsOverrideInteraction(interaction.customId)) {
    await handleTtsBrowseButton(interaction);
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

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (isTtsOverrideInteraction(interaction.customId)) {
    await handleTtsBrowseSelect(interaction);
    return;
  }

  logger.debug({ customId: interaction.customId }, 'Unhandled select menu in voice command');
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Voice configuration: TTS + STT providers + cloned voices')
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('Show resolved TTS + STT + voices for a character')
        .addStringOption(option =>
          option
            .setName('character')
            .setDescription('Which character to inspect')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommandGroup(buildVoiceTtsSubcommandGroup)
    .addSubcommandGroup(buildVoiceSttSubcommandGroup)
    .addSubcommandGroup(buildVoiceVoicesSubcommandGroup),
  deferralMode: 'ephemeral',
  execute,
  autocomplete,
  handleButton,
  handleModal,
  handleSelectMenu,
  componentPrefixes: ['voice-voices', TTS_OVERRIDE_PREFIX],
});
