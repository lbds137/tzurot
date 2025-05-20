/**
 * Documentation Reorganization Script
 * 
 * This script helps organize the documentation files according to the structure
 * defined in DOCUMENTATION_ORGANIZATION_PROPOSAL.md
 * 
 * Usage: node scripts/reorganize_docs.js
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

// Promisify fs functions
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const copyFile = util.promisify(fs.copyFile);
const stat = util.promisify(fs.stat);

// Path constants
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const TARGET_STRUCTURE = {
  'core': [
    // Core documentation files - we'll create these later
    'ARCHITECTURE.md',
    'SETUP.md',
    'CONTRIBUTING.md',
    'CODING_STANDARDS.md',
    'SECURITY.md',
    'DEPLOYMENT.md'
  ],
  'components': [
    // Component documentation
    'IMAGE_HANDLING.md',
    'PLURALKIT_PROXY_HANDLING.md',
    'PROBLEMATIC_PERSONALITIES.md',
    'DISPLAY_NAME_ALIASES.md'
  ],
  'testing': [
    // Testing documentation
    'MANUAL_TESTING_PROCEDURE.md',
    'SIMULATED_TESTS_SUMMARY.md',
    'TEST_FIX_SUMMARY.md',
    'TEST_MIGRATION_PLAN.md',
    'TEST_MIGRATION_STATUS.md',
    'TEST_PERSONALITIES_CLEANUP.md',
    'TEST_STANDARDIZATION.md',
    'COMMANDLOADER_TEST_APPROACH.md'
  ],
  'history': {
    'command': [
      'ACTIVATE_COMMAND_FIX.md',
      'ACTIVATED_PERSONALITY_COMMANDS_FIX.md',
      'ADD_COMMAND_DEDUPLICATION_FIX.md',
      'ADD_COMMAND_FIXES_SUMMARY.md',
      'ADD_COMMAND_NULL_DISPLAYNAME_FIX.md',
      'COMMAND_REFACTORING_SUMMARY.md',
      'COMMAND_SYSTEM.md',
      'COMMAND_TEST_STANDARDIZATION.md',
      'COMMAND_TEST_STATUS.md',
      'LIST_COMMAND_FIX.md',
      'PERSONALITY_READD_FIX.md'
    ],
    'webhook': [
      'ACTIVATED_PERSONALITY_WEBHOOK_FIX.md',
      'WEBHOOK_AUTH_BYPASS_FIX.md',
      'WEBHOOK_PROXY_FIX_SUMMARY.md',
      'WEBHOOK_PROXY_HANDLING.md',
      'WEBHOOK_REPLY_AUTH_FIX.md'
    ],
    'auth': [
      'AISERVICE_AUTH_BYPASS_FIX.md',
      'AUTHENTICATION_SECURITY_ENHANCEMENT.md',
      'AUTH_LEAK_FIX.md',
      'AUTH_SECURITY_ENHANCEMENTS.md',
      'USER_AUTHORIZATION.md'
    ],
    'deduplication': [
      'DEDUPLICATION_MONITORING.md',
      'DEDUPLICATION_REFACTOR_SUMMARY.md',
      'MESSAGE_DEDUPLICATION_REFACTOR.md',
      'MESSAGE_DEDUPLICATION_UPDATE_PLAN.md',
      'IMPROVED_THREAD_MESSAGE_FIX.md',
      'REFERENCED_MESSAGE_IMPROVEMENTS.md',
      'THREAD_MESSAGE_FIX.md',
      'REFERENCE_VARIABLE_SCOPE_FIX.md',
      'SYSTEM_PROMPT_ARTIFACT_FIX.md'
    ],
    'general': [
      'PR_DESCRIPTION.md'
    ]
  },
  'improvements': [
    'CODE_IMPROVEMENT_OPPORTUNITIES.md',
    'CODE_CLEANUP_RECOMMENDATIONS.md',
    'COMPLETED_CODE_CLEANUP.md',
    'DOCUMENTATION_ORGANIZATION_PROPOSAL.md',
    'MULTI_USER_SCALABILITY.md'
  ]
};

// File mappings
const FILE_MAPPINGS = {
  // Map original file paths to new locations
};

/**
 * Creates the directory structure for the new documentation organization
 */
async function createDirectoryStructure() {
  console.log('Creating directory structure...');
  
  // Create main category directories
  for (const category of Object.keys(TARGET_STRUCTURE)) {
    const categoryPath = path.join(DOCS_DIR, category);
    await mkdir(categoryPath, { recursive: true });
    console.log(`Created directory: ${categoryPath}`);
    
    // Create subdirectories for nested categories
    if (typeof TARGET_STRUCTURE[category] === 'object' && !Array.isArray(TARGET_STRUCTURE[category])) {
      for (const subcategory of Object.keys(TARGET_STRUCTURE[category])) {
        const subcategoryPath = path.join(categoryPath, subcategory);
        await mkdir(subcategoryPath, { recursive: true });
        console.log(`Created directory: ${subcategoryPath}`);
      }
    }
  }
}

/**
 * Analyzes and categorizes existing documentation files
 */
async function analyzeExistingDocs() {
  console.log('Analyzing existing documentation...');
  
  const files = await readdir(DOCS_DIR);
  const mdFiles = files.filter(file => file.endsWith('.md'));
  
  console.log(`Found ${mdFiles.length} markdown files.`);
  
  // Analyze files for potential categorization
  for (const file of mdFiles) {
    // Skip the proposal document itself
    if (file === 'DOCUMENTATION_ORGANIZATION_PROPOSAL.md') {
      continue;
    }
    
    const filePath = path.join(DOCS_DIR, file);
    const content = await readFile(filePath, 'utf8');
    const stats = await stat(filePath);
    
    // Analyze content to guess category
    let category = guessCategory(file, content);
    
    console.log(`File: ${file}`);
    console.log(`  Category: ${category}`);
    console.log(`  Last modified: ${stats.mtime}`);
    console.log(`  Size: ${stats.size} bytes`);
    console.log('');
  }
}

/**
 * Attempts to guess the appropriate category for a file
 * @param {string} filename - The filename
 * @param {string} content - The file content
 * @returns {string} The guessed category
 */
function guessCategory(filename, content) {
  // Check if file is directly in a target category
  for (const [category, files] of Object.entries(TARGET_STRUCTURE)) {
    if (Array.isArray(files) && files.includes(filename)) {
      return category;
    }
    
    // Check nested categories
    if (typeof files === 'object' && !Array.isArray(files)) {
      for (const [subcategory, subfiles] of Object.entries(files)) {
        if (subfiles.includes(filename)) {
          return `${category}/${subcategory}`;
        }
      }
    }
  }
  
  // Try to infer from filename
  if (filename.includes('COMMAND') || filename.includes('PERSONALITY')) {
    return 'history/command';
  } else if (filename.includes('WEBHOOK')) {
    return 'history/webhook';
  } else if (filename.includes('AUTH')) {
    return 'history/auth';
  } else if (filename.includes('DEDUPLICATION') || filename.includes('MESSAGE') || 
             filename.includes('THREAD') || filename.includes('REFERENCE')) {
    return 'history/deduplication';
  } else if (filename.includes('TEST')) {
    return 'testing';
  } else if (filename.includes('CODE') || filename.includes('IMPROVEMENT') || 
             filename.includes('DOCUMENTATION') || filename.includes('SCALABILITY')) {
    return 'improvements';
  } else if (filename.includes('IMAGE') || filename.includes('PROXY') || 
             filename.includes('PROBLEMATIC') || filename.includes('DISPLAY')) {
    return 'components';
  } else if (filename.includes('PR_DESCRIPTION')) {
    return 'history/general';
  } else if (filename.includes('SYSTEM_PROMPT')) {
    return 'history/deduplication';
  }
  
  return 'unsorted';
}

/**
 * Creates index files for each category
 */
async function createIndexFiles() {
  console.log('Creating index files...');
  
  for (const category of Object.keys(TARGET_STRUCTURE)) {
    const categoryPath = path.join(DOCS_DIR, category);
    const indexPath = path.join(categoryPath, 'README.md');
    
    // Create basic index content
    let indexContent = `# ${category.charAt(0).toUpperCase() + category.slice(1)} Documentation\n\n`;
    indexContent += `This directory contains documentation related to ${category}.\n\n`;
    indexContent += '## Files in this category\n\n';
    
    // Add list of files if they're directly in this category
    if (Array.isArray(TARGET_STRUCTURE[category])) {
      for (const file of TARGET_STRUCTURE[category]) {
        indexContent += `- [${file.replace('.md', '')}](${file})\n`;
      }
    }
    
    // Handle subcategories
    if (typeof TARGET_STRUCTURE[category] === 'object' && !Array.isArray(TARGET_STRUCTURE[category])) {
      indexContent += '## Subcategories\n\n';
      
      for (const subcategory of Object.keys(TARGET_STRUCTURE[category])) {
        indexContent += `- [${subcategory}](${subcategory}/)\n`;
      }
    }
    
    await writeFile(indexPath, indexContent, 'utf8');
    console.log(`Created index file: ${indexPath}`);
  }
}

/**
 * Creates template core documentation files
 */
async function createCoreDocumentation() {
  console.log('Creating core documentation templates...');
  
  const coreTemplates = {
    'ARCHITECTURE.md': `# System Architecture

## Overview

Tzurot is a Discord bot that uses webhooks to represent multiple AI personalities. It allows users to add personalities and interact with them through Discord channels.

## Core Components

1. **Bot** - Main entry point for Discord interaction
2. **Personality Manager** - Manages AI personalities
3. **Webhook Manager** - Handles Discord webhooks for personality messages
4. **AI Service** - Interface with the AI API
5. **Conversation Manager** - Tracks active conversations
6. **Commands** - Processes Discord commands
7. **Profile Info Fetcher** - Fetches profile information

## Data Flow

1. User sends message to Discord
2. Discord.js client receives message event
3. Message is processed by bot.js
4. AI response is generated via aiService.js
5. Response is sent via webhook using webhookManager.js
6. Conversation data is recorded in conversationManager.js

## Component Relationships

(Describe how components interact with each other)

## Key Design Patterns

1. **Error Prevention**
2. **Caching**
3. **Modular Architecture**
`,
    'SETUP.md': `# Development Setup

## Prerequisites

- Node.js 16+
- A Discord bot token
- API keys for the AI service

## Installation

1. Clone the repository
2. Run \`npm install\`
3. Create a \`.env\` file with required environment variables
4. Run \`npm run dev\` to start in development mode

## Environment Variables

- \`DISCORD_TOKEN\` - Discord bot token
- (List other required environment variables)

## Development Commands

- \`npm start\` - Start in production mode
- \`npm run dev\` - Start with hot reloading
- \`npm test\` - Run tests
- \`npm run lint\` - Check code style
`,
    'CONTRIBUTING.md': `# Contributing Guidelines

## Getting Started

1. Fork the repository
2. Set up your development environment
3. Make your changes
4. Write or update tests
5. Submit a pull request

## Code Style

Follow the existing code style in the project. Use the provided ESLint and Prettier configurations.

## Testing

All changes should be accompanied by tests. Run the existing test suite to ensure you haven't broken anything.

## Pull Request Process

1. Update documentation if needed
2. Make sure all tests pass
3. Request review from maintainers
4. Address review comments
`,
    'CODING_STANDARDS.md': `# Coding Standards

## JavaScript Style Guide

This project follows a consistent coding style. Here are the key guidelines:

- Use 2 spaces for indentation
- Use camelCase for variables and functions
- Use PascalCase for classes
- Use single quotes for strings
- Always use semicolons
- Limit line length to 100 characters

## Error Handling

- Use try/catch blocks around async operations
- Log all errors with appropriate context
- Don't swallow errors (empty catch blocks)

## Documentation

- Use JSDoc comments for exported functions
- Keep comments up to date with code changes
- Document non-obvious code sections

## Testing

- Write tests for all new functionality
- Maintain existing test coverage
`,
    'SECURITY.md': `# Security Guidelines

## Authentication

- Always validate user permissions before executing commands
- Use proper authentication for external API calls
- Store API keys securely

## Data Handling

- Don't log sensitive information
- Validate all user input
- Sanitize data before sending to external services

## Known Issues

(Document any known security issues)

## Reporting Security Issues

(Instructions for reporting security issues)
`,
    'DEPLOYMENT.md': `# Deployment Guidelines

## Prerequisites

- Node.js 16+
- Required environment variables

## Deployment Steps

1. Clone the repository
2. Install dependencies with \`npm install --production\`
3. Set up environment variables
4. Start the application with \`npm start\`

## Environment Variables

- \`DISCORD_TOKEN\` - Discord bot token
- (List other required environment variables)

## Monitoring

- Monitor the application logs for errors
- Set up health checks

## Troubleshooting

(Common deployment issues and solutions)
`
  };
  
  // Create each core documentation file
  for (const [filename, content] of Object.entries(coreTemplates)) {
    const filePath = path.join(DOCS_DIR, 'core', filename);
    await writeFile(filePath, content, 'utf8');
    console.log(`Created template documentation: ${filePath}`);
  }
}

/**
 * Move file to new location
 * @param {string} sourceFile - Source file path
 * @param {string} targetFile - Target file path
 */
async function moveDocFile(sourceFile, targetFile) {
  try {
    // First ensure the target directory exists
    const targetDir = path.dirname(targetFile);
    await mkdir(targetDir, { recursive: true });
    
    // Copy the file to its new location
    await copyFile(sourceFile, targetFile);
    
    // Delete the original file
    fs.unlinkSync(sourceFile);
    
    console.log(`Moved: ${sourceFile} -> ${targetFile}`);
  } catch (error) {
    console.error(`Error moving ${sourceFile} to ${targetFile}:`, error.message);
  }
}

/**
 * Move all documentation files to their new locations
 */
async function moveFiles() {
  console.log('Moving files to new locations...');
  
  const files = await readdir(DOCS_DIR);
  const mdFiles = files.filter(file => file.endsWith('.md'));
  
  // Keep track of files we'll need to process specially
  const specialFiles = [
    'DOCUMENTATION_ORGANIZATION_PROPOSAL.md', // Organization proposal should be moved to improvements
    'CODE_IMPROVEMENT_OPPORTUNITIES.md', // This should be moved last
    'README.md' // We'll handle the root README.md separately
  ];
  
  // Count of files moved
  let movedCount = 0;
  let skippedCount = 0;
  
  // Process each file
  for (const file of mdFiles) {
    // Skip special files for now - we'll handle them later
    if (specialFiles.includes(file)) {
      console.log(`Skipping special file for now: ${file}`);
      continue;
    }
    
    const sourcePath = path.join(DOCS_DIR, file);
    
    // Get the category
    const content = await readFile(sourcePath, 'utf8');
    const category = guessCategory(file, content);
    
    if (category === 'unsorted') {
      console.log(`Skipping unsorted file: ${file}`);
      skippedCount++;
      continue;
    }
    
    // Determine target path
    let targetPath;
    if (category.includes('/')) {
      // Handle nested categories
      const [mainCategory, subCategory] = category.split('/');
      targetPath = path.join(DOCS_DIR, mainCategory, subCategory, file);
    } else {
      targetPath = path.join(DOCS_DIR, category, file);
    }
    
    // Move the file to the new location
    await moveDocFile(sourcePath, targetPath);
    movedCount++;
  }
  
  // Handle the special files
  console.log('\nHandling special files:');
  
  // Move the documentation organization proposal
  if (files.includes('DOCUMENTATION_ORGANIZATION_PROPOSAL.md')) {
    const sourcePath = path.join(DOCS_DIR, 'DOCUMENTATION_ORGANIZATION_PROPOSAL.md');
    const targetPath = path.join(DOCS_DIR, 'improvements', 'DOCUMENTATION_ORGANIZATION_PROPOSAL.md');
    await moveDocFile(sourcePath, targetPath);
    movedCount++;
  }
  
  // Move CODE_IMPROVEMENT_OPPORTUNITIES.md
  if (files.includes('CODE_IMPROVEMENT_OPPORTUNITIES.md')) {
    const sourcePath = path.join(DOCS_DIR, 'CODE_IMPROVEMENT_OPPORTUNITIES.md');
    const targetPath = path.join(DOCS_DIR, 'improvements', 'CODE_IMPROVEMENT_OPPORTUNITIES.md');
    await moveDocFile(sourcePath, targetPath);
    movedCount++;
  }
  
  // Create README.md that points to the new structure
  const readmePath = path.join(DOCS_DIR, 'README.md');
  const readmeContent = `# Documentation

This directory contains documentation for the Tzurot project. The documentation is organized into the following categories:

## Core Documentation
- [Architecture](core/ARCHITECTURE.md) - Overall system architecture
- [Setup](core/SETUP.md) - Development environment setup
- [Contributing](core/CONTRIBUTING.md) - Contribution guidelines
- [Coding Standards](core/CODING_STANDARDS.md) - Code style and patterns
- [Security](core/SECURITY.md) - Security practices
- [Deployment](core/DEPLOYMENT.md) - Deployment procedures

## Component Documentation
- [Component Details](components/) - Documentation for specific components

## Testing Documentation
- [Testing Information](testing/) - Testing approaches and guidelines

## Historical Records
- [Command System](history/command/) - Command system development history
- [Webhook System](history/webhook/) - Webhook system development history
- [Authentication](history/auth/) - Authentication-related development history
- [Deduplication](history/deduplication/) - Message deduplication development history

## Improvement Proposals
- [Code Improvements](improvements/) - Code improvement opportunities and proposals

For more information on the documentation organization, see [Documentation Organization Proposal](improvements/DOCUMENTATION_ORGANIZATION_PROPOSAL.md).
`;

  await writeFile(readmePath, readmeContent, 'utf8');
  console.log(`Created main README.md with navigation links`);
  
  console.log(`\nMoved ${movedCount} files, skipped ${skippedCount} files.`);
}

/**
 * Main execution function
 */
async function main() {
  // Set to true to actually reorganize files
  const PERFORM_REORGANIZATION = true;
  
  try {
    // Always perform analysis first
    console.log('DOCUMENTATION REORGANIZATION');
    console.log('===========================================');
    
    if (!PERFORM_REORGANIZATION) {
      console.log('ANALYSIS MODE: This is an analysis only. No files will be moved.');
      console.log('');
      
      await analyzeExistingDocs();
      
      console.log('');
      console.log('Analysis complete!');
      console.log('To perform the actual reorganization, edit this script to set PERFORM_REORGANIZATION = true');
    } else {
      console.log('EXECUTION MODE: Files will be reorganized.');
      console.log('');
      
      // First, analyze the docs
      await analyzeExistingDocs();
      
      // Create the directory structure
      await createDirectoryStructure();
      
      // Create core documentation templates
      await createCoreDocumentation();
      
      // Create index files for each category
      await createIndexFiles();
      
      // Move files to their new locations
      await moveFiles();
      
      console.log('');
      console.log('Documentation reorganization complete!');
    }
  } catch (error) {
    console.error('Error during documentation reorganization:', error);
  }
}

// Execute the script
main();