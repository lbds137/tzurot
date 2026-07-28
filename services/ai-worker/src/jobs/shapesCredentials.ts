/**
 * Shared Shapes.inc Credential Helpers
 *
 * Extracted from ShapesExportJob and ShapesImportJob to eliminate duplication.
 * Handles cookie decryption, persistence after rotation, and error classification.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { CREDENTIAL_SERVICES, CREDENTIAL_TYPES } from '@tzurot/common-types/types/shapes-import';
import { decryptApiKey, encryptApiKey } from '@tzurot/common-types/utils/encryption';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  ShapesAuthError,
  ShapesBotProtectionError,
  ShapesFetchError,
  ShapesJobValidationError,
  ShapesNotFoundError,
  isKnownShapesError,
} from '../services/shapes/shapesErrors.js';

const logger = createLogger('shapesCredentials');

/**
 * Look up and decrypt the shapes.inc session cookie for a user.
 * @throws ShapesAuthError if no credential is found.
 */
export async function getDecryptedCookie(prisma: PrismaClient, userId: string): Promise<string> {
  const credential = await prisma.userCredential.findFirst({
    where: {
      userId,
      service: CREDENTIAL_SERVICES.SHAPES_INC,
      credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (credential === null) {
    throw new ShapesAuthError('No shapes.inc credentials found. Use /shapes auth first.');
  }

  return decryptApiKey({
    iv: credential.iv,
    content: credential.content,
    tag: credential.tag,
  });
}

/**
 * Re-encrypt and persist a rotated session cookie.
 * Non-fatal — logs a warning on failure so the calling job can still succeed.
 */
export async function persistUpdatedCookie(
  prisma: PrismaClient,
  userId: string,
  updatedCookie: string
): Promise<void> {
  try {
    const encrypted = encryptApiKey(updatedCookie);
    await prisma.userCredential.updateMany({
      where: {
        userId,
        service: CREDENTIAL_SERVICES.SHAPES_INC,
        credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
      },
      data: {
        iv: encrypted.iv,
        content: encrypted.content,
        tag: encrypted.tag,
        lastUsedAt: new Date(),
      },
    });
  } catch (error) {
    logger.warn({ err: error }, 'Failed to persist updated shapes.inc cookie');
  }
}

interface ShapesErrorClassification {
  isRetryable: boolean;
  errorMessage: string;
}

/**
 * The user-visible copy for failures outside the typed shapes-error set.
 * Exported so tests pin the exact string the status routes will serve.
 */
export const GENERIC_SHAPES_JOB_ERROR_MESSAGE =
  'The job failed unexpectedly. You can retry; if it keeps failing, contact the bot owner.';

/**
 * Classify a shapes.inc error as retryable or non-retryable.
 *
 * Known non-retryable: ShapesAuthError, ShapesNotFoundError, ShapesFetchError,
 * ShapesBotProtectionError (a bot wall does not clear on retry — hammering it
 * only makes the fingerprint worse), and ShapesJobValidationError (a failed
 * precondition re-reads the same rows on every attempt).
 * Everything else (timeouts, network failures) defaults to retryable.
 *
 * `errorMessage` is what markFailed stores in the user-visible errorMessage
 * column — the import/export status routes return it verbatim. Typed shapes
 * errors carry authored user-facing copy and pass through; anything else is
 * raw infra detail and gets the generic copy (the full error object is
 * already in logs via handleShapesJobError before markFailed runs).
 */
export function classifyShapesError(error: unknown): ShapesErrorClassification {
  const errorMessage = isKnownShapesError(error) ? error.message : GENERIC_SHAPES_JOB_ERROR_MESSAGE;
  const isNonRetryable =
    error instanceof ShapesAuthError ||
    error instanceof ShapesNotFoundError ||
    error instanceof ShapesFetchError ||
    error instanceof ShapesBotProtectionError ||
    error instanceof ShapesJobValidationError;

  return { isRetryable: !isNonRetryable, errorMessage };
}
