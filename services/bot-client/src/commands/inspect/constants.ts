// Shared constants for inspect customId encoding. Lives in its own file so
// both customIds.ts and memoryInspectorState.ts can import without creating a
// cycle (memoryInspectorState.ts holds memoryButton, which is also exposed
// via customIds.ts's InspectCustomIds for API symmetry).

export const INSPECT_PREFIX = 'inspect';
export const INSPECT_DELIMITER = '::';
