/**
 * Delete a UserPersonalityConfig anchor row if clearing an override left every
 * slice null. Without this, set-then-clear accumulates dead anchor rows that
 * resolve to nothing and clutter data exports.
 *
 * Call AFTER the clear's `update`. The re-read → conditional-delete race
 * against a concurrent set is benign (single-user sequential command flow;
 * worst case a just-re-set row is dropped and re-created on next use).
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { isEmptyPersonalityConfig } from '@tzurot/common-types/utils/personalityConfigShape';

export async function pruneEmptyPersonalityConfig(
  prisma: PrismaClient,
  id: string
): Promise<boolean> {
  const row = await prisma.userPersonalityConfig.findUnique({
    where: { id },
    select: {
      personaId: true,
      llmConfigId: true,
      visionConfigId: true,
      ttsConfigId: true,
      configOverrides: true,
    },
  });
  if (row === null || !isEmptyPersonalityConfig(row)) {
    return false;
  }
  await prisma.userPersonalityConfig.delete({ where: { id } });
  return true;
}
