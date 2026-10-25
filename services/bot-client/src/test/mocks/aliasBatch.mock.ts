/**
 * Shared mocks and fixtures for character alias batch tests
 * (`aliasBatch.test.ts` and `aliasBatchConfirm.test.ts`).
 *
 * Centralizes the `UserClient` mock bundle, sample alias rows, gateway payload
 * builders, and button interaction / embed inspection factories so neither test
 * file imports the other across `vi.mock` hoisting boundaries.
 */

import { type Mock, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
// Local literal, not the aliasBatch.js export: that value import re-entered the tests' gatewayClients mock factory mid-eval and deadlocked vitest.
const BATCH_CONFIRM_PREFIX = 'character-alias::batch-confirm::';
import {
  buildRemoveCustomId,
  type BrowseCoords,
} from '../../commands/character/aliasBrowseView.js';
import type { AliasRow } from '../../commands/character/aliasData.js';

/**
 * Typed `vi.fn()` bundle matching the `UserClient` methods exercised by the
 * character alias batch flows.
 */
export interface MockUserClient {
  listPersonalityAliases: Mock;
  listMyAliases: Mock;
  addPersonalityAlias: Mock;
  removePersonalityAlias: Mock;
}

/**
 * Shared `UserClient` mock wired into `gatewayClients.js` via async `vi.mock`
 * factories in each test file.
 */
export const mockUserClient: MockUserClient = {
  listPersonalityAliases: vi.fn(),
  listMyAliases: vi.fn(),
  addPersonalityAlias: vi.fn(),
  removePersonalityAlias: vi.fn(),
};

/** Fixed ISO timestamp for deterministic alias payload fixtures. */
export const CREATED_AT = '2026-07-18T00:00:00.000Z';

/** Default browse coordinates (page 0, all scopes, my-aliases mode). */
export const DEFAULT_COORDS: BrowseCoords = {
  page: 0,
  filter: 'all',
  query: null,
};

/**
 * Build a normalized `AliasRow` fixture with sensible defaults.
 *
 * @param overrides - Required `alias` plus optional `scope`, `character`, and `shadowed` overrides
 * @returns Normalized `AliasRow`
 */
export function makeAliasRow(overrides: Partial<AliasRow> & { alias: string }): AliasRow {
  return {
    alias: overrides.alias,
    scope: overrides.scope ?? 'user',
    character: overrides.character ?? { name: 'Lilith', slug: 'lilith' },
    shadowed: overrides.shadowed ?? false,
  };
}

/** Five representative alias rows spanning user and global scopes across three characters. */
export const FIVE_ROWS: AliasRow[] = [
  makeAliasRow({
    alias: 'mommy',
    scope: 'user',
    character: { name: 'Lilith', slug: 'lilith' },
  }),
  makeAliasRow({
    alias: 'lila',
    scope: 'global',
    character: { name: 'Lila Elyona', slug: 'lila-elyona' },
  }),
  makeAliasRow({
    alias: 'queen',
    scope: 'user',
    character: { name: 'Lilith', slug: 'lilith' },
  }),
  makeAliasRow({
    alias: 'boss',
    scope: 'global',
    character: { name: 'Nyx', slug: 'nyx' },
  }),
  makeAliasRow({
    alias: 'star',
    scope: 'user',
    character: { name: 'Lila Elyona', slug: 'lila-elyona' },
  }),
];

/**
 * Build a gateway envelope for `userClient.listMyAliases()`.
 *
 * @param rows - Normalized alias rows to wrap
 * @param truncated - Whether the server-side list was truncated
 * @returns Gateway `ok: true` response envelope
 */
export function myAliasesPayload(rows: AliasRow[], truncated = false): unknown {
  return {
    ok: true,
    data: {
      aliases: rows.map(row => ({
        alias: row.alias,
        scope: row.scope,
        personality: {
          id: 'p-1',
          name: row.character.name ?? row.character.slug,
          slug: row.character.slug,
        },
        shadowed: row.shadowed,
        createdAt: CREATED_AT,
      })),
      truncated,
    },
  };
}

/**
 * Build a gateway envelope for `userClient.listPersonalityAliases(slug)`.
 *
 * @param rows - Normalized alias rows to wrap
 * @param truncated - Whether the server-side list was truncated
 * @returns Gateway `ok: true` response envelope
 */
export function characterAliasesPayload(rows: AliasRow[], truncated = false): unknown {
  return {
    ok: true,
    data: {
      aliases: rows.map(row => ({
        alias: row.alias,
        scope: row.scope,
        createdAt: CREATED_AT,
      })),
      truncated,
    },
  };
}

/** Minimal serialized embed shape inspected by alias batch tests. */
export interface EmbedData {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
}

/** Minimal `interaction.editReply` payload shape inspected by alias batch tests. */
export interface EditReplyPayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

/**
 * Extract the last `interaction.editReply` call's payload.
 *
 * @param interaction - Mock interaction whose `editReply` spy was called
 * @returns Last payload passed to `editReply`, or an empty object
 */
export function editReplyPayload(interaction: unknown): EditReplyPayload {
  const calls = (interaction as { editReply: { mock: { calls: unknown[][] } } }).editReply.mock
    .calls;
  return calls[calls.length - 1]?.[0] ?? {};
}

/**
 * Normalize an `EmbedBuilder`, `{ data }`, or plain embed object into `EmbedData`.
 *
 * @param embed - Raw embed item from an `editReply` payload
 * @returns Plain `EmbedData` object
 */
export function toEmbedData(embed: unknown): EmbedData {
  if (typeof embed === 'object' && embed !== null && 'toJSON' in embed) {
    return (embed as { toJSON: () => EmbedData }).toJSON();
  }
  if (typeof embed === 'object' && embed !== null && 'data' in embed) {
    return (embed as { data: EmbedData }).data;
  }
  return embed as EmbedData;
}

/**
 * Extract and normalize all embeds from the last `interaction.editReply` call.
 *
 * @param interaction - Mock interaction whose `editReply` spy was called
 * @returns Normalized `EmbedData` array
 */
export function editReplyEmbeds(interaction: unknown): EmbedData[] {
  return (editReplyPayload(interaction).embeds ?? []).map(toEmbedData);
}

/**
 * Create a mock Discord `ButtonInteraction` for alias batch button handlers.
 *
 * @param options - Optional `customId`, embed `footerText`, and `deferred` state
 * @returns Mock `ButtonInteraction`
 */
export function createButtonInteraction(options: {
  customId?: string;
  footerText?: string;
  deferred?: boolean;
}): ButtonInteraction {
  return {
    user: { id: 'user-1' },
    customId:
      options.customId ??
      buildRemoveCustomId(
        BATCH_CONFIRM_PREFIX,
        DEFAULT_COORDS.page,
        DEFAULT_COORDS.filter,
        DEFAULT_COORDS.query
      ),
    message: {
      id: 'message-1',
      embeds: options.footerText === undefined ? [] : [{ footer: { text: options.footerText } }],
      components: [],
    },
    deferred: options.deferred ?? false,
    replied: false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}
