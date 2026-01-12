#!/usr/bin/env node
/**
 * Postinstall script - runs after npm install
 *
 * Prints a friendly message prompting users to run setup.
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

// Don't show message during CI or when installed as dependency
const isCI = process.env.CI || process.env.CONTINUOUS_INTEGRATION;
const isGlobalInstall = process.env.npm_config_global === 'true';
const isNpx = process.env.npm_command === 'exec';

// Only show for direct installs, not when used as a dependency
if (!isCI && (isGlobalInstall || isNpx || !process.env.npm_package_name)) {
  console.log(`
${colors.bright}${colors.green}DocMeta installed successfully!${colors.reset}

${colors.cyan}Quick start:${colors.reset}
  ${colors.bright}npx @brbcoffeedebuff/docmeta setup${colors.reset}

This will guide you through:
  - Adding the MCP server to Claude Code
  - Initializing documentation for your project
  - Building the dependency graph

${colors.dim}Or run individual commands:${colors.reset}
  docmeta init      Create .docmeta.json scaffolds
  docmeta usedby    Build dependency graph
  docmeta check     Validate documentation
  docmeta mcp       Start MCP server

${colors.dim}Learn more: https://github.com/anthropic-community/docmeta${colors.reset}
`);
}
