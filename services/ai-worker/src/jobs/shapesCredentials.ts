/**
 * Shared Shapes.inc Credential Helpers
 *
 * Extracted from ShapesExportJob and ShapesImportJob to eliminate duplication.
 * Handles cookie decryption, persistence after rotation, and error classification.
 */

import {
  createLogger,
  decryptApiKey,
  encryptApiKey,
  type PrismaClient,
  CREDENTIAL_SERVICES,
  CREDENTIAL_TYPES,
} from '@tzurot/common-types';
import {
  ShapesAuthError,
  ShapesFetchError,
  ShapesNotFoundError,
} from '../services/shapes/ShapesDataFetcher.js';

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
 * Classify a shapes.inc error as retryable or non-retryable.
 *
 * Known non-retryable: ShapesAuthError, ShapesNotFoundError, ShapesFetchError.
 * Everything else (timeouts, network failures) defaults to retryable.
 */
export function classifyShapesError(error: unknown): ShapesErrorClassification {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isNonRetryable =
    error instanceof ShapesAuthError ||
    error instanceof ShapesNotFoundError ||
    error instanceof ShapesFetchError;

  return { isRetryable: !isNonRetryable, errorMessage };
}
