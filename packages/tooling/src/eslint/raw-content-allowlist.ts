/**
 * Grandfathered raw message-content literals in bot-client command files —
 * the shrink-only budget behind `@tzurot/no-raw-content-literals`.
 *
 * Contract:
 *   - An entry permits a command file at most that many raw literals at
 *     Discord content positions (direct args, `content:` properties, and
 *     same-file consts referenced there). At or under budget: silent. Over:
 *     every violation in the file reports.
 *   - SHRINK-ONLY: budgets go down as copy migrates onto ux/catalog
 *     (`renderSpec(CATALOG…)`). Raising a budget — or adding an entry — means
 *     new raw user-facing copy outside the catalog; write the catalog entry
 *     instead. The colocated test pins the total so growth fails loudly.
 *   - Paths are repo-relative with forward slashes; the rule suffix-matches
 *     them against the linted file's normalized path (cwd-independent).
 *
 * Seeded from the rule's own measurement at adoption time (the successor to
 * the retired `ux:literals` grep ratchet — see the rule header for scope).
 */

export const RAW_CONTENT_ALLOWLIST: Readonly<Record<string, number>> = {
  'services/bot-client/src/commands/admin/broadcast.ts': 1,
  'services/bot-client/src/commands/admin/db-sync.ts': 3,
  'services/bot-client/src/commands/admin/kick.ts': 1,
  'services/bot-client/src/commands/admin/ping.ts': 3,
  'services/bot-client/src/commands/admin/presence.ts': 4,
  'services/bot-client/src/commands/admin/settingsSet.ts': 4,
  'services/bot-client/src/commands/channel/activate.ts': 2,
  'services/bot-client/src/commands/channel/browseHelpers.ts': 1,
  'services/bot-client/src/commands/channel/deactivate.ts': 4,
  'services/bot-client/src/commands/character/aliasBrowse.ts': 2,
  'services/bot-client/src/commands/character/avatar.ts': 2,
  'services/bot-client/src/commands/character/browseHelpers.ts': 1,
  'services/bot-client/src/commands/character/chat.ts': 2,
  'services/bot-client/src/commands/character/dashboardActions.ts': 10,
  'services/bot-client/src/commands/character/dashboardDeleteHandlers.ts': 1,
  'services/bot-client/src/commands/character/randomPick.ts': 1,
  'services/bot-client/src/commands/character/slashChatGates.ts': 1,
  'services/bot-client/src/commands/character/template.ts': 5,
  'services/bot-client/src/commands/character/view.ts': 3,
  'services/bot-client/src/commands/character/voice.ts': 2,
  'services/bot-client/src/commands/deny/add.ts': 1,
  'services/bot-client/src/commands/deny/browse.ts': 2,
  'services/bot-client/src/commands/deny/detail.ts': 2,
  'services/bot-client/src/commands/deny/detailEdit.ts': 1,
  'services/bot-client/src/commands/deny/remove.ts': 1,
  'services/bot-client/src/commands/deny/view.ts': 3,
  'services/bot-client/src/commands/feedback/index.ts': 2,
  'services/bot-client/src/commands/history/index.ts': 2,
  'services/bot-client/src/commands/inspect/browse.ts': 4,
  'services/bot-client/src/commands/inspect/index.ts': 4,
  'services/bot-client/src/commands/memory/batchDelete.ts': 5,
  'services/bot-client/src/commands/memory/browse.ts': 1,
  'services/bot-client/src/commands/memory/detail.ts': 1,
  'services/bot-client/src/commands/memory/detailActionRouter.ts': 2,
  'services/bot-client/src/commands/memory/detailModals.ts': 3,
  'services/bot-client/src/commands/memory/factsBrowse.ts': 1,
  'services/bot-client/src/commands/memory/interactionHandlers.ts': 1,
  'services/bot-client/src/commands/memory/purge.ts': 1,
  'services/bot-client/src/commands/memory/search.ts': 1,
  'services/bot-client/src/commands/persona/default.ts': 2,
  'services/bot-client/src/commands/persona/override/clear.ts': 2,
  'services/bot-client/src/commands/persona/override/set.ts': 4,
  'services/bot-client/src/commands/persona/view.ts': 1,
  'services/bot-client/src/commands/preset/browse.ts': 1,
  'services/bot-client/src/commands/preset/config.ts': 1,
  'services/bot-client/src/commands/preset/edit.ts': 4,
  'services/bot-client/src/commands/preset/global/globalPresetHelpers.ts': 2,
  'services/bot-client/src/commands/preset/import.ts': 3,
  'services/bot-client/src/commands/preset/template.ts': 8,
  'services/bot-client/src/commands/settings/apikey/browse.ts': 2,
  'services/bot-client/src/commands/settings/apikey/test.ts': 3,
  'services/bot-client/src/commands/settings/data/export.ts': 3,
  'services/bot-client/src/commands/settings/preset/clear-default.ts': 2,
  'services/bot-client/src/commands/settings/preset/clear.ts': 2,
  'services/bot-client/src/commands/settings/preset/set-default.ts': 2,
  'services/bot-client/src/commands/settings/preset/set.ts': 2,
  'services/bot-client/src/commands/settings/timezone/get.ts': 2,
  'services/bot-client/src/commands/settings/timezone/set.ts': 2,
  'services/bot-client/src/commands/shapes/browse.ts': 4,
  'services/bot-client/src/commands/shapes/detailHandlers.ts': 7,
  'services/bot-client/src/commands/shapes/export.ts': 3,
  'services/bot-client/src/commands/shapes/import.ts': 2,
  'services/bot-client/src/commands/shapes/interactionHandlers.ts': 7,
  'services/bot-client/src/commands/shapes/status.ts': 1,
  'services/bot-client/src/commands/voice/stt/clear.ts': 2,
  'services/bot-client/src/commands/voice/stt/set.ts': 2,
  'services/bot-client/src/commands/voice/tts/clear-default.ts': 2,
  'services/bot-client/src/commands/voice/tts/clear.ts': 2,
  'services/bot-client/src/commands/voice/tts/set-default.ts': 2,
  'services/bot-client/src/commands/voice/tts/set.ts': 2,
  'services/bot-client/src/commands/voice/voices/clear.ts': 1,
};

/** Total grandfathered literals — the shrink-only ceiling pinned by the test. */
export function rawContentBudgetTotal(): number {
  return Object.values(RAW_CONTENT_ALLOWLIST).reduce((sum, n) => sum + n, 0);
}
