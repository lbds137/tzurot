/**
 * Preset Clone Driver
 *
 * Thin wrapper over `createPreset` that asks the server to auto-bump the
 * `(Copy N)` suffix on collision via the `autoSuffixOnCollision` flag.
 * Previously this file carried a client-side retry loop that re-sent
 * the request up to 10 times with progressively-bumped candidate names;
 * the server now owns that logic so the clone fires in a single request.
 *
 * Note: `generateClonedName` was moved to `@tzurot/common-types` so the
 * server can share the exact same logic for the bump step. Bot-client
 * still imports it here for the initial candidate-name generation
 * (shown to the user in confirmation UX).
 */

import { generateClonedName } from '@tzurot/common-types';
import type { GatewayUser } from '../../utils/userGatewayClient.js';
import { createPreset } from './api.js';
import type { FlattenedPresetData } from './config.js';
import type { PresetData } from './types.js';

// Re-export `generateClonedName` for existing callers/tests that import it
// from this module. Keeps the public surface stable; the source of truth
// lives in common-types so the server can import the same implementation.
export { generateClonedName };

/**
 * Create a cloned preset with auto-numbered naming. Passes the initial
 * candidate name to the server with `autoSuffixOnCollision: true`, which
 * tells the server to bump the suffix server-side until it finds a free
 * slot. Single HTTP round-trip regardless of how many existing copies
 * already exist (previously up to 10 round-trips on a heavily-cloned
 * base name).
 *
 * Non-collision errors from the server propagate directly.
 */
export async function createClonedPreset(
  sourceData: FlattenedPresetData,
  user: GatewayUser
): Promise<PresetData> {
  const initialName = generateClonedName(sourceData.name);
  return createPreset(
    {
      name: initialName,
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
      autoSuffixOnCollision: true,
    },
    user
  );
}
