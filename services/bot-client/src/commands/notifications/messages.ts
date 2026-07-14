/**
 * Shared copy for the /notifications command surfaces.
 */

import type { NotifyLevelValue } from '@tzurot/common-types/schemas/api/notifications';

/** Resource name for classifyGatewayFailure error rendering. */
export const NOTIFICATIONS_RESOURCE = 'Notification settings';

/** Human explanation of how release weights are classified. */
export const LEVEL_EXPLANATION =
  'Levels come from each release’s *content*: **major** = breaking changes, ' +
  '**minor** = new features, **patch** = fixes only. Your level is the minimum ' +
  'weight worth a DM.';

/** Display labels for each notify level (total — the compiler enforces coverage). */
export const LEVEL_LABELS: Record<NotifyLevelValue, string> = {
  major: 'Major — breaking changes only',
  minor: 'Minor — features and breaking changes',
  patch: 'Patch — every release, including fix-only',
};
