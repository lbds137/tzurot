# Display Name Alias Handling

This document explains how Tzurot handles display name aliases and collision resolution.

## Problem

When multiple AI personalities have the same display name (e.g., "Lilith"), we need to ensure each gets a unique alias while maintaining user-friendliness.

## Solution

Tzurot implements an intelligent alias collision resolution system:

1. The first personality with a given display name (e.g., "Lilith") gets the basic alias (e.g., "lilith")
2. Subsequent personalities with the same display name get more meaningful aliases:
   - For shorter display names like "Lilith", we add the second word from the full name
     - Example: "lilith-tzel-shani" → "lilith-tzel"
   - For longer display names or special cases, we use other parts of the name or initials
     - Example: "lilith-sheda-khazra-le-khof-avud" → "lilith-sheda"

## Implementation Details

The key components of this system are:

1. The `setPersonalityAlias` function with `isDisplayName=true` parameter
2. Enhanced collision detection in the alias setting logic
3. Special handling during seeding of owner personalities

### Fixed Issues

Previously, the `seedOwnerPersonalities` function wasn't marking aliases created from display names as display names (isDisplayName parameter was missing), causing collisions to be handled incorrectly.

This has been fixed, and now all display name aliases are properly marked, ensuring the collision handling logic is invoked correctly.

### Example

```javascript
// When setting a display name alias, use isDisplayName=true
await setPersonalityAlias(
  personality.displayName.toLowerCase(), 
  personalityName, 
  false,  // skipSave
  true    // isDisplayName - important for collision handling
);
```

## Testing

The functionality is tested in `personalityManager.seeding.test.js` with a specific test that verifies:

1. Two personalities with the same display name ("Lilith") are handled correctly
2. The first one gets the basic alias "lilith"
3. The second one gets a more meaningful alias "lilith-sheda" instead of cryptic/short alternatives

## Best Practices

When adding new code that creates aliases from display names:

1. Always set `isDisplayName=true` when the alias comes from a display name
2. Use the existing `setPersonalityAlias` function rather than directly manipulating the alias map
3. Be aware that the function returns alternate aliases in the result object if collisions are handled