/**
 * Discord-cap ratchet for every settings dashboard: builds EVERY message of
 * EVERY settings dashboard with the real builders and the real exported
 * configs, collects each `custom_id` and select-option `value` from the built
 * payloads, and asserts each fits Discord's 100-char cap.
 *
 * The entityId is a 36-char lowercase UUID for all five dashboards. Compacted
 * it is 23 chars, longer than a snowflake (≤20) or `'global'`, so this is the
 * worst case for each dashboard.
 *
 * Ids are collected by walking the serialized payload for every `custom_id`
 * key, so a new component type is covered without editing this file. The
 * action-set assertion reddens when a builder call site stops being
 * exercised by the enumeration below.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  disableValidators,
  enableValidators,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { ADMIN_SETTINGS_CONFIG } from '../../../commands/admin/settings.js';
import { CHANNEL_SETTINGS_CONFIG } from '../../../commands/channel/settings.js';
import { CHARACTER_OVERRIDES_CONFIG } from '../../../commands/character/overrides.js';
import { CHARACTER_SETTINGS_CONFIG } from '../../../commands/character/settings.js';
import { USER_DEFAULTS_CONFIG } from '../../../commands/settings/defaults/edit.js';
import {
  type SettingDefinition,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateHandler,
  type SettingsResetHandler,
  DashboardView,
  buildSettingsCustomId,
  parseSettingsCustomId,
} from './types.js';
import { buildOverviewMessage, buildSettingMessage } from './SettingsDashboardBuilder.js';
import { buildIndexMessage } from './settingsIndexView.js';
import { buildSettingEditModal } from './SettingsModalFactory.js';
import { handleSettingsModal } from './settingsModalSubmit.js';
import { handleSettingsButton } from './SettingsDashboardHandler.js';

const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
}));

/** Discord's cap on a component custom_id. */
const DISCORD_CUSTOM_ID_MAX = 100;
/** Discord's cap on a select-menu option value. */
const DISCORD_SELECT_OPTION_VALUE_MAX = 100;

/** A 36-char lowercase personality UUID: the longest entityId any dashboard receives. */
const WORST_CASE_ENTITY_ID = '765a9b5a-857f-5822-bc60-37cc8aada4ac';

const USER_ID = '278863839632818186';

const DASHBOARDS: readonly SettingsDashboardConfig[] = [
  ADMIN_SETTINGS_CONFIG,
  CHARACTER_SETTINGS_CONFIG,
  CHARACTER_OVERRIDES_CONFIG,
  CHANNEL_SETTINGS_CONFIG,
  USER_DEFAULTS_CONFIG,
];

/** Every action token the enumeration must reach across the five dashboards. */
const EXPECTED_ACTIONS = [
  'back',
  'edit',
  'index',
  'jump',
  'modal',
  'page',
  'reset',
  'reset-cancel',
  'reset-confirm',
  'retry',
  'select',
  'set',
];

interface Collected {
  customIds: string[];
  optionValues: string[];
}

function makeSession(config: SettingsDashboardConfig): SettingsDashboardSession {
  return {
    level: config.level,
    entityId: WORST_CASE_ENTITY_ID,
    entityName: 'Ratchet Entity',
    data: {},
    view: DashboardView.OVERVIEW,
    page: 0,
    userId: USER_ID,
    messageId: 'message-1',
    channelId: 'channel-1',
    lastActivityAt: new Date(),
  };
}

/**
 * Walk a built payload for every `custom_id` and every select-option `value`.
 * JSON round-tripping runs each builder's own `toJSON`, so the walk sees the
 * exact wire shape Discord receives.
 */
function collectFrom(payload: unknown, out: Collected): void {
  walk(JSON.parse(JSON.stringify(payload)) as unknown, out);
}

function walk(node: unknown, out: Collected): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, out);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'custom_id' && typeof value === 'string') {
      out.customIds.push(value);
    }
    if (key === 'options' && Array.isArray(value)) {
      for (const option of value as unknown[]) {
        const optionValue = (option as { value?: unknown } | null)?.value;
        if (typeof optionValue === 'string') {
          out.optionValues.push(optionValue);
        }
      }
    }
    walk(value, out);
  }
}

function makeInteraction(customId: string, extra: Record<string, unknown> = {}): unknown {
  return {
    customId,
    user: { id: USER_ID },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

/** Components handed to a mocked responder (`followUp` / `editReply`). */
function componentsSentTo(responder: unknown): unknown[] {
  return vi
    .mocked(responder as (payload: { components?: unknown[] }) => unknown)
    .mock.calls.flatMap(([payload]) => payload.components ?? []);
}

/**
 * The Try-again row: no exported builder renders it, so drive the real modal
 * submit with an update handler that rejects. Every modal setting type reaches
 * the retry row either through its own parse error or the rejection.
 */
async function collectRetryRow(
  config: SettingsDashboardConfig,
  modalCustomId: string,
  out: Collected
): Promise<void> {
  const rejectingHandler = vi.fn<SettingUpdateHandler>().mockResolvedValue({
    success: false,
    error: 'rejected',
  });
  const interaction = makeInteraction(modalCustomId, {
    fields: { getTextInputValue: vi.fn(() => 'not-a-valid-value') },
  });
  await handleSettingsModal(interaction as ModalSubmitInteraction, config, rejectingHandler);
  const components = componentsSentTo((interaction as { followUp: unknown }).followUp);
  expect(components.length).toBeGreaterThan(0);
  collectFrom(components, out);
}

/** The reset confirmation: drive the real router's 'reset' action with a wired reset handler. */
async function collectResetConfirmation(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  out: Collected
): Promise<void> {
  const resetId = buildSettingsCustomId(config.entityType, 'reset', session.entityId);
  const interaction = makeInteraction(resetId);
  await handleSettingsButton(
    interaction as ButtonInteraction,
    config,
    vi.fn<SettingUpdateHandler>(),
    vi.fn<SettingsResetHandler>()
  );
  const components = componentsSentTo((interaction as { editReply: unknown }).editReply);
  expect(components.length).toBeGreaterThan(0);
  collectFrom(components, out);
}

/** Does this setting's drill-down render an Edit button (i.e. does it open a modal)? */
function drillDownOpensModal(drillDown: Collected, setting: SettingDefinition): boolean {
  return drillDown.customIds.some(id => {
    const parsed = parseSettingsCustomId(id);
    return parsed?.action === 'edit' && parsed.extra === setting.id;
  });
}

/** Build every message one dashboard can render and collect its ids and option values. */
async function collectDashboard(config: SettingsDashboardConfig): Promise<Collected> {
  const out: Collected = { customIds: [], optionValues: [] };
  const session = makeSession(config);
  mockSessionManager.get.mockImplementation(() => Promise.resolve({ data: makeSession(config) }));

  // Overview: every page (a flat config renders one overview)
  const pageCount = Math.max(config.pages?.length ?? 0, 1);
  for (let page = 0; page < pageCount; page++) {
    collectFrom(buildOverviewMessage(config, { ...session, page }), out);
  }

  // Index: paged configs only
  if ((config.pages?.length ?? 0) > 0) {
    collectFrom(buildIndexMessage(config, session), out);
  }

  // Drill-down for every setting, plus the modal and Try-again row where one exists
  for (const setting of config.settings) {
    const drillDown: Collected = { customIds: [], optionValues: [] };
    collectFrom(buildSettingMessage(config, session, setting), drillDown);
    out.customIds.push(...drillDown.customIds);
    out.optionValues.push(...drillDown.optionValues);

    if (drillDownOpensModal(drillDown, setting)) {
      const modal = buildSettingEditModal(config.entityType, session.entityId, setting, undefined);
      collectFrom(modal, out);
      await collectRetryRow(config, modal.toJSON().custom_id, out);
    }
  }

  // Reset confirmation: dashboards that opt into the reset affordance
  if (config.resetButton !== undefined) {
    await collectResetConfirmation(config, session, out);
  }

  return out;
}

async function collectAll(): Promise<Map<string, Collected>> {
  const byDashboard = new Map<string, Collected>();
  for (const config of DASHBOARDS) {
    byDashboard.set(config.entityType, await collectDashboard(config));
  }
  return byDashboard;
}

function overCap(values: string[], cap: number): string[] {
  return [...new Set(values)]
    .filter(value => value.length > cap)
    .map(value => `${value.length} chars: ${value}`);
}

describe('settings dashboard customId length ratchet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('builds every message of every dashboard with discord.js validators on', async () => {
    // Validators are on in production (setCustomId throws past 100 chars), so
    // this pass reddens on the same render the user would hit.
    await expect(collectAll()).resolves.toBeInstanceOf(Map);
  });

  describe('with validators off, so every offender is collected and named', () => {
    let byDashboard: Map<string, Collected>;
    let allCustomIds: string[];

    beforeAll(async () => {
      disableValidators();
      byDashboard = await collectAll();
      allCustomIds = [...byDashboard.values()].flatMap(collected => collected.customIds);
    });

    afterAll(() => {
      enableValidators();
    });

    it('every custom_id fits the Discord cap', () => {
      expect(overCap(allCustomIds, DISCORD_CUSTOM_ID_MAX)).toEqual([]);
    });

    it('every select-option value fits the Discord cap', () => {
      const allOptionValues = [...byDashboard.values()].flatMap(c => c.optionValues);
      expect(allOptionValues.length).toBeGreaterThan(0);
      expect(overCap(allOptionValues, DISCORD_SELECT_OPTION_VALUE_MAX)).toEqual([]);
    });

    it('covers all five dashboards', () => {
      expect([...byDashboard.keys()].sort()).toEqual(
        DASHBOARDS.map(config => config.entityType).sort()
      );
      for (const collected of byDashboard.values()) {
        expect(collected.customIds.length).toBeGreaterThan(0);
      }
    });

    it('contains the Share Chat History value button of both character dashboards', () => {
      for (const entityType of ['character-overrides', 'character-settings']) {
        expect(allCustomIds).toContain(
          buildSettingsCustomId(
            entityType,
            'set',
            WORST_CASE_ENTITY_ID,
            'shareHistoryAcrossPersonalities:guilds-only'
          )
        );
      }
    });

    it('reaches every builder action', () => {
      const actions = new Set(
        allCustomIds
          .map(id => parseSettingsCustomId(id)?.action)
          .filter((action): action is string => action !== undefined)
      );
      expect([...actions].sort()).toEqual(EXPECTED_ACTIONS);
    });
  });
});
