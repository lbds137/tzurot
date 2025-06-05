# Versioning Strategy

This document outlines the versioning strategy for the Tzurot Discord bot.

## Semantic Versioning

We follow [Semantic Versioning 2.0.0](https://semver.org/) with the format `MAJOR.MINOR.PATCH`:

- **MAJOR** version when we make incompatible API changes
- **MINOR** version when we add functionality in a backwards compatible manner
- **PATCH** version when we make backwards compatible bug fixes

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

## Examples

### Patch Release (Bug Fixes)
- Fixing a bug in command processing: `1.2.0` → `1.2.1`
- Correcting error messages: `1.2.1` → `1.2.2`

### Minor Release (New Features)
- Adding new commands: `1.2.0` → `1.3.0`
- Adding new personality features: `1.3.0` → `1.4.0`

### Major Release (Breaking Changes)
- Changing command syntax: `1.2.0` → `2.0.0`
- Restructuring personality data format: `2.0.0` → `3.0.0`

## Pre-release Versions

For testing releases, use pre-release identifiers:
- Alpha: `1.3.0-alpha.1`
- Beta: `1.3.0-beta.1`
- Release Candidate: `1.3.0-rc.1`