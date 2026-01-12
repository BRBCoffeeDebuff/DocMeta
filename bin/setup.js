#!/usr/bin/env node
/**
 * docmeta setup - Interactive setup for DocMeta
 *
 * Usage: docmeta setup [--default]
 *
 * Guides users through:
 * - Choosing where to install MCP server config (global vs local)
 * - Default mode: auto-configures everything
 * - Advanced mode: lets users pick individual options
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const { loadConfig, saveConfig, DEFAULT_CONFIG } = require('./lib/config');
const { installSubagent } = require('./lib/subagent');
const { getIgnorePatterns } = require('./lib/ignores');

// ============================================================================
// Configuration
// ============================================================================

const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const LOCAL_SETTINGS_PATH = path.join(process.cwd(), '.claude', 'settings.local.json');
const CLAUDE_MD_PATH = path.join(process.cwd(), '.claude', 'CLAUDE.md');

// Skip CLAUDE.md installation via environment variable
const SKIP_CLAUDE_MD = process.env.DOCMETA_SKIP_CLAUDEMD === '1' || process.env.DOCMETA_SKIP_CLAUDEMD === 'true';

// Determine MCP command - use local path if available, otherwise npx
function getMcpConfig() {
  const localMcpPath = path.join(__dirname, 'mcp-server.js');

  // If running from installed package or local development, use node with absolute path
  if (fs.existsSync(localMcpPath)) {
    return {
      command: 'node',
      args: [localMcpPath]
    };
  }

  // Fallback to npx (for when package is published)
  return {
    command: 'npx',
    args: ['@brbcoffeedebuff/docmeta', 'mcp']
  };
}

// ============================================================================
// Terminal UI Helpers
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function print(msg = '') {
  console.log(msg);
}

function printHeader(msg) {
  print(`\n${colors.bright}${colors.blue}${msg}${colors.reset}\n`);
}

function printSuccess(msg) {
  print(`${colors.green}✓${colors.reset} ${msg}`);
}

function printInfo(msg) {
  print(`${colors.cyan}ℹ${colors.reset} ${msg}`);
}

function printWarning(msg) {
  print(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

// ============================================================================
// Interactive Prompts
// ============================================================================

class Prompter {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async ask(question) {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async confirm(question, defaultYes = true) {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = await this.ask(`${question} ${colors.dim}${hint}${colors.reset} `);

    if (answer === '') return defaultYes;
    return answer.toLowerCase().startsWith('y');
  }

  async select(question, options) {
    print(question);
    options.forEach((opt, i) => {
      print(`  ${colors.cyan}${i + 1}${colors.reset}) ${opt.label}`);
      if (opt.description) {
        print(`     ${colors.dim}${opt.description}${colors.reset}`);
      }
    });
    print('');

    while (true) {
      const answer = await this.ask(`Enter choice ${colors.dim}[1-${options.length}]${colors.reset}: `);
      const num = parseInt(answer, 10);

      if (num >= 1 && num <= options.length) {
        return options[num - 1].value;
      }
      print(`${colors.yellow}Please enter a number between 1 and ${options.length}${colors.reset}`);
    }
  }

  close() {
    this.rl.close();
  }
}

// ============================================================================
// Settings File Management
// ============================================================================

function readSettings(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function writeSettings(filePath, settings) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n');
}

function checkExistingConfig(filePath) {
  const settings = readSettings(filePath);
  return settings.mcpServers?.docmeta != null;
}

// ============================================================================
// Setup Actions
// ============================================================================

function installMcpServer(filePath, options = {}) {
  const settings = readSettings(filePath);

  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  const config = getMcpConfig();

  // Add cwd for local installs if requested
  if (options.includeCwd) {
    config.cwd = process.cwd();
  }

  settings.mcpServers.docmeta = config;
  writeSettings(filePath, settings);

  return true;
}

function initDocMeta() {
  // Run docmeta init in current directory
  require('./init.js');
}

function runUsedBy() {
  // Run docmeta usedby in current directory
  require('./usedby.js');
}

// ============================================================================
// CLAUDE.md Installation
// ============================================================================

const CLAUDE_MD_CONTENT = `## DocMeta Documentation

This project uses DocMeta for living documentation. Each folder with code has a \`.docmeta.json\` file.

### MANDATORY: Update Documentation After Code Changes

**You MUST invoke the \`docmeta-updater\` agent after ANY of these operations:**
- Creating new code files
- Modifying existing code files
- Deleting code files
- Changing imports or exports

**This is not optional.** Use the Task tool to spawn the docmeta-updater agent:

\`\`\`
Task tool with subagent_type: "docmeta-updater"
Prompt: "Sync documentation after [describe what you changed]"
\`\`\`

The agent will run the full workflow:
1. \`docmeta update --sync\` - Add new files, remove deleted
2. \`docmeta usedby\` - Rebuild dependency graph
3. \`docmeta check\` - Verify documentation health

### Before Modifying Code

1. Check the \`.docmeta.json\` in the target folder
2. Read the \`usedBy\` array to understand what depends on this code
3. Note any breaking changes you'll need to communicate

### Manual Commands (if not using the agent)

\`\`\`bash
docmeta update <file> --history "what changed"  # Add history entry
docmeta update <file> --purpose "description"   # Update purpose
docmeta update --sync                           # Sync with filesystem
docmeta usedby                                  # Rebuild dependencies
docmeta check                                   # Find issues
\`\`\`

### Key Insight: usedBy

The \`usedBy\` field shows your **blast radius** - what might break if you change this file.
Always check it before making breaking changes to exports.

### Why This Matters

Without documentation sync:
- New files won't have purposes filled in
- The \`usedBy\` graph becomes stale and misleading
- Future AI agents won't understand what code does
- Breaking changes go unnoticed

**The docmeta-updater agent exists precisely for this. Use it.**
`;

const CLAUDE_MD_MARKER = '## DocMeta Documentation';

/**
 * Install or update CLAUDE.md with DocMeta instructions
 * Returns: { action: 'created' | 'updated' | 'skipped', reason?: string }
 */
function installClaudeMd() {
  const dir = path.dirname(CLAUDE_MD_PATH);

  // Ensure .claude directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Check if file already exists
  if (fs.existsSync(CLAUDE_MD_PATH)) {
    const existing = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8');

    // Check if DocMeta section already present
    if (existing.includes(CLAUDE_MD_MARKER)) {
      // Replace the DocMeta section with updated content
      const lines = existing.split('\n');
      const markerIndex = lines.findIndex(line => line.includes(CLAUDE_MD_MARKER));

      if (markerIndex !== -1) {
        // Find the end of the DocMeta section (next ## header or EOF)
        let endIndex = lines.length;
        for (let i = markerIndex + 1; i < lines.length; i++) {
          if (lines[i].startsWith('## ') && !lines[i].includes('DocMeta')) {
            endIndex = i;
            break;
          }
        }

        // Replace the section
        const before = lines.slice(0, markerIndex);
        const after = lines.slice(endIndex);
        const newContent = [...before, CLAUDE_MD_CONTENT.trim(), '', ...after].join('\n');

        fs.writeFileSync(CLAUDE_MD_PATH, newContent);
        return { action: 'updated' };
      }
    }

    // No DocMeta section - append to end
    const newContent = existing.trimEnd() + '\n\n' + CLAUDE_MD_CONTENT;
    fs.writeFileSync(CLAUDE_MD_PATH, newContent);
    return { action: 'updated', reason: 'appended' };
  }

  // File doesn't exist - create it
  fs.writeFileSync(CLAUDE_MD_PATH, CLAUDE_MD_CONTENT);
  return { action: 'created' };
}

// ============================================================================
// Setup Modes
// ============================================================================

async function runDefaultSetup(prompter) {
  printHeader('DocMeta Default Setup');

  print('This will:');
  print('  1. Add DocMeta MCP server to your global Claude settings');
  print('  2. Install the docmeta-updater agent for Claude Code CLI');
  print('  3. Add DocMeta instructions to .claude/CLAUDE.md');
  print('  4. Initialize .docmeta.json files in this project');
  print('  5. Build the dependency graph');
  print('');

  const proceed = await prompter.confirm('Continue with default setup?');
  if (!proceed) {
    print('\nSetup cancelled.');
    return false;
  }

  print('');

  // Step 1: Install MCP server globally
  const globalExists = checkExistingConfig(GLOBAL_SETTINGS_PATH);
  if (globalExists) {
    printWarning('MCP server already configured in global settings');
  } else {
    installMcpServer(GLOBAL_SETTINGS_PATH);
    printSuccess(`Added MCP server to ${GLOBAL_SETTINGS_PATH}`);
  }

  // Step 2: Install subagent
  const config = loadConfig(process.cwd());
  const ignores = getIgnorePatterns(process.cwd(), {
    customIgnoreDirs: config.customIgnoreDirs,
    customIgnoreFiles: config.customIgnoreFiles,
    customIgnorePatterns: config.customIgnorePatterns,
  });
  const subagentResult = installSubagent(process.cwd(), {
    ignoreDirs: ignores.dirs,
    ignoreFiles: ignores.files,
  });

  for (const file of subagentResult.created) {
    printSuccess(`Created ${file}`);
  }
  for (const file of subagentResult.updated) {
    printSuccess(`Updated ${file}`);
  }
  for (const file of subagentResult.skipped) {
    printInfo(`Skipped ${file}`);
  }

  // Step 3: Install CLAUDE.md
  if (!SKIP_CLAUDE_MD) {
    const claudeMdResult = installClaudeMd();
    if (claudeMdResult.action === 'created') {
      printSuccess(`Created ${CLAUDE_MD_PATH}`);
    } else if (claudeMdResult.action === 'updated') {
      printSuccess(`Updated DocMeta section in ${CLAUDE_MD_PATH}`);
    }
  } else {
    printInfo('Skipped CLAUDE.md (DOCMETA_SKIP_CLAUDEMD set)');
  }

  // Step 4: Init docmeta
  print('');
  process.argv = ['node', 'init.js', '.'];
  initDocMeta();

  // Step 5: Run usedby
  process.argv = ['node', 'usedby.js', '.'];
  runUsedBy();

  printHeader('Setup Complete!');
  print(`${colors.yellow}Start a new Claude Code session${colors.reset} to load the agent and MCP server.`);
  print('');
  print('After restarting, Claude will have:');
  print('  - MCP tools: docmeta_lookup, docmeta_blast_radius, docmeta_search');
  print('  - docmeta-updater agent for automatic documentation updates');
  print('');
  print(`${colors.dim}Tip: File purposes will be filled in automatically as you work.${colors.reset}`);
  print('');

  return true;
}

async function runAdvancedSetup(prompter) {
  printHeader('DocMeta Advanced Setup');

  // Step 1: MCP Server Location
  print('');
  const mcpChoice = await prompter.select('Where would you like to install the MCP server?', [
    {
      value: 'global',
      label: 'Global (recommended)',
      description: `Adds to ~/.claude/settings.json - works for all projects`
    },
    {
      value: 'local',
      label: 'This project only',
      description: `Adds to .claude/settings.local.json in current directory`
    },
    {
      value: 'both',
      label: 'Both global and local',
      description: 'Install in both locations'
    },
    {
      value: 'skip',
      label: 'Skip MCP setup',
      description: `I'll configure it manually later`
    }
  ]);

  // Install MCP based on choice
  if (mcpChoice === 'global' || mcpChoice === 'both') {
    const exists = checkExistingConfig(GLOBAL_SETTINGS_PATH);
    if (exists) {
      const overwrite = await prompter.confirm('Global MCP config already exists. Overwrite?', false);
      if (overwrite) {
        installMcpServer(GLOBAL_SETTINGS_PATH);
        printSuccess(`Updated ${GLOBAL_SETTINGS_PATH}`);
      } else {
        printInfo('Skipped global config');
      }
    } else {
      installMcpServer(GLOBAL_SETTINGS_PATH);
      printSuccess(`Added MCP server to ${GLOBAL_SETTINGS_PATH}`);
    }
  }

  if (mcpChoice === 'local' || mcpChoice === 'both') {
    const exists = checkExistingConfig(LOCAL_SETTINGS_PATH);
    if (exists) {
      const overwrite = await prompter.confirm('Local MCP config already exists. Overwrite?', false);
      if (overwrite) {
        installMcpServer(LOCAL_SETTINGS_PATH, { includeCwd: false });
        printSuccess(`Updated ${LOCAL_SETTINGS_PATH}`);
      } else {
        printInfo('Skipped local config');
      }
    } else {
      installMcpServer(LOCAL_SETTINGS_PATH, { includeCwd: false });
      printSuccess(`Added MCP server to ${LOCAL_SETTINGS_PATH}`);
    }
  }

  // Step 2: Subagent installation
  print('');
  const installAgent = await prompter.confirm('Install docmeta-updater agent?');

  if (installAgent) {
    const agentConfig = loadConfig(process.cwd());
    const ignores = getIgnorePatterns(process.cwd(), {
      customIgnoreDirs: agentConfig.customIgnoreDirs,
      customIgnoreFiles: agentConfig.customIgnoreFiles,
      customIgnorePatterns: agentConfig.customIgnorePatterns,
    });
    const subagentResult = installSubagent(process.cwd(), {
      ignoreDirs: ignores.dirs,
      ignoreFiles: ignores.files,
    });

    for (const file of subagentResult.created) {
      printSuccess(`Created ${file}`);
    }
    for (const file of subagentResult.updated) {
      printSuccess(`Updated ${file}`);
    }
    for (const file of subagentResult.skipped) {
      printInfo(`Skipped ${file}`);
    }
  }

  // Step 3: CLAUDE.md installation
  print('');
  if (!SKIP_CLAUDE_MD) {
    const installClaudeMdFile = await prompter.confirm('Add DocMeta instructions to .claude/CLAUDE.md?');
    if (installClaudeMdFile) {
      const claudeMdResult = installClaudeMd();
      if (claudeMdResult.action === 'created') {
        printSuccess(`Created ${CLAUDE_MD_PATH}`);
      } else if (claudeMdResult.action === 'updated') {
        printSuccess(`Updated DocMeta section in ${CLAUDE_MD_PATH}`);
      }
    }
  } else {
    printInfo('Skipped CLAUDE.md (DOCMETA_SKIP_CLAUDEMD set)');
  }

  // Step 4: Configuration options
  print('');
  const configureSettings = await prompter.confirm('Configure project settings (history limit, etc.)?', false);

  let config = loadConfig(process.cwd());
  if (configureSettings) {
    print('');
    const historyLimit = await prompter.ask(
      `Max history entries per file ${colors.dim}[default: ${DEFAULT_CONFIG.maxHistoryEntries}]${colors.reset}: `
    );

    if (historyLimit && !isNaN(parseInt(historyLimit, 10))) {
      config.maxHistoryEntries = parseInt(historyLimit, 10);
      saveConfig(config, process.cwd());
      printSuccess(`Saved configuration to .docmetarc.json`);
    }
  }

  // Step 5: Initialize documentation
  print('');
  const doInit = await prompter.confirm('Initialize .docmeta.json files in this project?');

  if (doInit) {
    process.argv = ['node', 'init.js', '.'];
    initDocMeta();

    // Step 6: Build dependency graph
    const doUsedBy = await prompter.confirm('Build dependency graph (run usedby)?');
    if (doUsedBy) {
      process.argv = ['node', 'usedby.js', '.'];
      runUsedBy();
    }
  }

  printHeader('Setup Complete!');

  if (mcpChoice !== 'skip' || installAgent) {
    print(`${colors.yellow}Start a new Claude Code session${colors.reset} to load changes.`);
    print('');
  }
  if (mcpChoice === 'skip') {
    print('Run "docmeta setup" again to configure MCP server.');
    print('');
  }
  if (doInit) {
    print(`${colors.dim}Tip: File purposes will be filled in automatically as you work.${colors.reset}`);
    print('');
  }

  return true;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const isDefault = args.includes('--default') || args.includes('-d');

  print(`
${colors.bright}╔══════════════════════════════════════╗
║         DocMeta Setup Wizard         ║
╚══════════════════════════════════════╝${colors.reset}
`);

  const prompter = new Prompter();

  try {
    if (isDefault) {
      await runDefaultSetup(prompter);
    } else {
      // Ask which mode
      const mode = await prompter.select('Choose setup mode:', [
        {
          value: 'default',
          label: 'Default (recommended)',
          description: 'Auto-configure everything with sensible defaults'
        },
        {
          value: 'advanced',
          label: 'Advanced',
          description: 'Choose each option individually'
        }
      ]);

      if (mode === 'default') {
        await runDefaultSetup(prompter);
      } else {
        await runAdvancedSetup(prompter);
      }
    }
  } finally {
    prompter.close();
  }
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
