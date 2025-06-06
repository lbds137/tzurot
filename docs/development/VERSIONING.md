# Versioning Strategy

This document outlines the versioning strategy for the Tzurot Discord bot.

## Semantic Versioning

We follow [Semantic Versioning 2.0.0](https://semver.org/) with the format `MAJOR.MINOR.PATCH`:

- **MAJOR** version when we make incompatible changes that disrupt user experience
- **MINOR** version when we add functionality in a backwards compatible manner
- **PATCH** version when we make backwards compatible bug fixes

## Discord Bot-Specific Versioning Guidelines

For a Discord bot, the definition of "breaking changes" focuses on user-facing features and data persistence, not internal implementation details.

### What Constitutes a Breaking Change (MAJOR)?

**1. Data Storage Changes (without migration)**
- Personality data format changes that prevent old personalities from loading
- Conversation history format changes that lose existing history
- Authentication data changes that require users to re-authenticate
- Any failed migration that leaves users in a broken state

**2. Command Interface Changes**
- Removing commands entirely
- Changing command syntax incompatibly (e.g., `!tz add` → `!tz personality create` without alias)
- Changing required vs optional parameters
- Renaming commands without maintaining aliases

**3. Permission/Access Changes**
- Changing who can use certain commands
- Adding authentication requirements to previously public commands
- Modifying personality ownership rules

**4. Feature Removals**
- Removing support for media types (audio, images)
- Dropping features users depend on
- Removing personality capabilities (aliases, custom error messages, etc.)

### What Are New Features (MINOR)?

**1. New Functionality**
- Adding new commands
- Adding new personality features (with sensible defaults)
- Supporting new media types or Discord features
- Adding optional parameters to existing commands

**2. Backwards-Compatible Improvements**
- New notification systems (like release notifications)
- Additional customization options
- New integrations or services
- Performance improvements with new features

**3. Deprecations (with maintained compatibility)**
- Marking features for future removal
- Adding new preferred alternatives while keeping old ones

### What Are Bug Fixes (PATCH)?

**1. Bug Fixes**
- Fixing error handling
- Correcting personality behavior
- Resolving media handling issues
- Fixing rate limiting problems

**2. Performance Improvements**
- Optimizing existing features
- Reducing memory usage
- Improving response times

**3. Documentation & Logging**
- Improving error messages
- Better logging
- Documentation updates
- UI/UX improvements (embed formatting)

**4. Internal Refactoring**
- Code structure changes
- Dependency updates (non-breaking)
- Test improvements
- Development tooling updates

### Implementation Details Are NOT Breaking Changes

The following are NOT considered breaking changes:
- Internal refactoring
- Changing AI service providers (if functionality remains)
- Optimizing algorithms
- Modifying internal APIs
- Changing library implementations

## Version Locations

The version number is maintained in the following locations:
1. `package.json` - The source of truth for the current version
2. `CHANGELOG.md` - Documents all changes for each version

## Release Process

1. Create a release branch: `release/vX.Y.Z`
2. Update version in `package.json`
3. Update `CHANGELOG.md` with all changes since last release
4. Create PR from release branch to main
5. After merge, create a GitHub release with the same version tag
6. Sync develop with main: `git sync-develop`

## Version History

- **v1.2.0** (2025-01-06) - First properly versioned release with critical bug fixes
- **v0.1.0** - Initial release

## Decision Tree

When preparing a release, ask:

1. **Will existing users need to take action?**
   - YES → MAJOR version
   - NO → Continue...

2. **Are we adding new functionality?**
   - YES → MINOR version
   - NO → Continue...

3. **Are we fixing bugs or improving existing features?**
   - YES → PATCH version

## Examples

### Major Version Examples (Breaking)
```
1.0.0 → 2.0.0
- Changed personality storage format without migration
- Removed !tz add command entirely
- Required authentication for all personality commands
```

### Minor Version Examples (Features)
```
1.0.0 → 1.1.0
- Added release notification system
- Added NSFW channel support
- Added new !tz notifications command
- Added support for voice message transcription
```

### Patch Version Examples (Fixes)
```
1.0.0 → 1.0.1
- Fixed personality error messages not showing
- Fixed webhook caching memory leak
- Improved rate limit handling
- Fixed typo in help command
```

## Pre-release Versions

For testing releases, use pre-release identifiers:
- Alpha: `1.3.0-alpha.1`
- Beta: `1.3.0-beta.1`
- Release Candidate: `1.3.0-rc.1`

## Best Practices

1. **Always Provide Migrations**
   - For data format changes, include automatic migration
   - Test migrations thoroughly
   - Provide rollback procedures

2. **Deprecation Policy**
   - Announce deprecations in MINOR releases
   - Provide at least one MINOR release cycle before removal
   - Include clear migration paths in documentation

3. **Backwards Compatibility**
   - Maintain command aliases when renaming
   - Provide sensible defaults for new fields
   - Keep old configuration formats working when possible

4. **Clear Communication**
   - Document all changes in CHANGELOG.md
   - Highlight breaking changes prominently
   - Provide upgrade guides for major versions

5. **When In Doubt**
   - Consider the user impact
   - Err on the side of caution
   - Ask: "Will this surprise or frustrate existing users?"
   - Consult with other maintainers