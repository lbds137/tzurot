/**
 * Preset Clone Name Utilities
 *
 * Pure name-generation (`generateClonedName`) and the retry-on-collision
 * driver (`createClonedPreset`) that wraps `createPreset` with suffix
 * bumping. No Discord.js references — so this is also the natural home
 * for direct unit tests of the naming / retry behavior.
 */

import { API_ERROR_SUBCODE } from '@tzurot/common-types';
import { GatewayApiError } from '../../utils/userGatewayClient.js';
import { createPreset } from './api.js';
import type { FlattenedPresetData } from './config.js';
import type { PresetData } from './types.js';

/** Max retry attempts when a generated clone name collides with an existing preset. */
export const MAX_CLONE_NAME_RETRIES = 10;

/**
 * Pattern to match a trailing (Copy) or (Copy N) suffix.
 * Defined at module scope to avoid regex recompilation on each call.
 * Group 1 captures the optional number for extraction.
 */
const COPY_SUFFIX_PATTERN = /\s*\(Copy(?:\s+(\d+))?\)\s*$/i;

/**
 * Generate a cloned name by stripping all (Copy N) suffixes and adding a new one.
 * Finds the maximum copy number among all suffixes and increments it.
 *
 * Examples:
 * - "Preset" → "Preset (Copy)"
 * - "Preset (Copy)" → "Preset (Copy 2)"
 * - "Preset (Copy 2)" → "Preset (Copy 3)"
 * - "Preset (Copy) (Copy)" → "Preset (Copy 2)" (max of 1,1 is 1, so next is 2)
 * - "Preset (Copy 5) (Copy)" → "Preset (Copy 6)" (max of 5,1 is 5, so next is 6)
 *
 * @param originalName - The original preset name
 * @returns A new name with appropriate (Copy N) suffix
 */
export function generateClonedName(originalName: string): string {
  // Iteratively strip (Copy N) suffixes and track the highest number
  let baseName = originalName;
  let maxNum = 0;
  let hadSuffix = false;

  let match: RegExpExecArray | null;
  while ((match = COPY_SUFFIX_PATTERN.exec(baseName)) !== null) {
    hadSuffix = true;
    // match[1] is the capture group for the number (undefined if just "(Copy)")
    const num = match[1] !== undefined ? parseInt(match[1], 10) : 1;
    maxNum = Math.max(maxNum, num);
    // Strip this suffix
    baseName = baseName.slice(0, match.index);
  }

  baseName = baseName.trim();

  if (!hadSuffix) {
    // Trim the original too so trailing whitespace doesn't leak into the
    // output — matches the suffix-present branch's `.trim()` above.
    return `${originalName.trim()} (Copy)`;
  }

  return `${baseName} (Copy ${maxNum + 1})`;
}

/**
 * Detect the api-gateway's "name already used" validation error so the clone
 * flow can bump the suffix and retry instead of giving up. Matches on the
 * machine-readable sub-code set by `ErrorResponses.nameCollision` in
 * `user/llm-config.ts` — message-text wording changes can't silently
 * degrade the retry.
 */
function isNameCollisionError(err: unknown): err is GatewayApiError {
  return err instanceof GatewayApiError && err.code === API_ERROR_SUBCODE.NAME_COLLISION;
}

/**
 * Create a cloned preset with auto-numbered naming. If the initial candidate
 * collides with an existing preset, feed the candidate back through
 * `generateClonedName` to bump the suffix and retry. Any non-collision error
 * propagates immediately. After `MAX_CLONE_NAME_RETRIES` attempts the last
 * collision error is rethrown so the user sees the actual collision name.
 */
export async function createClonedPreset(
  sourceData: FlattenedPresetData,
  userId: string
): Promise<PresetData> {
  let clonedName = generateClonedName(sourceData.name);
  // Tightened from `Error | null` to `GatewayApiError | null`: the only
  // assignment site is guarded by `isNameCollisionError`, which narrows
  // to `GatewayApiError`. The final `throw lastError` therefore carries
  // the full `{ status, code }` shape, not just a bare Error.
  let lastError: GatewayApiError | null = null;

  for (let attempt = 0; attempt < MAX_CLONE_NAME_RETRIES; attempt++) {
    try {
      return await createPreset(
        {
          name: clonedName,
          model: sourceData.model,
          provider: sourceData.provider,
          description:
            sourceData.description !== undefined && sourceData.description.length > 0
              ? sourceData.description
              : undefined,
          visionModel:
            sourceData.visionModel !== undefined && sourceData.visionModel.length > 0
              ? sourceData.visionModel
              : undefined,
        },
        userId
      );
    } catch (err) {
      if (isNameCollisionError(err)) {
        lastError = err;
        clonedName = generateClonedName(clonedName);
      } else {
        throw err;
      }
    }
  }

  // `lastError` is always set when we reach here: the loop can only exit
  // via this `throw` (vs. the `return` inside the try) if at least one
  // iteration caught a collision and assigned `lastError`. The `??`
  // fallback is unreachable unless `MAX_CLONE_NAME_RETRIES` is set to 0,
  // in which case the loop body never runs — keeping the fallback defends
  // against that degenerate config.
  throw lastError ?? new Error('Failed to generate a unique clone name');
}
