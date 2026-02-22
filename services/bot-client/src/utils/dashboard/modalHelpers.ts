/**
 * Dashboard Modal Submit Helpers
 *
 * Shared utilities for handling modal submissions across dashboards.
 * Extracts the common section-lookup + value-extraction + merge pattern.
 */

import type { ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { DashboardConfig, SectionDefinition } from './types.js';
import { extractModalValues } from './ModalFactory.js';

const logger = createLogger('modal-helpers');

/**
 * Result of extracting and merging section values from a modal submission
 */
export interface ExtractAndMergeResult<T> {
  /** The matching section definition */
  section: SectionDefinition<T>;
  /** The merged data (current session data + new modal values) */
  merged: Partial<T>;
}

/**
 * Find the section, extract modal values, and merge with current session data.
 *
 * Encapsulates the common pattern across all dashboard modal submit handlers:
 * 1. Find section by ID in dashboard config
 * 2. Extract values from modal fields
 * 3. Merge extracted values with existing session data
 *
 * @returns The section and merged data, or null if section not found
 *
 * @example
 * ```typescript
 * const result = extractAndMergeSectionValues(
 *   interaction,
 *   PERSONA_DASHBOARD_CONFIG,
 *   sectionId,
 *   session?.data ?? {}
 * );
 * if (result === null) return;
 *
 * const updatePayload = unflattenData(result.merged);
 * ```
 */
export function extractAndMergeSectionValues<T>(
  interaction: ModalSubmitInteraction,
  dashboardConfig: DashboardConfig<T>,
  sectionId: string,
  currentData: Partial<T>
): ExtractAndMergeResult<T> | null {
  const section = dashboardConfig.sections.find(s => s.id === sectionId);
  if (section === undefined) {
    logger.error({ sectionId }, 'Unknown section');
    return null;
  }

  const values = extractModalValues(
    interaction,
    section.fields.map(f => f.id)
  );

  const merged = { ...currentData, ...values } as Partial<T>;

  return { section, merged };
}
