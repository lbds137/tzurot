/**
 * Active-API-key presence check.
 *
 * Answers "does this user have an active key for provider X?" without ever
 * loading the key material. Used by the LLM-config validation path to decide
 * whether to validate a model against a provider-specific catalog (z.ai) — a
 * user with an active z.ai-coding key has their `z-ai/<model>` requests
 * promoted to z.ai-direct at runtime, so the model must be validated against
 * z.ai's catalog rather than OpenRouter's.
 */

import type { AIProvider } from '@tzurot/common-types/constants/ai';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

/**
 * Return `true` if the user has an active API key for the given provider.
 *
 * `(userId, provider)` is unique in the schema, so at most one row matches —
 * but we use `findFirst` rather than `findUnique` because the query also
 * filters on `isActive`, which isn't part of the unique key (`findUnique`'s
 * `where` only accepts the unique fields). The `@@index([userId, provider])`
 * still makes this an indexed lookup. Selects only `id` — key material is
 * never read.
 */
export async function userHasActiveApiKey(
  prisma: PrismaClient,
  userId: string,
  provider: AIProvider
): Promise<boolean> {
  const key = await prisma.userApiKey.findFirst({
    where: { userId, provider, isActive: true },
    select: { id: true },
  });
  return key !== null;
}
