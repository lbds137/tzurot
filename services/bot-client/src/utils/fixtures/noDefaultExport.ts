/**
 * Command-loading fixture for deployCommands.test.ts.
 *
 * The legacy named-export module shape: `data` + `execute` exported by name
 * with NO default export. Command entry points must default-export their
 * Command, so `loadCommandFile` rejects this module and logs it as invalid —
 * the behavior the test pins. A default export must never be added here, or
 * the rejection test silently stops testing anything.
 *
 * Loaded by absolute path through a mocked `getCommandFiles`, so this file has
 * no static importer other than the test's shape guards.
 */

export const data = {
  name: 'fixture-no-default',
  toJSON(): { name: string } {
    return { name: 'fixture-no-default' };
  },
};

export const execute = (): Promise<void> => Promise.resolve();
