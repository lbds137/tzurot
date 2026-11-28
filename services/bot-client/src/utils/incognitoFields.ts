/**
 * The incognito fields a persisted assistant turn carries, read from a job
 * result's metadata: the worker reports whether the turn ran incognito and how
 * (`summon` or `session`). The kind is only meaningful beside `incognito: true`.
 */

import type { IncognitoKind } from '@tzurot/common-types/types/schemas/message';

export interface IncognitoFields {
  incognito?: boolean;
  incognitoKind?: IncognitoKind;
}

export function incognitoFields(
  metadata: { incognitoModeActive?: boolean; incognitoKind?: IncognitoKind } | undefined
): IncognitoFields {
  if (typeof metadata?.incognitoModeActive !== 'boolean') {
    return {};
  }
  return {
    incognito: metadata.incognitoModeActive,
    ...(metadata.incognitoModeActive && metadata.incognitoKind !== undefined
      ? { incognitoKind: metadata.incognitoKind }
      : {}),
  };
}
