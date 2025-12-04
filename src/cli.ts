#!/usr/bin/env bun
/**
 * Sixcol CLI
 * Terminal-based 6-column dashboard framework
 */

import { parseArgs } from 'util'
import { Sixcol } from './main.ts'
import {
  loadTemplate,
  generateExampleTemplate,
  getRiskOracleTemplate,
} from './config/loader.ts'
import { DEFAULT_TEMPLATE, type SixcolTemplate } from './config/types.ts'

const VERSION = '0.1.0'

const HELP = `
Marigraph - Volatility Surface Visualization

Usage:
  marigraph [options]
  marigraph --template <file>

Options:
  -t, --template <file>   Load template from YAML/JSON file
  -r, --risk-oracle       Use built-in risk oracle template
  -g, --generate          Generate example template to stdout
  -H, --headless          Run without TUI (IPC only)
  -s, --socket-dir <dir>  Socket directory (default: /tmp/marigraph-<id>)
  -v, --version           Show version
  -h, --help              Show this help

Examples:
  marigraph                       # Run TUI with demo data
  marigraph -t my-config.yaml     # Load custom template
  marigraph --risk-oracle         # Run 7-column risk oracle
  marigraph -g > template.yaml    # Generate example template

Environment:
  MARIGRAPH_DEBUG=1     Enable debug logging
  MARIGRAPH_NO_COLOR=1  Disable colors
`

interface CLIOptions {
  template?: string
  riskOracle: boolean
  generate: boolean
  headless: boolean
  socketDir?: string
  version: boolean
  help: boolean
}

function parseCliArgs(): CLIOptions {
  const { values } = parseArgs({
    options: {
      template: { type: 'string', short: 't' },
      'risk-oracle': { type: 'boolean', short: 'r', default: false },
      generate: { type: 'boolean', short: 'g', default: false },
      headless: { type: 'boolean', short: 'H', default: false },
      'socket-dir': { type: 'string', short: 's' },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  })

  return {
    template: values.template,
    riskOracle: values['risk-oracle'] ?? false,
    generate: values.generate ?? false,
    headless: values.headless ?? false,
    socketDir: values['socket-dir'],
    version: values.version ?? false,
    help: values.help ?? false,
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs()

  // Handle simple flags first
  if (options.help) {
    console.log(HELP)
    process.exit(0)
  }

  if (options.version) {
    console.log(`sixcol v${VERSION}`)
    process.exit(0)
  }

  if (options.generate) {
    console.log(generateExampleTemplate())
    process.exit(0)
  }

  // Load template
  let template: SixcolTemplate

  if (options.template) {
    try {
      template = await loadTemplate(options.template)
      console.error(`Loaded template: ${template.name}`)
    } catch (e) {
      console.error(`Error loading template: ${(e as Error).message}`)
      process.exit(1)
    }
  } else if (options.riskOracle) {
    template = getRiskOracleTemplate()
    console.error('Using risk oracle template')
  } else {
    template = DEFAULT_TEMPLATE
    console.error('Using default template')
  }

  // Create and start Sixcol
  const sixcol = new Sixcol({
    name: template.name,
    columns: template.columns.map((col) => ({
      id: col.id,
      type: col.type,
      config: col.options,
    })),
    socketDir: options.socketDir,
  })

  // Handle signals
  const shutdown = async () => {
    console.error('\nShutting down...')
    await sixcol.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await sixcol.start()
    console.error(`Sixcol started with ${template.columns.length} columns`)

    if (options.headless) {
      console.error('Running in headless mode. Press Ctrl+C to exit.')
      // Keep running until signal
      await new Promise(() => {})
    } else {
      // Launch TUI
      console.error('Launching TUI...')
      await sixcol.shutdown()

      // Dynamic import to avoid loading React in headless mode
      const { render } = await import('ink')
      const React = await import('react')
      const { App } = await import('./tui/App.tsx')

      const { waitUntilExit } = render(React.createElement(App))
      await waitUntilExit()
    }
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`)
    await sixcol.shutdown()
    process.exit(1)
  }
}

// Export for testing
export { parseCliArgs, main }

// Run if called directly
if (import.meta.main) {
  main().catch((e) => {
    console.error(`Fatal error: ${e.message}`)
    process.exit(1)
  })
}
