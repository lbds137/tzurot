/**
 * Persona-related constants shared across common-types and test-utils.
 *
 * Lives in the constants layer (not the services layer) so `test-utils` can
 * import it as a runtime dependency without creating a circular edge. The
 * cycle people typically worry about here is at the test level
 * (`common-types` tests → `test-utils`), not at the production level —
 * common-types's own runtime code never imports test-utils.
 */

/** Default description applied to auto-created personas. */
export const DEFAULT_PERSONA_DESCRIPTION = 'Default persona';
