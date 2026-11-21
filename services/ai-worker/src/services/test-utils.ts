/**
 * Shared env save/restore for the ApiKeyResolver encryption-key tests.
 */

/**
 * Snapshot API_KEY_ENCRYPTION_KEY and API_KEY_ENCRYPTION_KEY_PREVIOUS now and
 * return a function that puts both back (deleting a variable that was unset).
 * Call at describe scope; pass the result to `afterEach`.
 */
export function snapshotEncryptionEnv(): () => void {
  const originalKey = process.env.API_KEY_ENCRYPTION_KEY;
  const originalPrevious = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;

  return () => {
    if (originalKey === undefined) {
      delete process.env.API_KEY_ENCRYPTION_KEY;
    } else {
      process.env.API_KEY_ENCRYPTION_KEY = originalKey;
    }
    if (originalPrevious === undefined) {
      delete process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
    } else {
      process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS = originalPrevious;
    }
  };
}
