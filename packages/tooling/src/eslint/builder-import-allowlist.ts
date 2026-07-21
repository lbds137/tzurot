/**
 * Grandfathered discord.js builder VALUE-imports in bot-client command files —
 * the shrink-only allowlist behind `@tzurot/no-discord-builders-in-commands`.
 *
 * Contract:
 *   - An entry permits a command file to keep importing exactly the listed
 *     builder symbols as VALUES (type-only imports are always allowed and are
 *     not tracked here).
 *   - SHRINK-ONLY: entries are removed as files migrate onto the shared ux/
 *     builders (listEmbedBuilder, buildEntityDetailCard, ModalFactory/toolkit,
 *     confirmation factories). Adding an entry — or a new symbol to an existing
 *     entry — means new hand-built Discord UI outside the design system; extend
 *     the shared builders instead. The colocated test pins the ceiling so
 *     growth fails loudly.
 *   - Paths are repo-relative with forward slashes; the rule matches them as
 *     suffixes of the linted file's normalized absolute path, so the check is
 *     cwd-independent (lint-staged runs eslint from varying cwds).
 *
 * `SlashCommandBuilder`/`ContextMenuCommandBuilder` are NOT restricted —
 * command DEFINITIONS legitimately live in command files. The restricted set
 * is the message-UI builders (embeds, action rows, buttons, selects, modals,
 * Components-V2 primitives).
 */

export const BUILDER_IMPORT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'services/bot-client/src/commands/admin/broadcast.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/admin/db-sync.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/admin/health.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/admin/metrics.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/admin/servers.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/channel/browse.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/character/browse.ts': ['ActionRowBuilder', 'ButtonBuilder'],
  'services/bot-client/src/commands/character/import.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/character/view.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/character/viewV2.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'ContainerBuilder',
    'SectionBuilder',
    'SeparatorBuilder',
    'TextDisplayBuilder',
    'ThumbnailBuilder',
  ],
  'services/bot-client/src/commands/deny/detailTypes.ts': ['ActionRowBuilder', 'ButtonBuilder'],
  'services/bot-client/src/commands/feedback/index.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/help/index.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/inspect/browse.ts': ['ActionRowBuilder', 'ButtonBuilder'],
  'services/bot-client/src/commands/inspect/components.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'StringSelectMenuBuilder',
  ],
  'services/bot-client/src/commands/inspect/embed.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/inspect/extendedViews.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/inspect/memoryInspectorState.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
  ],
  'services/bot-client/src/commands/inspect/views.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/memory/detail.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/memory/detailModals.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/memory/factsDetail.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/models/card.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/persona/view.ts': ['ActionRowBuilder', 'ButtonBuilder'],
  'services/bot-client/src/commands/preset/global/globalPresetHelpers.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/preset/import.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/preset/override/clear-default.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/preset/override/guestModeValidation.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/preset/override/set-default.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/preset/override/set.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/settings/apikey/modal.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/settings/apikey/remove.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/settings/apikey/test.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/settings/data/export.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/shapes/auth.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/shapes/detail.ts': ['ActionRowBuilder', 'ButtonBuilder'],
  'services/bot-client/src/commands/shapes/detailHandlers.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/shapes/errorRecovery.ts': ['ActionRowBuilder', 'ButtonBuilder'],
  'services/bot-client/src/commands/shapes/export.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/shapes/import.ts': [
    'ActionRowBuilder',
    'ButtonBuilder',
    'EmbedBuilder',
  ],
  'services/bot-client/src/commands/shapes/logout.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/shapes/modal.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/shapes/status.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/stt/clear.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/stt/set.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/tts/clear-default.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/tts/guestModeValidation.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/tts/set-default.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/tts/set.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/voices/purge.ts': ['EmbedBuilder'],
  'services/bot-client/src/commands/voice/voices/delete.ts': ['EmbedBuilder'],
};

/** Total (file, symbol) pairs — the shrink-only ceiling pinned by the test. */
export function allowlistPairCount(): number {
  return Object.values(BUILDER_IMPORT_ALLOWLIST).reduce((sum, syms) => sum + syms.length, 0);
}
