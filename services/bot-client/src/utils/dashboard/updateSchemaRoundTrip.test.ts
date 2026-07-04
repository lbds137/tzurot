/**
 * Round-trip contract guard for fetch-edit-PUT dashboards.
 *
 * The bug class this guards against: a dashboard fetches an object, lets the user
 * edit one section, then PUTs back fields it didn't change — including nullable
 * fields fetched as `null`. If the gateway's update schema declares such a field
 * `z.string().optional()` (which accepts `undefined` but REJECTS `null`), the
 * round-trip 400s. The confirmed instance was personality `avatarData`: the
 * dashboard force-nulls it (it fetches only `hasAvatar`, never the base64), so
 * every no-avatar character's section save was rejected with "expected string,
 * received null" — masked behind a generic "Failed to update character."
 *
 * **Every fetch-edit-PUT dashboard MUST register in `DASHBOARDS` below.** Each
 * entry runs a realistic null-bearing fetched object through the dashboard's REAL
 * payload builder and asserts the result validates against the gateway's update
 * schema. A dashboard whose schema rejects a round-tripped null fails here —
 * which is the point: it catches the avatarData class for current and future
 * dashboards before it ships.
 *
 * Why a builder round-trip and not a schema-pairing check: the offending null is
 * injected by the bot-client payload builder (`toCharacterData` force-nulls
 * `avatarData`), not present in the gateway response schema. A "every nullable
 * response field is nullable in the update schema" check would not see it. The
 * guard must exercise the builder.
 */

import { describe, it, expect } from 'vitest';
import { LlmConfigUpdateSchema } from '@tzurot/common-types/schemas/api/llm-config';
import { PersonaUpdateSchema } from '@tzurot/common-types/schemas/api/persona';
import { PersonalityUpdateSchema } from '@tzurot/common-types/schemas/api/personality';
import { toCharacterData, omitEmptyRequiredText } from '../../commands/character/api.js';
import { flattenPersonaData, unflattenPersonaData } from '../../commands/persona/config.js';
import { flattenPresetData, unflattenPresetData } from '../../commands/preset/config.js';
import type { PersonaDetails } from '../../commands/persona/types.js';
import type { PresetData } from '../../commands/preset/types.js';

/** Structural shape of a Zod schema's safeParse — avoids a direct `zod` dep here. */
interface ParseableSchema {
  safeParse(data: unknown): { success: boolean; error?: { issues: unknown[] } };
}

interface DashboardRoundTrip {
  /** Dashboard name (used for the test label). */
  name: string;
  /** Build the update payload the way the dashboard does, from a null-bearing fetched object. */
  buildPayload: () => unknown;
  /** The gateway update schema the payload is PUT against. */
  updateSchema: ParseableSchema;
}

// A realistic established character: required text filled in, every optional and
// media field null — the exact shape that 400'd on `avatarData` before the fix.
const characterDetailWithNulls = {
  id: 'pers-1',
  name: 'Helen',
  slug: 'helen',
  displayName: null,
  characterInfo: 'A detective who notices everything.',
  personalityTraits: 'Sharp, dry, observant.',
  personalityTone: null,
  personalityAge: null,
  personalityAppearance: null,
  personalityLikes: null,
  personalityDislikes: null,
  conversationalGoals: null,
  conversationalExamples: null,
  errorMessage: null,
  isPublic: false,
  voiceEnabled: false,
  // The gateway response carries `hasAvatar`, not the base64 — `toCharacterData`
  // force-nulls `avatarData` regardless, so `false` here mirrors a real no-avatar
  // detail without changing the round-tripped null.
  hasAvatar: false,
};

// A legacy character predating the `min(1)` create constraint: its required text
// fields come back null. `toCharacterData` coerces them to `''`, which the update
// schema's `z.string().min(1)` rejects on a full-session round-trip — so
// `omitEmptyRequiredText` must drop them for the section save to go through.
const characterDetailEmptyText = {
  ...characterDetailWithNulls,
  characterInfo: null,
  personalityTraits: null,
};

const personaDetailWithNulls: PersonaDetails = {
  id: 'persona-1',
  name: 'Vee',
  content: 'A traveler with a long memory.',
  preferredName: null,
  description: null,
  pronouns: null,
  isDefault: false,
};

const presetDetailWithNulls: PresetData = {
  id: 'preset-1',
  name: 'Test Preset',
  description: null,
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  isGlobal: false,
  isOwned: true,
  permissions: { canEdit: true, canDelete: true },
  contextWindowTokens: 8192,
  params: {},
};

const DASHBOARDS: DashboardRoundTrip[] = [
  {
    name: 'character',
    // Models the real PUT path: toCharacterData → omitEmptyRequiredText (what
    // updateCharacter sends). A no-op on this non-empty fixture, but keeps the
    // model faithful so the avatarData-null guard stays accurate.
    buildPayload: () => omitEmptyRequiredText(toCharacterData(characterDetailWithNulls)),
    updateSchema: PersonalityUpdateSchema,
  },
  {
    name: 'character (legacy empty required text)',
    buildPayload: () => omitEmptyRequiredText(toCharacterData(characterDetailEmptyText)),
    updateSchema: PersonalityUpdateSchema,
  },
  {
    name: 'persona',
    buildPayload: () => unflattenPersonaData(flattenPersonaData(personaDetailWithNulls)),
    updateSchema: PersonaUpdateSchema,
  },
  {
    name: 'preset',
    buildPayload: () => unflattenPresetData(flattenPresetData(presetDetailWithNulls)),
    updateSchema: LlmConfigUpdateSchema,
  },
];

describe('dashboard update round-trip contract', () => {
  it.each(DASHBOARDS)(
    '$name: a null-bearing fetched object round-trips into a valid update payload',
    ({ buildPayload, updateSchema }) => {
      const payload = buildPayload();
      const result = updateSchema.safeParse(payload);
      // Surface the Zod issues so a regression points straight at the offending
      // field (e.g. "avatarData: expected string, received null").
      expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
    }
  );
});
