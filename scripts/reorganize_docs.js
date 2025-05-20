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
    // Core documentation files
  ],
  'components': [
    // Component documentation
  ],
  'testing': [
    // Testing documentation
  ],
  'history': {
    'command': [
      'ACTIVATE_COMMAND_FIX.md',
      'ACTIVATED_PERSONALITY_COMMANDS_FIX.md',
      'ADD_COMMAND_DEDUPLICATION_FIX.md',
      'ADD_COMMAND_FIXES_SUMMARY.md',
      'ADD_COMMAND_NULL_DISPLAYNAME_FIX.md',
      'COMMAND_REFACTORING_SUMMARY.md',
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
      'MESSAGE_DEDUPLICATION_UPDATE_PLAN.md'
    ]
  },
  'improvements': [
    'CODE_IMPROVEMENT_OPPORTUNITIES.md',
    'CODE_CLEANUP_RECOMMENDATIONS.md',
    'COMPLETED_CODE_CLEANUP.md'
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
  } else if (filename.includes('DEDUPLICATION') || filename.includes('MESSAGE')) {
    return 'history/deduplication';
  } else if (filename.includes('TEST')) {
    return 'testing';
  } else if (filename.includes('CODE') || filename.includes('IMPROVEMENT')) {
    return 'improvements';
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
 * Main execution function
 */
async function main() {
  try {
    // Perform a dry run first (analysis only)
    console.log('DOCUMENTATION REORGANIZATION - ANALYSIS MODE');
    console.log('===========================================');
    console.log('This is an analysis only. No files will be moved yet.');
    console.log('');
    
    await analyzeExistingDocs();
    
    console.log('');
    console.log('Analysis complete!');
    console.log('To perform the actual reorganization, edit this script to set DRY_RUN = false');
    
    // Uncomment the lines below to actually perform the reorganization
    // await createDirectoryStructure();
    // await createIndexFiles();
    // console.log('Documentation reorganization complete!');
  } catch (error) {
    console.error('Error during documentation reorganization:', error);
  }
}

// Execute the script
main();