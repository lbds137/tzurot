/**
 * Shared env save/restore for the ApiKeyResolver encryption-key tests.
 */

/**
 * Snapshot API_KEY_ENCRYPTION_KEY, API_KEY_ENCRYPTION_KEY_PREVIOUS and
 * API_KEY_ENCRYPTION_KEY_NEXT now and return a function that puts all three
 * back (deleting a variable that was unset).
 * Call at describe scope; pass the result to `afterEach`.
 */
export function snapshotEncryptionEnv(): () => void {
  const originalKey = process.env.API_KEY_ENCRYPTION_KEY;
  const originalPrevious = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
  const originalNext = process.env.API_KEY_ENCRYPTION_KEY_NEXT;

  return () => {
    if (originalNext === undefined) {
      delete process.env.API_KEY_ENCRYPTION_KEY_NEXT;
    } else {
      process.env.API_KEY_ENCRYPTION_KEY_NEXT = originalNext;
    }
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
