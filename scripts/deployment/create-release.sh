#!/bin/bash

# GitHub Release Creation Script for Tzurot
# Usage: ./scripts/create-release.sh [version] [--dry-run]
# Example: ./scripts/create-release.sh v1.0.0

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if version parameter is provided
if [ $# -eq 0 ]; then
    print_error "Version parameter is required!"
    echo "Usage: $0 <version> [--dry-run]"
    echo "Example: $0 v1.0.0"
    echo "         $0 v1.1.0 --dry-run"
    exit 1
fi

VERSION="$1"
DRY_RUN=false

# Check for dry-run flag
if [ "$2" = "--dry-run" ]; then
    DRY_RUN=true
    print_warning "DRY RUN MODE - No actual release will be created"
fi

# Validate version format (should start with 'v')
if [[ ! $VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid version format! Use format: v1.0.0"
    exit 1
fi

# Extract version number without 'v' prefix
VERSION_NUMBER="${VERSION#v}"

print_info "Creating GitHub release for $VERSION"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    print_error "Must be on main branch to create release. Current branch: $CURRENT_BRANCH"
    print_info "Run: git checkout main && git pull origin main"
    exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    print_error "Working directory is not clean. Please commit or stash changes."
    git status --short
    exit 1
fi

# Check if we have the latest changes
print_info "Checking if local main is up to date..."
git fetch origin main
LOCAL_COMMIT=$(git rev-parse main)
REMOTE_COMMIT=$(git rev-parse origin/main)

if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    print_error "Local main branch is not up to date with remote."
    print_info "Run: git pull origin main"
    exit 1
fi

# Check if version matches package.json
PACKAGE_VERSION=$(grep '"version"' package.json | sed 's/.*"version": "\(.*\)".*/\1/')
if [ "$VERSION_NUMBER" != "$PACKAGE_VERSION" ]; then
    print_error "Version mismatch!"
    echo "  Script version: $VERSION_NUMBER"
    echo "  package.json:   $PACKAGE_VERSION"
    print_info "Make sure package.json version matches the release version"
    exit 1
fi

# Check if CHANGELOG.md exists and contains the version
if [ ! -f "CHANGELOG.md" ]; then
    print_error "CHANGELOG.md not found!"
    exit 1
fi

if ! grep -q "## \[$VERSION_NUMBER\]" CHANGELOG.md; then
    print_error "Version $VERSION_NUMBER not found in CHANGELOG.md"
    print_info "Make sure CHANGELOG.md contains an entry for this version"
    exit 1
fi

# Check if tag already exists
if git tag -l | grep -q "^$VERSION$"; then
    print_error "Tag $VERSION already exists!"
    print_info "Use a different version or delete the existing tag"
    exit 1
fi

# Check if GitHub CLI is available
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed!"
    print_info "Install it with: brew install gh (macOS) or apt install gh (Ubuntu)"
    exit 1
fi

# Check if user is authenticated with GitHub CLI
if ! gh auth status &> /dev/null; then
    print_error "Not authenticated with GitHub CLI!"
    print_info "Run: gh auth login"
    exit 1
fi

# Extract release notes from CHANGELOG.md
print_info "Extracting release notes from CHANGELOG.md..."

# Create temporary file for release notes
TEMP_NOTES=$(mktemp)

# Extract content between the version header and the next version header
awk "
/^## \[$VERSION_NUMBER\]/ { found=1; next }
/^## \[/ && found { exit }
found && /^[^#]/ { print }
found && /^### / { print }
" CHANGELOG.md > "$TEMP_NOTES"

# Check if we got any content
if [ ! -s "$TEMP_NOTES" ]; then
    print_error "Could not extract release notes for version $VERSION_NUMBER from CHANGELOG.md"
    rm -f "$TEMP_NOTES"
    exit 1
fi

# Show what we're about to do
print_info "Release Summary:"
echo "  Version: $VERSION"
echo "  Target: main branch"
echo "  Commit: $(git rev-parse --short HEAD)"
echo ""
print_info "Release Notes Preview:"
echo "$(head -10 "$TEMP_NOTES")"
if [ $(wc -l < "$TEMP_NOTES") -gt 10 ]; then
    echo "  ... (truncated)"
fi
echo ""

# Confirm before proceeding (unless dry run)
if [ "$DRY_RUN" = false ]; then
    read -p "Create release $VERSION? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Release creation cancelled"
        rm -f "$TEMP_NOTES"
        exit 0
    fi
fi

# Create the GitHub release
if [ "$DRY_RUN" = true ]; then
    print_success "DRY RUN: Would create release $VERSION with the following command:"
    echo "gh release create $VERSION \\"
    echo "  --title \"$VERSION - Release\" \\"
    echo "  --notes-file \"$TEMP_NOTES\" \\"
    echo "  --target main"
else
    print_info "Creating GitHub release..."
    
    # Determine release title from changelog
    RELEASE_TITLE=$(grep "^## \[$VERSION_NUMBER\]" CHANGELOG.md | sed "s/## \[$VERSION_NUMBER\] - [0-9-]*//" | xargs)
    if [ -z "$RELEASE_TITLE" ]; then
        RELEASE_TITLE="Release"
    fi
    
    gh release create "$VERSION" \
        --title "$VERSION - $RELEASE_TITLE" \
        --notes-file "$TEMP_NOTES" \
        --target main
    
    if [ $? -eq 0 ]; then
        print_success "GitHub release $VERSION created successfully!"
        print_info "View at: https://github.com/$(gh repo view --json owner,name -q '.owner.login + "/" + .name')/releases/tag/$VERSION"
        
        # Remind about develop sync
        print_warning "Remember to sync develop branch if needed:"
        echo "  git checkout main && git pull origin main"
        echo "  git sync-develop"
    else
        print_error "Failed to create GitHub release"
        exit 1
    fi
fi

# Cleanup
rm -f "$TEMP_NOTES"

print_success "Release process completed!"