/**
 * Configuration Types
 * Template definitions for Sixcol layouts
 */

/**
 * Widget type definitions
 */
export type WidgetType =
  | 'surface' // 3D surface visualization
  | 'list' // Scrollable list
  | 'table' // Data table
  | 'chart' // Sparklines, bar charts
  | 'log' // Append-only log
  | 'form' // Input form
  | 'gauge' // Value gauge/meter
  | 'custom' // Custom widget

/**
 * Column position in grid
 */
export interface ColumnPosition {
  row: number // 0-based row
  col: number // 0-based column
  rowSpan?: number // Number of rows to span
  colSpan?: number // Number of columns to span
}

/**
 * Column configuration
 */
export interface ColumnConfig {
  id: string
  type: WidgetType
  title?: string
  position?: ColumnPosition
  width?: number | string // Fixed width or percentage
  height?: number | string
  options?: Record<string, unknown> // Widget-specific options
}

/**
 * Event wiring - routes events between columns
 */
export interface EventWiring {
  on: {
    column: string // Source column ID
    event: string // Event name (e.g., 'SELECTED', 'CLICKED')
  }
  do: {
    column: string // Target column ID (or '*' for broadcast)
    action: string // Action to perform
    transform?: string // Optional data transformation (JS expression)
  }
}

/**
 * Data source configuration
 */
export interface DataSourceConfig {
  type: 'command' | 'websocket' | 'file' | 'http'
  target: string // Command, URL, or file path
  interval?: number // Polling interval in ms (for command/http)
  parse?: 'json' | 'csv' | 'lines' | 'raw'
  columns?: string[] // Target column IDs to send data to
}

/**
 * Layout grid configuration
 */
export interface LayoutConfig {
  rows: number
  cols: number
  gap?: number
}

/**
 * Full template configuration
 */
export interface SixcolTemplate {
  name: string
  version?: string
  description?: string

  // Layout
  layout?: LayoutConfig

  // Columns
  columns: ColumnConfig[]

  // Event wiring
  wiring?: EventWiring[]

  // Data sources
  sources?: DataSourceConfig[]

  // Global options
  options?: {
    refreshRate?: number // Global refresh rate in ms
    theme?: 'dark' | 'light'
    borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'none'
  }
}

/**
 * Runtime column state
 */
export interface ColumnState {
  id: string
  config: ColumnConfig
  ready: boolean
  data: unknown
  lastUpdate: number
}

/**
 * Validate template configuration
 */
export function validateTemplate(template: unknown): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!template || typeof template !== 'object') {
    return { valid: false, errors: ['Template must be an object'] }
  }

  const t = template as Record<string, unknown>

  // Required fields
  if (!t.name || typeof t.name !== 'string') {
    errors.push('Template must have a name string')
  }

  if (!Array.isArray(t.columns)) {
    errors.push('Template must have a columns array')
  } else {
    const columnIds = new Set<string>()

    for (let i = 0; i < t.columns.length; i++) {
      const col = t.columns[i] as Record<string, unknown>

      if (!col.id || typeof col.id !== 'string') {
        errors.push(`Column ${i} must have an id string`)
      } else if (columnIds.has(col.id)) {
        errors.push(`Duplicate column id: ${col.id}`)
      } else {
        columnIds.add(col.id)
      }

      if (!col.type || typeof col.type !== 'string') {
        errors.push(`Column ${i} must have a type string`)
      }
    }

    // Validate wiring references
    if (Array.isArray(t.wiring)) {
      for (const wire of t.wiring as EventWiring[]) {
        if (!columnIds.has(wire.on.column)) {
          errors.push(`Wiring references unknown source column: ${wire.on.column}`)
        }
        if (wire.do.column !== '*' && !columnIds.has(wire.do.column)) {
          errors.push(`Wiring references unknown target column: ${wire.do.column}`)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Default template
 */
export const DEFAULT_TEMPLATE: SixcolTemplate = {
  name: 'default',
  layout: { rows: 2, cols: 3, gap: 1 },
  columns: [
    { id: 'col1', type: 'list', title: 'List' },
    { id: 'col2', type: 'surface', title: 'Surface' },
    { id: 'col3', type: 'chart', title: 'Chart' },
    { id: 'col4', type: 'table', title: 'Table' },
    { id: 'col5', type: 'log', title: 'Log' },
    { id: 'col6', type: 'gauge', title: 'Status' },
  ],
  wiring: [],
  options: {
    refreshRate: 1000,
    theme: 'dark',
    borderStyle: 'single',
  },
}
