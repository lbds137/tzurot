/**
 * The ordered interaction-family table shared by the foreign-interaction
 * classifier (`foreignInteraction.ts`) and the router dispatch
 * (`handlers/interactionRouter.ts`).
 *
 * discord.js exposes one type guard per interaction family and both call
 * sites need the same enumeration, so the guards and labels live here once,
 * in classification order. Order only matters for a synthetic mock that
 * reports more than one guard true (pinned for chat-input-before-modal by
 * the guard-order test in `./foreignInteraction.test.ts`); that a real
 * interaction matches exactly one guard is not independently verified
 * against discord.js internals — nothing depends on it, because an
 * unmatched interaction falls through to 'unknown' in the classifier and to
 * no dispatch in the router.
 */

import type { BaseInteraction } from 'discord.js';

/** One recognized interaction family, in classification order. */
export interface InteractionFamily {
  /** discord.js's own type guard for this family */
  guard: (interaction: BaseInteraction) => boolean;
  /** Label logged in the drop log's `interactionType` field */
  label: string;
  /** The family's interaction exposes a parseable `customId` command prefix */
  carriesCustomId: boolean;
}

export const INTERACTION_FAMILIES: readonly InteractionFamily[] = [
  { guard: i => i.isChatInputCommand(), label: 'chat_input', carriesCustomId: false },
  {
    guard: i => i.isMessageContextMenuCommand(),
    label: 'message_context_menu',
    carriesCustomId: false,
  },
  { guard: i => i.isModalSubmit(), label: 'modal_submit', carriesCustomId: true },
  { guard: i => i.isAutocomplete(), label: 'autocomplete', carriesCustomId: false },
  { guard: i => i.isStringSelectMenu(), label: 'string_select_menu', carriesCustomId: true },
  { guard: i => i.isUserSelectMenu(), label: 'user_select_menu', carriesCustomId: true },
  { guard: i => i.isRoleSelectMenu(), label: 'role_select_menu', carriesCustomId: true },
  { guard: i => i.isChannelSelectMenu(), label: 'channel_select_menu', carriesCustomId: true },
  {
    guard: i => i.isMentionableSelectMenu(),
    label: 'mentionable_select_menu',
    carriesCustomId: true,
  },
  { guard: i => i.isButton(), label: 'button', carriesCustomId: true },
];
