# Known Bugs and Issues

This document tracks known bugs and issues in the Tzurot Discord bot. For feature requests and improvements, see [Feature Ideas](../improvements/post-ddd/FEATURE_IDEAS.md).

## Bug Priority Classification

- **🔴 Critical**: Security issues, data loss, or features completely broken
- **🟡 High**: Core functionality impaired but has workarounds
- **🟢 Medium**: Non-critical issues affecting user experience
- **⚪ Low**: Minor issues or edge cases

## Active Bugs

### 🔴 Critical Issues

#### 1. NSFW/Authentication Bypass Bug

**Status**: Open  
**Branch**: `fix/nsfw-channel-bypass`  
**Description**: Replies in SFW channels seem to bypass NSFW check. Verified users allowed to interact in any channel regardless of NSFW settings.  
**Details**:

- Security/content filtering issue
- Need to check authentication flow in personalityHandler.js
- May involve checkPersonalityAuth function
  **Affected Files**: `src/handlers/personalityHandler.js`

### 🟡 High Priority

#### 2. Autorespond Default State Bug

**Status**: Open  
**Branch**: `fix/autorespond-default-state`  
**Description**: Autorespond turns on by itself for unknown reasons. Should be OFF by default.  
**Details**:

- Check ConversationManager initialization
- Verify default settings in conversation domain
- May need to check persistence layer
  **Affected Files**: `src/core/conversation/ConversationManager.js`

#### 3. DM Reply Quote Bug

**Status**: Open  
**Branch**: `fix/dm-reply-quotes`  
**Description**: Replying to a DM personality message always includes the quoted message instead of matching channel behavior.  
**Details**:

- Check dmHandler.js for reply logic
- Should match channel behavior for quote inclusion
  **Affected Files**: `src/handlers/dmHandler.js`

### 🟢 Medium Priority

#### 4. ~~Multi-word Tag Parsing Bug~~ ✅ FIXED

**Status**: Fixed in PR #[pending]  
**Branch**: `fix/multi-word-tag-parsing`  
**Description**: Multi-word tags like `@cash money` were broken.  
**Solution**: Updated max alias word count calculation to happen after personalities are loaded from disk.

#### 5. Image Re-upload Handling Bug

**Status**: Open  
**Branch**: `fix/image-reupload-handling`  
**Description**: Links being completely stripped out can look odd in the middle of a message when images are re-uploaded.  
**Details**:

- Check media attachment handling in messageHandler.js
- May need to preserve placeholder text when Discord re-uploads images
  **Affected Files**: `src/handlers/messageHandler.js`

#### 6. Embed Field Parsing Bug

**Status**: Open  
**Branch**: `fix/embed-field-parsing`  
**Description**: Not all embed fields are parsed correctly for links/referenced messages.  
**Details**:

- Check referenceHandler.js for embed parsing logic
- Some embed types may be missing or incorrectly parsed
  **Affected Files**: `src/handlers/referenceHandler.js`

### ⚪ Low Priority

#### 7. Purgbot Command Limit Bug

**Status**: Open  
**Branch**: `fix/purgbot-message-limit`  
**Description**: Purgbot command stops after 99 messages even if there are more.  
**Details**:

- Check purgbot personality handler
- May be Discord API limit that needs pagination
  **Affected Files**: Command implementation in purgbot handler

#### 8. Verify Command Timing Bug

**Status**: Open  
**Branch**: `fix/verify-command-timing`  
**Description**: `!tz verify` doesn't work properly if auth isn't finished.  
**Details**:

- Race condition or missing state check
- Check VerifyCommand.js implementation
  **Affected Files**: `src/application/commands/authentication/VerifyCommand.js`

## Bug Reporting Guidelines

When reporting a new bug, include:

1. **Description**: Clear, concise description of the issue
2. **Steps to Reproduce**: Exact steps to trigger the bug
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**: Discord server type, bot version, etc.
6. **Screenshots/Logs**: If applicable

## Fix Workflow

1. Create branch from `develop`: `fix/descriptive-name`
2. Implement fix with tests
3. Update this document to mark as fixed
4. Create PR to `develop` branch
5. After merge, remove from active bugs list

## Recently Fixed

- **Multi-word Tag Parsing** (Aug 2025): Fixed max alias word count calculation timing issue

## Related Documents

- [Feature Ideas](../improvements/post-ddd/FEATURE_IDEAS.md) - New feature requests
- [Issue Resolutions](ISSUE_RESOLUTIONS.md) - Historical fixes and resolutions
- [Git Workflow](GIT_AND_PR_WORKFLOW.md) - Branch and PR guidelines
