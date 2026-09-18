/**
 * Operator-run dry run for one recent-days digest (persona, personality)
 * pair. Writes NOTHING — no digest row, no usage row — but DOES bill the
 * model call, exactly like a real sweep tick would for this pair.
 *
 * Invocation:
 *   pnpm ops run --env dev --with ZAI_CODING_API_KEY -- \
 *     tsx services/ai-worker/src/scripts/digestDryRun.ts --persona PERSONA_UUID --personality PERSONALITY_SLUG
 *
 * The placeholders are written without angle brackets on purpose: this file
 * sits under `guard:prompt-tags`' `services/ai-worker/src` scan root, where a
 * tag-shaped literal is indistinguishable from a real structural prompt tag
 * and fails the guard closed (pinned by check-prompt-tags.test.ts).
 */

import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';
import {
  SystemSettingsService,
  registerSystemSettings,
} from '@tzurot/common-types/services/SystemSettingsService';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { loadDigestPairForDryRun } from '@tzurot/common-types/services/recentDaysDigestSelection';
import { getConfig } from '@tzurot/common-types/config/config';
import { resolveSystemModelRoute } from '../services/systemModel/systemModelCall.js';
import { makeRecentDaysDigestInvoker } from '../services/recentDaysDigest/makeRecentDaysDigestInvoker.js';
import {
  dryRunDigestForPair,
  printDryRunReport,
} from '../services/recentDaysDigest/recentDaysDigestDryRun.js';
import { parseDryRunArgs } from '../services/recentDaysDigest/recentDaysDigestDryRunArgs.js';

/**
 * `process.exit()` inside a `try` races the `finally`'s awaited `dispose()`
 * against Node's shutdown, so every early-return path here sets
 * `process.exitCode` and returns instead — `dispose()` in `finally` still
 * runs to completion, and Node exits with that code once the event loop
 * empties.
 */
async function main(): Promise<void> {
  const parsed = parseDryRunArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(
      'Usage: tsx digestDryRun.ts --persona PERSONA_UUID --personality PERSONALITY_SLUG'
    );
    console.error(parsed.reason);
    process.exitCode = 1;
    return;
  }

  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });
  try {
    const systemSettings = new SystemSettingsService(prisma);
    await systemSettings.prime();
    registerSystemSettings(systemSettings);

    const route = resolveSystemModelRoute();
    if (route.provider !== AIProvider.ZaiCoding) {
      const missingKey = getConfig().ZAI_CODING_API_KEY === undefined;
      console.error(
        missingKey
          ? 'Refusing: ZAI_CODING_API_KEY is not set in this environment.'
          : "Refusing: the 'extractionProvider' system setting is not 'zai-coding'."
      );
      process.exitCode = 1;
      return;
    }

    const pair = await loadDigestPairForDryRun(prisma, {
      personaId: parsed.personaId,
      personalitySlug: parsed.personalitySlug,
    });
    if (pair === null) {
      console.error(
        `No such pair, or no source rows in the window (persona=${parsed.personaId} personality=${parsed.personalitySlug}).`
      );
      process.exitCode = 1;
      return;
    }

    const invoke = makeRecentDaysDigestInvoker(route);
    const report = await dryRunDigestForPair(prisma, { pair, invoke, now: new Date() });
    console.log(printDryRunReport(report));
  } finally {
    await dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
