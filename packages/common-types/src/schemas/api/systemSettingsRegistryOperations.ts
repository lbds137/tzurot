/**
 * System-settings registry entries for the `operations` and `memory-archive`
 * groups — split out of `systemSettingsRegistry.ts` purely to stay under the
 * `max-lines` limit as the registry grew past it. NOT a re-export module: the
 * entries here are spread directly into `SYSTEM_SETTINGS_REGISTRY`, so this
 * file is one more piece of that single object, just declared separately.
 */

import type { SystemSettings } from './systemSettings.js';
// From the shared types module, NOT from systemSettingsRegistry.ts — that
// module imports this one's value export back, so importing from it here
// (even type-only) would be a real dependency-cruiser-flagged cycle.
import {
  SEED_SOURCE_NEW,
  type OperationsRegistryKey,
  type SystemSettingMeta,
  type SystemSettingGroup,
} from './systemSettingsRegistryTypes.js';

const GROUP_OPERATIONS: SystemSettingGroup = 'operations';
const GROUP_MEMORY_ARCHIVE: SystemSettingGroup = 'memory-archive';

export const SYSTEM_SETTINGS_REGISTRY_OPERATIONS: {
  readonly [K in OperationsRegistryKey]: SystemSettingMeta<K>;
} = {
  archiveSplitRenderPersonalities: {
    key: 'archiveSplitRenderPersonalities',
    label: 'Archive Split Render',
    description:
      'Personality slugs whose memory archive renders split (user turn verbatim + linked facts, assistant prose omitted). Empty = every character renders verbatim.',
    // GROUP_MEMORY_ARCHIVE, not GROUP_OPERATIONS/GROUP_EXTRACTION: the
    // memory-archive group holds this render switch beside the summarizer's
    // own switches — a rendering-shape and a write-path knob that both govern
    // the same feature, rather than splitting them across unrelated pages.
    group: GROUP_MEMORY_ARCHIVE,
    control: 'list',
    liveness: 'live',
    fallback: [] as SystemSettings['archiveSplitRenderPersonalities'],
    seedSource: SEED_SOURCE_NEW,
  },
  archiveSummaryEnqueueEnabled: {
    key: 'archiveSummaryEnqueueEnabled',
    label: 'Archive Summary Enqueue',
    description:
      'Job creation switch for the memory-archive summarizer: when off, a stored memory is never enqueued for summarization.',
    group: GROUP_MEMORY_ARCHIVE,
    control: 'boolean',
    liveness: 'live',
    fallback: false,
    seedSource: SEED_SOURCE_NEW,
  },
  archiveSummaryModelEnabled: {
    key: 'archiveSummaryModelEnabled',
    label: 'Archive Summary Model Calls',
    description:
      'Model-call switch for the memory-archive summarizer: when off, queued jobs delay instead of billing a call. Separate from the enqueue switch so a backlog can be built before any spend.',
    group: GROUP_MEMORY_ARCHIVE,
    control: 'boolean',
    liveness: 'live',
    fallback: false,
    seedSource: SEED_SOURCE_NEW,
  },
  archiveSummaryDailyCap: {
    key: 'archiveSummaryDailyCap',
    label: 'Archive Summary Daily Cap',
    description:
      'Rows the memory-archive summarizer may process per UTC day, all characters combined. Over the cap, jobs delay an hour instead of failing.',
    group: GROUP_MEMORY_ARCHIVE,
    control: 'integer',
    liveness: 'live',
    fallback: 2000,
    seedSource: SEED_SOURCE_NEW,
    min: 1,
    max: 100000,
  },
  nightlySyncEnabled: {
    key: 'nightlySyncEnabled',
    label: 'Nightly Sync Enabled',
    description: 'Run the scheduled nightly dev↔prod database sync (prod bot only).',
    group: GROUP_OPERATIONS,
    control: 'boolean',
    liveness: 'live',
    // Defaults ON: the scheduled sync is the mechanism that keeps dev usable as
    // a rehearsal of prod, and it is silent when nothing moved. The switch
    // exists to park it during a migration soak, not because the steady state
    // is risky.
    fallback: true,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
  },
  nightlySyncHourUtc: {
    key: 'nightlySyncHourUtc',
    label: 'Nightly Sync Hour (UTC)',
    description:
      'UTC hour the nightly database sync fires (7 ≈ 3am US Eastern in summer, 2am in winter).',
    group: GROUP_OPERATIONS,
    control: 'integer',
    liveness: 'live',
    fallback: 7,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
    min: 0,
    max: 23,
  },
  realMessagesEnabled: {
    key: 'realMessagesEnabled',
    label: 'Real Messages',
    description:
      'Render conversation history as real user/assistant provider messages instead of <chat_log> XML in the system prompt (prompt-assembly Phase 2 rollout switch).',
    group: GROUP_OPERATIONS,
    control: 'boolean',
    liveness: 'live',
    // Defaults OFF: this is a staged rollout switch for a structural prompt
    // change (§9c of the prompt-assembly design) — flip explicitly, never by
    // a lost DB row silently changing what every persona's prompt looks like.
    fallback: false,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
  },
  headerSpoofNeutralizeEnabled: {
    key: 'headerSpoofNeutralizeEnabled',
    label: 'Header Spoof Neutralization',
    description:
      'Convert header-shaped lines in real-message body content to parentheses, so a user cannot forge a platform speaker header. Only takes effect when Real Messages is on; governs the input-side transform only — output-side echo stripping rides Real Messages alone.',
    group: GROUP_OPERATIONS,
    control: 'boolean',
    liveness: 'live',
    // Defaults ON, unlike the rollout switch it rides: this is a hardening
    // measure with no staged-rollout semantics, and a lost DB row must not
    // silently reopen the spoof path on a flag-on deployment. The empirical
    // exit is an owner flip when false-positive volume outweighs the
    // invariant, not a dark default.
    fallback: true,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
  },
};
