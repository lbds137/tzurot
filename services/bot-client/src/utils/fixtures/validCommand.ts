/**
 * Command-loading fixture for deployCommands.test.ts.
 *
 * A minimal, well-formed command entry point: it default-exports an object
 * carrying `data` + `execute`, which is the contract `loadCommandFile`
 * enforces. `TO_JSON_SENTINEL` appears ONLY in `toJSON()`'s output — never on
 * `data` itself — so a test asserting the sentinel reached the deploy payload
 * proves the loader serialized through `toJSON()` instead of forwarding the
 * raw builder.
 *
 * Loaded by absolute path through a mocked `getCommandFiles`, so this file has
 * no static importer other than the test's shape guards.
 */

/** Present only in `toJSON()`'s output — the marker that serialization ran. */
export const TO_JSON_SENTINEL = 'fixture-valid-serialized-via-toJSON';

export default {
  data: {
    name: 'fixture-valid',
    toJSON(): { name: string; description: string } {
      return { name: 'fixture-valid', description: TO_JSON_SENTINEL };
    },
  },
  execute: (): Promise<void> => Promise.resolve(),
};
