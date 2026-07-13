/**
 * Schema-drift canary for shapes.inc API responses.
 *
 * shapes.inc is an external API with no contract: a field rename or a
 * restructured payload would previously make the fetcher silently succeed
 * with partial data, and users would not learn their export was incomplete
 * until they tried to use it. The canary checks each endpoint's TOP-LEVEL
 * response shape and logs a warning when expected fields are missing.
 *
 * OBSERVE-ONLY BY DESIGN — the canary never throws and never transforms the
 * payload. Two invariants depend on that:
 *
 * 1. Partial data beats no data: the export must still complete with
 *    whatever the API returned (a warn tells us the contract drifted so the
 *    types can be updated).
 * 2. Raw passthrough: nothing on the fetch path strips unknown fields
 *    (`response.json() as T` is a type-level cast), so the JSON export is
 *    the raw payload — users get fields we have not surfaced. A validator
 *    that replaced the payload (Zod strip mode) would silently break that.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ShapesResponseCanary');

/** Which endpoint's shape is being observed. */
export type ShapesEndpointKind = 'config' | 'memoryPage' | 'stories' | 'userPersonalization';

/**
 * Required top-level keys of ShapesIncPersonalityConfig (the interface's
 * non-optional fields). Kept as a literal list because the interface carries
 * a string index signature, which makes a `keyof`-based tie-in vacuous —
 * update this list when the interface's required surface changes.
 */
const CONFIG_REQUIRED_KEYS = [
  'id',
  'name',
  'username',
  'avatar',
  'jailbreak',
  'user_prompt',
  'personality_traits',
  'engine_model',
  'engine_temperature',
  'stm_window',
  'ltm_enabled',
  'ltm_threshold',
  'ltm_max_retrieved_summaries',
] as const;

const NOT_AN_OBJECT = 'response is not an object';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function warnDrift(kind: ShapesEndpointKind, problem: string, detail?: unknown): void {
  logger.warn(
    { endpoint: kind, problem, detail },
    'shapes.inc response shape drifted — continuing with available data; update the types'
  );
}

function observeConfigShape(payload: unknown): void {
  if (!isRecord(payload)) {
    warnDrift('config', NOT_AN_OBJECT);
    return;
  }
  const missing = CONFIG_REQUIRED_KEYS.filter(key => payload[key] === undefined);
  if (missing.length > 0) {
    warnDrift('config', 'expected top-level fields missing', { missing });
  }
}

function observeMemoryPageShape(payload: unknown): void {
  if (!isRecord(payload)) {
    warnDrift('memoryPage', NOT_AN_OBJECT);
    return;
  }
  const hasItemsArray = Array.isArray(payload.items) || Array.isArray(payload.memories);
  if (!hasItemsArray) {
    warnDrift('memoryPage', "neither 'items' nor 'memories' is an array");
  }
  if (payload.pagination === undefined) {
    warnDrift('memoryPage', "'pagination' field missing — page traversal may stop early");
  }
}

function observeStoriesShape(payload: unknown): void {
  if (Array.isArray(payload)) {
    return;
  }
  if (isRecord(payload) && (payload.items === undefined || Array.isArray(payload.items))) {
    return;
  }
  warnDrift('stories', "response is neither an array nor an object with an 'items' array");
}

function observeUserPersonalizationShape(payload: unknown): void {
  if (!isRecord(payload)) {
    warnDrift('userPersonalization', NOT_AN_OBJECT);
  }
}

/**
 * Observe an endpoint response's top-level shape; warn on drift, never throw.
 */
export function observeShapesResponseShape(kind: ShapesEndpointKind, payload: unknown): void {
  switch (kind) {
    case 'config':
      observeConfigShape(payload);
      return;
    case 'memoryPage':
      observeMemoryPageShape(payload);
      return;
    case 'stories':
      observeStoriesShape(payload);
      return;
    case 'userPersonalization':
      observeUserPersonalizationShape(payload);
      return;
  }
}
