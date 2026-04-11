/**
 * Settings Command Handler Factory
 *
 * Generates the three interaction routers (select menu, button, modal) plus an
 * `isInteraction` guard for any entity-ID-based settings dashboard. Collapses
 * the ~19-line router pattern previously duplicated across:
 *
 *   - commands/character/overrides.ts
 *   - commands/character/settings.ts
 *   - commands/channel/settings.ts
 *
 * Each dashboard file supplies its own `entityType`, `settingsConfig`, and a
 * `createUpdateHandler(entityId)` factory that binds the entity ID into a
 * per-interaction `SettingUpdateHandler`. The returned handlers preserve the
 * same public signatures the call sites previously exported by hand, so each
 * file can re-export `handlers.handleButton` etc. under its existing names
 * without touching any downstream import (e.g., `commands/character/index.ts`).
 *
 * Stateless dashboards (e.g., `admin/settings.ts`, `settings/defaults/edit.ts`)
 * have 3-line routers that don't parse entity IDs and are intentionally not
 * served by this factory — the abstraction wouldn't match their shape.
 *
 * @see CPD Zero Roadmap Session 1 — plan humming-singing-barto.md
 */

import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  type SettingsDashboardConfig,
  type SettingUpdateHandler,
  isSettingsInteraction,
  parseSettingsCustomId,
} from './types.js';
import {
  handleSettingsButton,
  handleSettingsModal,
  handleSettingsSelectMenu,
} from './SettingsDashboardHandler.js';

/**
 * Options for building a set of entity-ID-based settings command handlers.
 */
export interface SettingsCommandHandlerOptions {
  /**
   * Entity type used for custom ID prefix matching (e.g., `'character-settings'`).
   * Must match the `entityType` on the provided `settingsConfig`.
   */
  entityType: string;
  /**
   * Dashboard configuration forwarded verbatim to the underlying handlers.
   */
  settingsConfig: SettingsDashboardConfig;
  /**
   * Build a per-interaction `SettingUpdateHandler` bound to a specific entity ID.
   * Called once per interaction with the entity ID extracted from the custom ID.
   */
  createUpdateHandler: (entityId: string) => SettingUpdateHandler;
}

/**
 * The four functions each dashboard file used to declare by hand: the three
 * interaction routers plus a customId guard.
 */
export interface SettingsCommandHandlers {
  handleSelectMenu: (interaction: StringSelectMenuInteraction) => Promise<void>;
  handleButton: (interaction: ButtonInteraction) => Promise<void>;
  handleModal: (interaction: ModalSubmitInteraction) => Promise<void>;
  isInteraction: (customId: string) => boolean;
}

/**
 * Create the bundle of interaction handlers for an entity-ID-based settings
 * dashboard. See `SettingsCommandHandlerOptions` for the contract.
 */
export function createSettingsCommandHandlers(
  options: SettingsCommandHandlerOptions
): SettingsCommandHandlers {
  const { entityType, settingsConfig, createUpdateHandler } = options;

  /**
   * Extract the entity ID from an interaction's custom ID. Returns null if the
   * custom ID doesn't belong to this dashboard OR if parsing fails.
   */
  const extractEntityId = (customId: string): string | null => {
    if (!isSettingsInteraction(customId, entityType)) {
      return null;
    }
    const parsed = parseSettingsCustomId(customId);
    return parsed?.entityId ?? null;
  };

  return {
    handleSelectMenu: async interaction => {
      const entityId = extractEntityId(interaction.customId);
      if (entityId === null) {
        return;
      }
      await handleSettingsSelectMenu(interaction, settingsConfig, createUpdateHandler(entityId));
    },

    handleButton: async interaction => {
      const entityId = extractEntityId(interaction.customId);
      if (entityId === null) {
        return;
      }
      await handleSettingsButton(interaction, settingsConfig, createUpdateHandler(entityId));
    },

    handleModal: async interaction => {
      const entityId = extractEntityId(interaction.customId);
      if (entityId === null) {
        return;
      }
      await handleSettingsModal(interaction, settingsConfig, createUpdateHandler(entityId));
    },

    isInteraction: customId => isSettingsInteraction(customId, entityType),
  };
}
