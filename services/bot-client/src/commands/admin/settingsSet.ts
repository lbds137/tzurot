/**
 * /admin settings set — direct system-settings setter (admin-runtime-settings PR 1).
 *
 * The slash setter with autocomplete is the PRIMARY write path for model-valued
 * settings (modals cannot autocomplete, and long model ids are typo-prone on
 * mobile). All validation authority lives in the gateway route — this handler
 * only coerces the string option to the setting's control type and renders the
 * gateway's verdict (validation errors name the reason; warnings and the
 * restart-liveness banner pass through).
 */

import type { AutocompleteInteraction } from 'discord.js';
import {
  SYSTEM_SETTINGS_KEYS,
  SYSTEM_SETTINGS_REGISTRY,
  type SystemSettings,
  type SystemSettingMeta,
} from '@tzurot/common-types/schemas/api/systemSettings';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  fetchTextModels,
  fetchVisionModels,
  formatModelChoice,
} from '../../utils/modelAutocomplete.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('AdminSettingsSet');

type CoercionResult =
  { ok: true; value: SystemSettings[keyof SystemSettings] } | { ok: false; error: string };

/** Coerce the raw string option to the setting's control type. */
function coerceValue(meta: SystemSettingMeta, raw: string): CoercionResult {
  switch (meta.control) {
    case 'boolean': {
      const lowered = raw.trim().toLowerCase();
      if (lowered === 'true') {
        return { ok: true, value: true };
      }
      if (lowered === 'false') {
        return { ok: true, value: false };
      }
      return { ok: false, error: `\`${meta.key}\` expects \`true\` or \`false\`` };
    }
    case 'integer': {
      // Integer-literal gate before Number(): a bare Number() coerces '' and
      // whitespace to 0 (which would happily write a zero budget) and accepts
      // scientific/hex notation ('1e3', '0x10') that reads as a typo here.
      const trimmed = raw.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        return { ok: false, error: `\`${meta.key}\` expects an integer` };
      }
      const parsed = Number(trimmed);
      if (!Number.isSafeInteger(parsed)) {
        return { ok: false, error: `\`${meta.key}\` expects an integer` };
      }
      return { ok: true, value: parsed as SystemSettings[keyof SystemSettings] };
    }
    case 'enum': {
      const choice = raw.trim();
      if (meta.choices !== undefined && !meta.choices.includes(choice)) {
        return {
          ok: false,
          error: `\`${meta.key}\` expects one of: ${meta.choices.map(c => `\`${c}\``).join(', ')}`,
        };
      }
      return { ok: true, value: choice as SystemSettings[keyof SystemSettings] };
    }
    case 'model':
      return { ok: true, value: raw.trim() as SystemSettings[keyof SystemSettings] };
  }
}

/** Render a stored value for display; absent keys show as the seeded/fallback state. */
function displayValue(value: unknown): string {
  if (value === undefined) {
    return '_(unset — serving seed/fallback)_';
  }
  // Settings values are JSON scalars; stringify guards the object edge without
  // ever rendering '[object Object]'.
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `\`${String(value)}\``;
  }
  return `\`${JSON.stringify(value)}\``;
}

/**
 * /admin settings set <setting> <value>
 */
export async function handleSettingsSet(context: DeferredCommandContext): Promise<void> {
  const settingKey = context.interaction.options.getString('setting', true);
  const rawValue = context.interaction.options.getString('value', true);

  const meta =
    settingKey in SYSTEM_SETTINGS_REGISTRY
      ? SYSTEM_SETTINGS_REGISTRY[settingKey as keyof SystemSettings]
      : undefined;
  if (meta === undefined) {
    await context.editReply({
      content: `❌ Unknown setting \`${settingKey}\`. Pick one from the autocomplete list.`,
    });
    return;
  }

  const coerced = coerceValue(meta, rawValue);
  if (!coerced.ok) {
    await context.editReply({ content: `❌ ${coerced.error}` });
    return;
  }

  const { ownerClient } = clientsFor(context.interaction);

  const current = await ownerClient.getSystemSettings();
  if (!current.ok) {
    logger.warn({ error: current.error, settingKey }, 'System settings read failed');
    await context.editReply({ content: `❌ Could not read current settings: ${current.error}` });
    return;
  }
  const oldValue = (current.data.systemSettings as Record<string, unknown>)[settingKey];

  const result = await ownerClient.updateSystemSettings({
    expectedUpdatedAt: current.data.updatedAt,
    patch: { [settingKey]: coerced.value },
  });

  if (!result.ok) {
    logger.warn({ error: result.error, settingKey }, 'System settings write rejected');
    const conflictHint =
      result.status === 409 ? ' Someone else edited settings — re-run the command.' : '';
    await context.editReply({ content: `❌ ${result.error}${conflictHint}` });
    return;
  }

  const lines = [
    `✅ **${meta.label}** updated: ${displayValue(oldValue)} → \`${String(coerced.value)}\``,
  ];
  for (const warning of result.data.warnings) {
    lines.push(`⚠️ ${warning}`);
  }
  if (meta.liveness === 'restart') {
    lines.push('🔄 Saved — takes effect on the next deploy/restart.');
  }
  await context.editReply({ content: lines.join('\n') });
}

/** Autocomplete for the `setting` option: registry keys filtered by query. */
export async function handleSettingNameAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  const lowered = query.toLowerCase();
  const choices = SYSTEM_SETTINGS_KEYS.filter(key => {
    const meta = SYSTEM_SETTINGS_REGISTRY[key];
    return key.toLowerCase().includes(lowered) || meta.label.toLowerCase().includes(lowered);
  })
    .map(key => ({ name: `${SYSTEM_SETTINGS_REGISTRY[key].label} — ${key}`, value: key }))
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);
  await interaction.respond(choices);
}

/**
 * Autocomplete for the `value` option, shaped by the selected setting's
 * control type: booleans/enums offer their literal choices; model fields
 * offer the slot's catalog (aliases first — they're the recommended floors).
 */
export async function handleSettingValueAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  const settingKey = interaction.options.getString('setting');
  const meta =
    settingKey !== null && settingKey in SYSTEM_SETTINGS_REGISTRY
      ? SYSTEM_SETTINGS_REGISTRY[settingKey as keyof SystemSettings]
      : undefined;
  if (meta === undefined) {
    await interaction.respond([]);
    return;
  }

  if (meta.control === 'boolean') {
    await interaction.respond([
      { name: 'true', value: 'true' },
      { name: 'false', value: 'false' },
    ]);
    return;
  }

  if (meta.control === 'enum') {
    await interaction.respond(
      (meta.choices ?? []).map(choice => ({ name: choice, value: choice }))
    );
    return;
  }

  if (meta.control === 'model' && meta.model !== undefined) {
    const lowered = query.toLowerCase();
    const aliasChoices = meta.model.aliasAllowlist
      .filter(alias => alias.includes(lowered))
      .map(alias => ({ name: `⭐ ${alias} (router alias)`, value: alias }));
    const models =
      meta.model.slot === 'vision' ? await fetchVisionModels(query) : await fetchTextModels(query);
    const choices = [...aliasChoices, ...models.map(formatModelChoice)].slice(
      0,
      DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES
    );
    await interaction.respond(choices);
    return;
  }

  // Integers: free text, no suggestions.
  await interaction.respond([]);
}
