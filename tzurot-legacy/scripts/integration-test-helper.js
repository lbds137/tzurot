#!/usr/bin/env node

/**
 * Integration Test Helper
 * Helps track and validate integration testing progress
 */

const fs = require('fs');
const path = require('path');

const CHECKLIST_PATH = path.join(
  __dirname,
  '..',
  'docs',
  'migration',
  'PHASE_2_2_INTEGRATION_TESTING_CHECKLIST.md'
);

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

// Read current checklist
function readChecklist() {
  return fs.readFileSync(CHECKLIST_PATH, 'utf8');
}

// Count checked items
function countProgress(content) {
  const totalItems = (content.match(/- \[ \]/g) || []).length;
  const checkedItems = (content.match(/- \[x\]/gi) || []).length;
  return { total: totalItems + checkedItems, checked: checkedItems };
}

// Extract command tests
function extractCommandTests(content) {
  const commandSections = content.split(/####\s+\d+\.\s+/);
  const commands = [];

  commandSections.slice(1).forEach((section) => {
    const lines = section.split('\n');
    const commandMatch = lines[0].match(/(.+?)\s+\(`(.+?)`\)/);
    if (commandMatch) {
      const commandName = commandMatch[1].trim();
      const commandSyntax = commandMatch[2];
      const tests = [];

      lines.forEach((line) => {
        const testMatch = line.match(/- \[([ x])\] \*\*(.+?)\*\*: (.+)/i);
        if (testMatch) {
          tests.push({
            checked: testMatch[1].toLowerCase() === 'x',
            category: testMatch[2],
            description: testMatch[3],
          });
        }
      });

      commands.push({
        name: commandName,
        syntax: commandSyntax,
        tests,
        progress: tests.filter((t) => t.checked).length,
        total: tests.length,
      });
    }
  });

  return commands;
}

// Generate progress report
function generateReport() {
  const content = readChecklist();
  const { total, checked } = countProgress(content);
  const percentage = total > 0 ? Math.round((checked / total) * 100) : 0;
  const commands = extractCommandTests(content);

  console.log('\n📊 Integration Testing Progress Report\n');
  console.log(`Overall Progress: ${checked}/${total} (${percentage}%)`);
  console.log(createProgressBar(percentage));

  console.log('\n📋 Command Testing Status:\n');

  commands.forEach((cmd) => {
    const cmdPercentage = cmd.total > 0 ? Math.round((cmd.progress / cmd.total) * 100) : 0;
    const statusColor = cmdPercentage === 100 ? GREEN : cmdPercentage > 0 ? YELLOW : RED;
    const status = cmdPercentage === 100 ? '✅' : cmdPercentage > 0 ? '🔄' : '❌';

    console.log(`${status} ${statusColor}${cmd.name}${RESET} (${cmd.syntax})`);
    console.log(`   Progress: ${cmd.progress}/${cmd.total} tests`);

    if (cmdPercentage > 0 && cmdPercentage < 100) {
      console.log('   Remaining:');
      cmd.tests
        .filter((t) => !t.checked)
        .forEach((t) => {
          console.log(`   - ${t.category}: ${t.description}`);
        });
    }
    console.log('');
  });

  // Summary statistics
  const completeCommands = commands.filter((c) => c.progress === c.total).length;
  const inProgressCommands = commands.filter((c) => c.progress > 0 && c.progress < c.total).length;
  const notStartedCommands = commands.filter((c) => c.progress === 0).length;

  console.log('📈 Summary:');
  console.log(`${GREEN}✅ Complete: ${completeCommands} commands${RESET}`);
  console.log(`${YELLOW}🔄 In Progress: ${inProgressCommands} commands${RESET}`);
  console.log(`${RED}❌ Not Started: ${notStartedCommands} commands${RESET}`);

  // Next steps
  if (notStartedCommands > 0 || inProgressCommands > 0) {
    console.log('\n🎯 Next Steps:');
    const nextCommand = commands.find((c) => c.progress < c.total);
    if (nextCommand) {
      console.log(`Test "${nextCommand.name}" command next:`);
      console.log(`Syntax: ${BLUE}${nextCommand.syntax}${RESET}`);
      const nextTest = nextCommand.tests.find((t) => !t.checked);
      if (nextTest) {
        console.log(`Start with: ${nextTest.category} - ${nextTest.description}`);
      }
    }
  }

  console.log('\n');
}

// Create progress bar
function createProgressBar(percentage) {
  const width = 40;
  const filled = Math.round((width * percentage) / 100);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percentage}%`;
}

// Command line interface
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'progress':
  case undefined:
    generateReport();
    break;

  case 'help':
    console.log('\nIntegration Test Helper\n');
    console.log('Usage:');
    console.log('  node integration-test-helper.js [command]');
    console.log('\nCommands:');
    console.log('  progress  Show testing progress (default)');
    console.log('  help      Show this help message');
    console.log('\nTo update progress, edit:');
    console.log('  docs/migration/PHASE_2_2_INTEGRATION_TESTING_CHECKLIST.md');
    console.log('  Change [ ] to [x] for completed tests\n');
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.log('Run with "help" for usage information');
    process.exit(1);
}