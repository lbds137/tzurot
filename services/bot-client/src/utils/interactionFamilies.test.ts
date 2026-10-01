/**
 * Tests for the shared interaction-family table's own invariants
 * (`interactionFamilies.ts`).
 *
 * The per-family drop-log behavior that rides this table is exercised
 * through the classifier in `./foreignInteraction.test.ts`; this file pins
 * the table itself — label identity and order, guard wiring and return
 * shape, the carriesCustomId partition, and first-match classification.
 */

import { describe, expect, it } from 'vitest';
import type { BaseInteraction } from 'discord.js';
import { INTERACTION_FAMILIES } from './interactionFamilies.js';

/** The discord.js type guards the table's rows dispatch through. */
const GUARD_NAMES = [
  'isChatInputCommand',
  'isMessageContextMenuCommand',
  'isModalSubmit',
  'isAutocomplete',
  'isStringSelectMenu',
  'isUserSelectMenu',
  'isRoleSelectMenu',
  'isChannelSelectMenu',
  'isMentionableSelectMenu',
  'isButton',
] as const;

type GuardName = (typeof GUARD_NAMES)[number];

/** Independent guard→label expectations, so a rewired row fails against a literal. */
const GUARD_TO_LABEL: Record<GuardName, string> = {
  isChatInputCommand: 'chat_input',
  isMessageContextMenuCommand: 'message_context_menu',
  isModalSubmit: 'modal_submit',
  isAutocomplete: 'autocomplete',
  isStringSelectMenu: 'string_select_menu',
  isUserSelectMenu: 'user_select_menu',
  isRoleSelectMenu: 'role_select_menu',
  isChannelSelectMenu: 'channel_select_menu',
  isMentionableSelectMenu: 'mentionable_select_menu',
  isButton: 'button',
};

/** Labels expected to carry a parseable customId prefix, in table order. */
const CARRIES_CUSTOM_ID_LABELS = [
  'modal_submit',
  'string_select_menu',
  'user_select_menu',
  'role_select_menu',
  'channel_select_menu',
  'mentionable_select_menu',
  'button',
];

/** Labels expected NOT to carry a customId prefix, in table order. */
const WITHOUT_CUSTOM_ID_LABELS = ['chat_input', 'message_context_menu', 'autocomplete'];

/** Minimal interaction stub: the guards dispatch on their methods alone. */
function makeStub(reportingTrue: readonly GuardName[]): BaseInteraction {
  const stub = {
    isChatInputCommand: () => reportingTrue.includes('isChatInputCommand'),
    isMessageContextMenuCommand: () => reportingTrue.includes('isMessageContextMenuCommand'),
    isModalSubmit: () => reportingTrue.includes('isModalSubmit'),
    isAutocomplete: () => reportingTrue.includes('isAutocomplete'),
    isStringSelectMenu: () => reportingTrue.includes('isStringSelectMenu'),
    isUserSelectMenu: () => reportingTrue.includes('isUserSelectMenu'),
    isRoleSelectMenu: () => reportingTrue.includes('isRoleSelectMenu'),
    isChannelSelectMenu: () => reportingTrue.includes('isChannelSelectMenu'),
    isMentionableSelectMenu: () => reportingTrue.includes('isMentionableSelectMenu'),
    isButton: () => reportingTrue.includes('isButton'),
  };
  return stub as unknown as BaseInteraction;
}

describe('INTERACTION_FAMILIES', () => {
  const labels = INTERACTION_FAMILIES.map(f => f.label);

  it('is non-empty with unique, non-empty labels in a pinned order', () => {
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
    expect(labels).toEqual([
      'chat_input',
      'message_context_menu',
      'modal_submit',
      'autocomplete',
      'string_select_menu',
      'user_select_menu',
      'role_select_menu',
      'channel_select_menu',
      'mentionable_select_menu',
      'button',
    ]);
  });

  it('exposes every guard as a function returning a real boolean, false when nothing matches', () => {
    const matchingNone = makeStub([]);
    for (const family of INTERACTION_FAMILIES) {
      expect(typeof family.guard).toBe('function');
      expect(typeof family.carriesCustomId).toBe('boolean');

      const result = family.guard(matchingNone);
      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
    }
  });

  it.each(GUARD_NAMES.map(name => ({ name, label: GUARD_TO_LABEL[name] })))(
    'an interaction reporting only $name matches the $label row alone',
    ({ name, label }) => {
      const stub = makeStub([name]);

      const matching = INTERACTION_FAMILIES.filter(f => f.guard(stub)).map(f => f.label);
      expect(matching).toEqual([label]);
    }
  );

  it('partitions carriesCustomId over exactly the customId-bearing families', () => {
    // `=== true` mirrors the consumer check in foreignInteraction.ts.
    expect(INTERACTION_FAMILIES.filter(f => f.carriesCustomId === true).map(f => f.label)).toEqual(
      CARRIES_CUSTOM_ID_LABELS
    );
    expect(INTERACTION_FAMILIES.filter(f => f.carriesCustomId !== true).map(f => f.label)).toEqual(
      WITHOUT_CUSTOM_ID_LABELS
    );
  });

  it('classifies by first match when one interaction satisfies several guards', () => {
    // The find scan mirrors the consumers (foreignInteraction.ts,
    // interactionRouter.ts); the chat-input-before-modal pairing is the
    // order the classifier's guard-order test pins.
    const chatInputShapedModal = makeStub(['isChatInputCommand', 'isModalSubmit']);
    const first = INTERACTION_FAMILIES.find(f => f.guard(chatInputShapedModal));
    expect(first?.label).toBe('chat_input');

    const selectShapedButton = makeStub(['isStringSelectMenu', 'isButton']);
    const second = INTERACTION_FAMILIES.find(f => f.guard(selectShapedButton));
    expect(second?.label).toBe('string_select_menu');
  });
});
