# 🧪 Comprehensive Discord Test Plan for Rotzot (Development Bot)

**Branch**: `feature/complete-ddd-auth-implementation`  
**PR**: #132  
**Test Environment**: Development Discord server with Rotzot bot  
**Date**: 2025-07-16

## 🎯 Test Objectives

Verify that the DDD authentication implementation and major system changes maintain full functionality while adding new blacklist capabilities.

## 🔧 Pre-Test Setup

### Environment Verification
- [X] **Bot Status**: Confirm Rotzot is online and responsive
- [X] **Channel Access**: Ensure test channels are available (both public and DM)
- [X] **Permissions**: Verify bot has appropriate permissions (Send Messages, Use Webhooks, etc.)
- [X] **Clean State**: Clear any existing authentication tokens if needed

### Test Data Preparation
- [ ] **Test User ID**: Use your Discord user ID for authentication tests
- [ ] **Invalid User ID**: Prepare a valid but non-existent Discord ID (e.g., `999999999999999999`)
- [ ] **Test Personalities**: Have 2-3 test personalities ready for interaction

## 🔐 Critical Authentication Flow Tests

### 1. Basic Authentication (Core Functionality)
**Goal**: Verify authentication system works end-to-end

#### Test Cases:
- [X] **Fresh Authentication**
  1. Use `!auth` command in DM or authorized channel
  2. Follow OAuth flow completely
  3. Verify success message received
  4. **Expected**: Authentication completes successfully

- [X] **Authentication Status Check**
  1. Run `!auth status` after authenticating
  2. **Expected**: Shows authenticated status, no mention of `lastAuthenticatedAt` or `authenticationCount`

- [X] **Re-authentication Handling**
  1. Run `!auth` again while already authenticated
  2. **Expected**: Graceful handling (either re-auth or status message)

### 2. API Endpoint Verification (Critical)
**Goal**: Ensure bot uses user's authenticated AI service, not OpenAI directly

#### Test Cases:
- [X] **Personality Interaction After Auth**
  1. Authenticate with your AI service (not OpenAI)
  2. Interact with a personality: `@personality-name hello`
  3. Monitor network traffic or logs if possible
  4. **Expected**: Bot should hit YOUR AI endpoint, not OpenAI
  5. **Critical**: This was broken in previous DDD migration

- [X] **Error Response for Unauthenticated Users**
  1. Have an unauthenticated user try to interact with personality
  2. **Expected**: Clear error message about authentication requirement

## 🚫 Blacklist Functionality Tests (New Feature)

### 3. Blacklist Command Comprehensive Testing
**Goal**: Verify all blacklist subcommands work correctly

#### Test Cases:
- [ ] **Add User to Blacklist**
  1. Use `!blacklist add @username reason for blacklisting`
  2. Use `!blacklist add 999999999999999999 test user blacklist`
  3. **Expected**: Success confirmation for both valid user ID formats

- [ ] **List Blacklisted Users**
  1. Use `!blacklist list`
  2. **Expected**: Shows previously blacklisted users with reasons and timestamps

- [ ] **Check Specific User Status**
  1. Use `!blacklist check @username` (for blacklisted user)
  2. Use `!blacklist check @yourself` (for non-blacklisted user)
  3. **Expected**: Accurate status for each user

- [ ] **Remove User from Blacklist**
  1. Use `!blacklist remove @username`
  2. Use `!blacklist list` to verify removal
  3. **Expected**: User successfully removed and no longer appears in list

- [ ] **Permission Testing**
  1. Have a non-authorized user try blacklist commands
  2. **Expected**: Permission denied message

- [ ] **Error Handling**
  1. Use `!blacklist add` without arguments
  2. Use `!blacklist check invaliduser`
  3. Use `!blacklist remove nonexistent`
  4. **Expected**: Clear error messages for each case

### 4. Blacklist Integration Testing
**Goal**: Verify blacklisted users are properly blocked from interactions

#### Test Cases:
- [ ] **Blacklisted User Interaction Blocking**
  1. Blacklist a test user
  2. Have that user try to use `!auth` or interact with personalities
  3. **Expected**: Commands should be blocked with appropriate messaging

## 🤖 Core Bot Functionality Tests (Regression Prevention)

### 5. Personality Interactions
**Goal**: Ensure existing personality features still work

#### Test Cases:
- [X] **Basic Personality Chat**
  1. Use `@personality-name hello, how are you?`
  2. **Expected**: Normal AI response via webhook with correct avatar/name

- [X] **Personality Commands**
  1. Test `!list` - view available personalities
  2. Test `!info personality-name` - get personality details
  3. Test `!add personality-name` - add new personality (if you have rights)
  4. **Expected**: All commands work as before

- [X] **Webhook Delivery**
  1. Send messages to personalities in different channels
  2. **Expected**: Responses appear as webhooks with correct formatting

### 6. Message Processing
**Goal**: Verify message handling and deduplication still work

#### Test Cases:
- [X] **Reply Handling**
  1. Reply to a bot message with a follow-up
  2. **Expected**: Bot recognizes reply context correctly

- [X] **Mention Processing**
  1. @mention the bot directly: `@Rotzot hello`
  2. **Expected**: Bot responds appropriately

- [X] **No Duplicate Responses**
  1. Send a message that might trigger multiple handlers
  2. **Expected**: Only one response received (deduplication working)

### 7. Media and Attachment Handling
**Goal**: Ensure media processing wasn't broken

#### Test Cases:
- [ ] **Image Attachments**
  1. Send an image with a personality mention
  2. **Expected**: Personality can see and respond to the image

- [ ] **Audio Processing** (if applicable)
  1. Send audio file with personality interaction
  2. **Expected**: Proper handling or error message

## 🔧 System Administration Tests

### 8. Status and Debug Commands
**Goal**: Verify admin commands work correctly

#### Test Cases:
- [ ] **Status Command**
  1. Use `!status` 
  2. **Expected**: Shows current system status, memory usage, etc.

- [X] **Debug Command** (if authorized)
  1. Use `!debug` with various options
  2. **Expected**: Returns appropriate debug information

### 9. Error Handling
**Goal**: Verify graceful error handling

#### Test Cases:
- [X] **Invalid Commands**
  1. Use `!nonexistentcommand`
  2. **Expected**: Helpful error message or ignore gracefully

- [X] **Malformed Arguments**
  1. Use commands with wrong argument types
  2. **Expected**: Clear error messages, no crashes

## 🚨 Critical Issues to Watch For

### Authentication-Related Failures
- [ ] **Bot hitting OpenAI instead of user service** (401 errors)
- [ ] **Duplicate bot responses** (same message triggering multiple AI requests)
- [ ] **Authentication failures** preventing personality interactions
- [ ] **Missing API routing** causing service connection failures

### Blacklist-Related Issues
- [ ] **Permission bypass** (non-authorized users accessing blacklist)
- [ ] **Invalid user ID handling** (crashes on malformed IDs)
- [ ] **Blacklist not blocking** (blacklisted users can still interact)

### General Functionality Issues  
- [ ] **Webhook avatar missing** (avatars not showing in Discord)
- [ ] **Message deduplication broken** (multiple responses to same message)
- [ ] **Conversation tracking lost** (bot doesn't maintain context)
- [ ] **Media handling broken** (images/audio not processed)

## 📊 Test Results Recording

### Test Execution Log
For each test case, record:
- [ ] **Pass/Fail Status**
- [ ] **Actual Behavior** (if different from expected)
- [ ] **Error Messages** (exact text if failures occur)
- [ ] **Screenshots** (for UI-related issues)

### Critical Path Results
Track these essential flows:
- [ ] **Authentication Flow**: Working / Broken
- [ ] **Personality Interaction**: Working / Broken  
- [ ] **Blacklist Commands**: Working / Broken
- [ ] **Webhook Delivery**: Working / Broken

## 🔄 Post-Test Actions

### If All Tests Pass
- [ ] Document any minor issues found
- [ ] Approve PR for merge to develop
- [ ] Plan production deployment

### If Critical Issues Found
- [ ] Document exact reproduction steps
- [ ] Identify which changes likely caused the issue
- [ ] Determine if rollback needed or if fix can be applied
- [ ] Update this test plan with any missing test cases

## 📝 Additional Notes

### Environment Considerations
- Test both in guild channels and DMs
- Test with multiple personality types if available
- Verify rate limiting doesn't interfere with testing

### Performance Monitoring
- Watch for unusual response times
- Check if memory usage increases significantly
- Monitor for any Discord API rate limit issues

### Data Integrity
- Verify user data is preserved during authentication flow
- Check that personality configurations remain intact
- Ensure conversation history is maintained

---

**Test Plan Version**: 1.0  
**Last Updated**: 2025-07-16  
**Next Review**: After test execution completion

> **Note**: This test plan focuses on verifying the specific changes made in this PR while ensuring no regression in existing functionality. Pay special attention to authentication flow and blacklist features as these are the primary areas of change.