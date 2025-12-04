/**
 * Configuration Loader
 * Loads and validates YAML/JSON template files
 */

import { readFileSync, existsSync } from 'fs'
import { parse as parseYaml } from 'yaml'
import {
  validateTemplate,
  DEFAULT_TEMPLATE,
  type SixcolTemplate,
  type ColumnConfig,
  type EventWiring,
} from './types.ts'

/**
 * Load template from file
 * Supports .yaml, .yml, and .json extensions
 */
export async function loadTemplate(path: string): Promise<SixcolTemplate> {
  if (!existsSync(path)) {
    throw new Error(`Template file not found: ${path}`)
  }

  const content = readFileSync(path, 'utf-8')
  const ext = path.toLowerCase().split('.').pop()

  let parsed: unknown

  if (ext === 'json') {
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      throw new Error(`Failed to parse JSON: ${(e as Error).message}`)
    }
  } else if (ext === 'yaml' || ext === 'yml') {
    try {
      parsed = parseYaml(content)
    } catch (e) {
      throw new Error(`Failed to parse YAML: ${(e as Error).message}`)
    }
  } else {
    // Try JSON first, then YAML
    try {
      parsed = JSON.parse(content)
    } catch {
      try {
        parsed = parseYaml(content)
      } catch (e) {
        throw new Error(`Failed to parse template: ${(e as Error).message}`)
      }
    }
  }

  const validation = validateTemplate(parsed)
  if (!validation.valid) {
    throw new Error(`Invalid template:\n${validation.errors.join('\n')}`)
  }

  return parsed as SixcolTemplate
}

/**
 * Load template from string
 */
export function loadTemplateFromString(
  content: string,
  format: 'json' | 'yaml' = 'yaml'
): SixcolTemplate {
  let parsed: unknown

  if (format === 'json') {
    parsed = JSON.parse(content)
  } else {
    parsed = parseYaml(content)
  }

  const validation = validateTemplate(parsed)
  if (!validation.valid) {
    throw new Error(`Invalid template:\n${validation.errors.join('\n')}`)
  }

  return parsed as SixcolTemplate
}

/**
 * Merge template with defaults
 */
export function mergeWithDefaults(template: Partial<SixcolTemplate>): SixcolTemplate {
  return {
    ...DEFAULT_TEMPLATE,
    ...template,
    columns: template.columns || DEFAULT_TEMPLATE.columns,
    wiring: template.wiring || DEFAULT_TEMPLATE.wiring,
    options: {
      ...DEFAULT_TEMPLATE.options,
      ...template.options,
    },
  }
}

/**
 * Resolve column positions for grid layout
 */
export function resolveLayout(template: SixcolTemplate): Map<string, { x: number; y: number; w: number; h: number }> {
  const layout = new Map<string, { x: number; y: number; w: number; h: number }>()
  const grid = template.layout || { rows: 2, cols: 3 }

  let row = 0
  let col = 0

  for (const column of template.columns) {
    if (column.position) {
      // Explicit position
      layout.set(column.id, {
        x: column.position.col,
        y: column.position.row,
        w: column.position.colSpan || 1,
        h: column.position.rowSpan || 1,
      })
    } else {
      // Auto-layout: fill row by row
      layout.set(column.id, {
        x: col,
        y: row,
        w: 1,
        h: 1,
      })

      col++
      if (col >= grid.cols) {
        col = 0
        row++
      }
    }
  }

  return layout
}

/**
 * Build wiring lookup map
 */
export function buildWiringMap(
  template: SixcolTemplate
): Map<string, Map<string, EventWiring[]>> {
  // Map: source column -> event name -> list of wirings
  const map = new Map<string, Map<string, EventWiring[]>>()

  for (const wire of template.wiring || []) {
    if (!map.has(wire.on.column)) {
      map.set(wire.on.column, new Map())
    }

    const eventMap = map.get(wire.on.column)!
    if (!eventMap.has(wire.on.event)) {
      eventMap.set(wire.on.event, [])
    }

    eventMap.get(wire.on.event)!.push(wire)
  }

  return map
}

/**
 * Get columns that a column is wired to
 */
export function getWiredTargets(
  template: SixcolTemplate,
  sourceColumn: string,
  event: string
): string[] {
  const targets: string[] = []

  for (const wire of template.wiring || []) {
    if (wire.on.column === sourceColumn && wire.on.event === event) {
      if (wire.do.column === '*') {
        // Broadcast to all except source
        targets.push(
          ...template.columns
            .map((c) => c.id)
            .filter((id) => id !== sourceColumn)
        )
      } else {
        targets.push(wire.do.column)
      }
    }
  }

  return [...new Set(targets)]
}

/**
 * Generate example template YAML
 */
export function generateExampleTemplate(): string {
  return `# Sixcol Template
name: example
description: Example template configuration

layout:
  rows: 2
  cols: 3
  gap: 1

columns:
  - id: list
    type: list
    title: Items
    position:
      row: 0
      col: 0

  - id: surface
    type: surface
    title: 3D Surface
    position:
      row: 0
      col: 1
      colSpan: 2

  - id: chart
    type: chart
    title: Metrics
    position:
      row: 1
      col: 0

  - id: table
    type: table
    title: Data
    position:
      row: 1
      col: 1

  - id: log
    type: log
    title: Events
    position:
      row: 1
      col: 2

wiring:
  - on:
      column: list
      event: SELECTED
    do:
      column: surface
      action: SET_DATA

  - on:
      column: surface
      event: RISK_METRICS
    do:
      column: chart
      action: UPDATE

sources:
  - type: command
    target: "echo '{\"value\": 42}'"
    interval: 5000
    parse: json
    columns:
      - chart

options:
  refreshRate: 1000
  theme: dark
  borderStyle: single
`
}

/**
 * Risk Oracle template
 */
export function getRiskOracleTemplate(): SixcolTemplate {
  return {
    name: 'risk-oracle',
    description: '7-column risk oracle with 3D surface',
    layout: { rows: 3, cols: 3, gap: 1 },
    columns: [
      {
        id: 'term-structure',
        type: 'chart',
        title: 'Term Structure',
        position: { row: 0, col: 0 },
      },
      {
        id: 'surface-cube',
        type: 'surface',
        title: '3D Surface',
        position: { row: 0, col: 1, rowSpan: 2 },
      },
      {
        id: 'smile-skew',
        type: 'chart',
        title: 'Smile/Skew',
        position: { row: 0, col: 2 },
      },
      {
        id: 'slope-analysis',
        type: 'table',
        title: 'Slope Analysis',
        position: { row: 1, col: 0 },
      },
      {
        id: 'arb-detect',
        type: 'list',
        title: 'Arbitrage',
        position: { row: 1, col: 2 },
      },
      {
        id: 'risk-score',
        type: 'gauge',
        title: 'Risk Score',
        position: { row: 2, col: 0 },
      },
      {
        id: 'alerts',
        type: 'log',
        title: 'Alerts',
        position: { row: 2, col: 2 },
      },
    ],
    wiring: [
      { on: { column: 'surface-cube', event: 'SURFACE_UPDATE' }, do: { column: 'term-structure', action: 'UPDATE_SLICE_X' } },
      { on: { column: 'surface-cube', event: 'SURFACE_UPDATE' }, do: { column: 'smile-skew', action: 'UPDATE_SLICE_Y' } },
      { on: { column: 'surface-cube', event: 'SURFACE_UPDATE' }, do: { column: 'slope-analysis', action: 'RECOMPUTE' } },
      { on: { column: 'surface-cube', event: 'SURFACE_UPDATE' }, do: { column: 'arb-detect', action: 'CHECK_ARBITRAGE' } },
      { on: { column: 'surface-cube', event: 'RISK_METRICS' }, do: { column: 'risk-score', action: 'UPDATE_SCORE' } },
      { on: { column: 'arb-detect', event: 'ARBITRAGE_FOUND' }, do: { column: 'alerts', action: 'APPEND' } },
      { on: { column: 'risk-score', event: 'RISK_THRESHOLD' }, do: { column: 'alerts', action: 'APPEND' } },
    ],
    options: {
      refreshRate: 500,
      theme: 'dark',
      borderStyle: 'single',
    },
  }
}
