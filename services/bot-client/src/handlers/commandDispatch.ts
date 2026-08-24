/**
 * Chat-input (slash) command dispatch.
 *
 * Owns the whole path between "Discord delivered a chat-input interaction"
 * and "the command's execute() ran":
 *   1. resolve the effective deferral mode (command default, possibly
 *      overridden per-subcommand; unset means 'ephemeral'),
 *   2. ack accordingly (deferReply for the deferred modes, nothing for
 *      'modal'/'none') and build the matching SafeCommandContext,
 *   3. call execute(), and
 *   4. deliver the top-level error UX when execute() throws — `replySpecSafe`
 *      fills the deferral placeholder via editReply when the interaction is
 *      deferred-but-unreplied, and replies ephemerally when it is unacked.
 *
 * Step 4 is the reason this is a module and not inline wiring: without it a
 * throwing command strands the "Thinking…" placeholder forever.
 */

import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { CATALOG } from '../ux/catalog/catalog.js';
import { replySpecSafe, topLevelErrorSpec } from '../ux/render/reply.js';
import type { Command } from '../types.js';
import {
  createDeferredContext,
  createModalContext,
  createManualContext,
  type DeferralMode,
} from '../utils/commandContext/index.js';
import {
  runWithOutcomeSlot,
  type CommandOutcomeSlot,
} from '../observability/commandOutcomeSlot.js';
import { emitCommandEvent } from '../observability/emitCommandEvent.js';
import {
  classifyChannelKind,
  classifyErrorCode,
} from '../observability/commandTelemetryClassify.js';
import type { RecordCommandEventRequest } from '../observability/recordCommandEvent.js';

const logger = createLogger('CommandDispatch');

/**
 * Get the subcommand path for looking up deferral mode overrides.
 * Returns 'group subcommand' for subcommand groups, or just 'subcommand' for simple subcommands.
 *
 * Also feeds the command-telemetry dotted path (see `buildCommandPath`) —
 * the same subcommand resolution, joined with '.' instead of ' '.
 */
function getSubcommandPath(interaction: ChatInputCommandInteraction): string | null {
  try {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (group !== null && subcommand !== null) {
      return `${group} ${subcommand}`;
    }
    return subcommand;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective deferral mode for a command/subcommand.
 *
 * Checks subcommandDeferralModes for overrides, falls back to deferralMode,
 * and finally to 'ephemeral' when the command declares none.
 */
export function resolveEffectiveDeferralMode(
  command: Command,
  interaction: ChatInputCommandInteraction
): DeferralMode {
  const defaultMode = command.deferralMode ?? 'ephemeral';

  // Check for subcommand-level override
  if (command.subcommandDeferralModes !== undefined) {
    const subcommandPath = getSubcommandPath(interaction);
    if (subcommandPath !== null && subcommandPath in command.subcommandDeferralModes) {
      return command.subcommandDeferralModes[subcommandPath];
    }
  }

  return defaultMode;
}

/** Dotted command path for telemetry, e.g. "character.create" or
 *  "memory.batch.delete" (group + subcommand). Mirrors
 *  `resolveEffectiveDeferralMode`'s space-joined path, dot-joined instead. */
function buildCommandPath(interaction: ChatInputCommandInteraction): string {
  const subcommandPath = getSubcommandPath(interaction);
  if (subcommandPath === null) {
    return interaction.commandName;
  }
  return [interaction.commandName, ...subcommandPath.split(' ')].join('.');
}

/** Internal sentinel for the failed-defer path — thrown so the telemetry
 *  emission after the try/catch can be skipped without a second flag. */
class DeferFailedError extends Error {}

/**
 * Handle a command using the typed context pattern.
 *
 * Commands declare their deferralMode via defineCommand(), and receive a
 * SafeCommandContext that doesn't expose deferReply() (for deferred modes),
 * preventing InteractionAlreadyReplied errors at compile time.
 *
 * For commands with mixed subcommand requirements, subcommandDeferralModes
 * allows per-subcommand overrides of the default deferral behavior.
 */
export async function handleCommandWithContext(
  interaction: ChatInputCommandInteraction,
  command: Command | undefined
): Promise<void> {
  // Reachable only via a stale registration (Discord offering a command the
  // bot no longer loads) — ack it anyway so the user sees a reply instead of
  // Discord's "This interaction failed".
  if (command === undefined) {
    logger.warn({ commandName: interaction.commandName }, 'Unknown command');
    await interaction.reply({ content: 'Unknown command!', flags: MessageFlags.Ephemeral });
    return;
  }

  // Resolve effective deferral mode (may be overridden per-subcommand)
  const effectiveMode = resolveEffectiveDeferralMode(command, interaction);

  // Started AFTER the unknown-command early return above, so that path stays
  // untimed and unemitted (there is no command to attribute an event to).
  const startedAt = Date.now();
  const slot: CommandOutcomeSlot = {};

  try {
    await runWithOutcomeSlot(slot, async () => {
      switch (effectiveMode) {
        case 'ephemeral':
        case 'public': {
          // Defer appropriately
          const isEphemeral = effectiveMode === 'ephemeral';
          try {
            await interaction.deferReply({
              flags: isEphemeral ? MessageFlags.Ephemeral : undefined,
            });
          } catch (deferError) {
            // A failed defer leaves nothing to reply to — log and bail out
            // WITHOUT attempting the error UX below. Thrown as the sentinel
            // rather than returned, because a plain return from inside the
            // ALS callback would fall through to the telemetry emission: this
            // path ran no command and has no live interaction to attribute an
            // event to. Pinned by the "emits nothing when the defer fails"
            // test in the colocated spec.
            logger.error(
              { err: deferError, command: interaction.commandName },
              'Failed to defer interaction'
            );
            throw new DeferFailedError();
          }
          // Create typed context (no deferReply method!)
          await command.execute(createDeferredContext(interaction, isEphemeral));
          break;
        }

        case 'modal': {
          // Don't defer - command will show modal
          await command.execute(createModalContext(interaction));
          break;
        }

        case 'none': {
          // Don't defer - command handles timing itself
          await command.execute(createManualContext(interaction));
          break;
        }
      }
    });
  } catch (error) {
    if (error instanceof DeferFailedError) {
      // Already logged above; no event emitted (see the throw site).
      return;
    }
    logger.error({ err: error, commandName: interaction.commandName }, 'Error executing command');
    slot.outcome = 'system_error';
    slot.errorCode = classifyErrorCode(error);
    await replySpecSafe(interaction, topLevelErrorSpec(error, CATALOG.error.commandFailed()), {
      logContext: { commandName: interaction.commandName },
    });
  }

  const event: RecordCommandEventRequest = {
    userId: interaction.user.id,
    ...(interaction.guildId !== null ? { guildId: interaction.guildId } : {}),
    channelKind: classifyChannelKind(interaction),
    command: buildCommandPath(interaction),
    // characterId omitted: resolving the personality at the dispatch layer
    // needs context individual commands don't uniformly expose; the column
    // is nullable by design.
    outcome: slot.outcome ?? 'ok',
    ...(slot.errorCode !== undefined ? { errorCode: slot.errorCode } : {}),
    latencyMs: Date.now() - startedAt,
    // context omitted: bot-client has nothing to put here yet; the
    // gateway-side allowlist is the guard for when it does.
  };
  emitCommandEvent(event);
}
