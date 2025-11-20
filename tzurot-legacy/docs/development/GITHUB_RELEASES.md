# GitHub Releases Guide

This guide explains how to create and manage GitHub releases for Tzurot.

## What are GitHub Releases?

GitHub Releases are a way to package and deliver software versions to users. They:

- Create git tags automatically
- Provide downloadable archives of your code
- Display release notes prominently
- Show up in the repository's main page

## Creating a Release

### Method 1: GitHub Web Interface

1. Go to the repository on GitHub
2. Click on "Releases" (on the right side)
3. Click "Create a new release"
4. Fill in:
   - **Tag version**: `v1.0.0` (always prefix with 'v')
   - **Target**: `main` (after PR is merged)
   - **Release title**: `v1.0.0 - First stable release`
   - **Description**: Copy from CHANGELOG.md
5. Click "Publish release"

### Method 2: Release Script (Recommended)

We have an automated script that handles the entire release process:

```bash
# After merging the release PR to main
git checkout main
git pull origin main

# Create the release (script handles validation and GitHub release)
./scripts/create-release.sh v1.0.0

# Or run in dry-run mode to see what would happen
./scripts/create-release.sh v1.0.0 --dry-run
```

The script automatically:

- Validates you're on the main branch
- Checks that package.json version matches
- Extracts release notes from CHANGELOG.md
- Creates the GitHub release with proper formatting
- Provides helpful error messages and confirmations

### Method 3: Manual GitHub CLI

If you prefer manual control:

```bash
# Create and push a tag
git checkout main
git pull origin main
git tag -a v1.0.0 -m "Release v1.0.0 - First stable release"
git push origin v1.0.0

# Create the release
gh release create v1.0.0 \
  --title "v1.0.0 - First stable release" \
  --notes-file CHANGELOG.md \
  --target main
```

## Release Description Template

Copy the relevant section from CHANGELOG.md and format it:

```markdown
## What's Changed

### ✨ Added

- Feature 1
- Feature 2

### 🐛 Fixed

- Bug fix 1
- Bug fix 2

### 🔧 Changed

- Change 1
- Change 2

**Full Changelog**: https://github.com/lbds137/tzurot/compare/v0.1.0...v1.0.0
```

## Automated Deployment

If you have deployment automation:

- Production deployments can trigger on new release tags
- Development deployments can trigger on develop branch pushes

## Best Practices

1. **Always create releases from main branch** after merging
2. **Tag format**: Always use `v` prefix (e.g., `v1.0.0`)
3. **Include changelog**: Copy relevant section from CHANGELOG.md
4. **Don't include binaries**: Let GitHub auto-generate source archives
5. **Mark pre-releases**: Use "This is a pre-release" checkbox for beta versions

## After Creating a Release

1. Verify the tag was created: `git tag -l`
2. Sync develop with main: `git sync-develop`
3. Update deployment documentation if needed
4. Announce the release (Discord, etc.)

## Example Release Notes

```markdown
## v1.0.0 - First Stable Release 🎉

After 3 weeks of development and 57 PRs, Tzurot is ready for its first stable release!

### ✨ What's New

- Personality-specific error messages for more immersive interactions
- Enhanced debug commands for easier troubleshooting
- Comprehensive test coverage

### 🐛 Critical Fixes

- Fixed add command parameter order bug (#56)
- Fixed NSFW verification for threads and forums (#57)
- Fixed NSFW verification requirement for DMs (#53)

### 📚 Documentation

- Added comprehensive versioning strategy
- Improved development workflow documentation

Thanks to all contributors! 🙏
```
