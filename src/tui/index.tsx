#!/usr/bin/env bun
/**
 * TUI Entry Point with Hot Reload
 */

import React from 'react'
import { render } from 'ink'
import { App } from './App.tsx'

// Render the app
const { unmount, waitUntilExit } = render(<App />)

// Handle cleanup
process.on('SIGINT', () => {
  unmount()
  process.exit(0)
})

process.on('SIGTERM', () => {
  unmount()
  process.exit(0)
})

// Wait for app to exit
await waitUntilExit()
