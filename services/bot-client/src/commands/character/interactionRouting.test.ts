/**
 * Tests for the character interaction routing (customId-prefix dispatch).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => ({}),
}));

const browse = {
  handleBrowsePagination: vi.fn(),
  handleBrowseSelect: vi.fn(),
  isCharacterBrowseInteraction: vi.fn(),
  isCharacterBrowseSelectInteraction: vi.fn(),
};
vi.mock('./browse.js', () => ({
  handleBrowsePagination: (...a: unknown[]) => browse.handleBrowsePagination(...a),
  handleBrowseSelect: (...a: unknown[]) => browse.handleBrowseSelect(...a),
  isCharacterBrowseInteraction: (id: string) => browse.isCharacterBrowseInteraction(id) as boolean,
  isCharacterBrowseSelectInteraction: (id: string) =>
    browse.isCharacterBrowseSelectInteraction(id) as boolean,
}));

const settings = {
  select: vi.fn(),
  button: vi.fn(),
  modal: vi.fn(),
  matches: vi.fn(),
};
vi.mock('./settings.js', () => ({
  handleCharacterSettingsSelectMenu: (...a: unknown[]) => settings.select(...a),
  handleCharacterSettingsButton: (...a: unknown[]) => settings.button(...a),
  handleCharacterSettingsModal: (...a: unknown[]) => settings.modal(...a),
  isCharacterSettingsInteraction: (id: string) => settings.matches(id) as boolean,
}));

const overrides = {
  select: vi.fn(),
  button: vi.fn(),
  modal: vi.fn(),
  matches: vi.fn(),
};
vi.mock('./overrides.js', () => ({
  handleCharacterOverridesSelectMenu: (...a: unknown[]) => overrides.select(...a),
  handleCharacterOverridesButton: (...a: unknown[]) => overrides.button(...a),
  handleCharacterOverridesModal: (...a: unknown[]) => overrides.modal(...a),
  isCharacterOverridesInteraction: (id: string) => overrides.matches(id) as boolean,
}));

const dashboard = {
  select: vi.fn(),
  button: vi.fn(),
  modal: vi.fn(),
};
vi.mock('./dashboard.js', () => ({
  handleSelectMenu: (...a: unknown[]) => dashboard.select(...a),
  handleButton: (...a: unknown[]) => dashboard.button(...a),
  handleModalSubmit: (...a: unknown[]) => dashboard.modal(...a),
}));

import {
  handleSelectMenu,
  handleButton,
  handleCharacterModal as handleModal,
} from './interactionRouting.js';

function interaction(customId: string): { customId: string } {
  return { customId };
}

describe('character interaction routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browse.isCharacterBrowseInteraction.mockReturnValue(false);
    browse.isCharacterBrowseSelectInteraction.mockReturnValue(false);
    settings.matches.mockReturnValue(false);
    overrides.matches.mockReturnValue(false);
  });

  it('routes browse-select ids to the browse handler, not the dashboard', async () => {
    browse.isCharacterBrowseSelectInteraction.mockReturnValue(true);

    await handleSelectMenu(interaction('char-browse::x') as StringSelectMenuInteraction);

    expect(browse.handleBrowseSelect).toHaveBeenCalled();
    expect(dashboard.select).not.toHaveBeenCalled();
  });

  it('routes settings ids to the settings dashboard for all three interaction kinds', async () => {
    settings.matches.mockReturnValue(true);

    await handleSelectMenu(interaction('character-settings::x') as StringSelectMenuInteraction);
    await handleButton(interaction('character-settings::x') as ButtonInteraction);
    await handleModal(interaction('character-settings::x') as ModalSubmitInteraction);

    expect(settings.select).toHaveBeenCalled();
    expect(settings.button).toHaveBeenCalled();
    expect(settings.modal).toHaveBeenCalled();
    expect(dashboard.select).not.toHaveBeenCalled();
  });

  it('routes overrides ids to the overrides dashboard', async () => {
    overrides.matches.mockReturnValue(true);

    await handleButton(interaction('character-overrides::x') as ButtonInteraction);

    expect(overrides.button).toHaveBeenCalled();
    expect(dashboard.button).not.toHaveBeenCalled();
  });

  it('falls through unmatched ids to the edit dashboard', async () => {
    await handleSelectMenu(interaction('char-edit::x') as StringSelectMenuInteraction);
    await handleButton(interaction('char-edit::x') as ButtonInteraction);
    await handleModal(interaction('char-edit::x') as ModalSubmitInteraction);

    expect(dashboard.select).toHaveBeenCalled();
    expect(dashboard.button).toHaveBeenCalled();
    expect(dashboard.modal).toHaveBeenCalled();
  });
});
