/**
 * Data Table Widget
 * Displays tabular data with column headers and optional sorting
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'

export interface TableColumn<T = unknown> {
  key: string
  header: string
  width?: number
  align?: 'left' | 'center' | 'right'
  format?: (value: unknown, row: T) => string
  sortable?: boolean
}

export interface TableWidgetProps<T = Record<string, unknown>> {
  /** Column definitions */
  columns: TableColumn<T>[]
  /** Data rows */
  data: T[]
  /** Widget title */
  title?: string
  /** Max visible rows */
  maxRows?: number
  /** Enable keyboard navigation */
  enableInput?: boolean
  /** Called when row is selected */
  onRowSelect?: (row: T, index: number) => void
  /** Show row numbers */
  showRowNumbers?: boolean
  /** Highlight function for conditional styling */
  highlight?: (row: T, index: number) => 'normal' | 'success' | 'warning' | 'error'
}

type SortDirection = 'asc' | 'desc' | null

export function TableWidget<T = Record<string, unknown>>({
  columns,
  data,
  title,
  maxRows = 10,
  enableInput = true,
  onRowSelect,
  showRowNumbers = false,
  highlight,
}: TableWidgetProps<T>): React.ReactElement {
  const [selectedRow, setSelectedRow] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)

  // Sort data if sort column is set
  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) return data

    const col = columns.find((c) => c.key === sortColumn)
    if (!col) return data

    return [...data].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortColumn]
      const bVal = (b as Record<string, unknown>)[sortColumn]

      let cmp = 0
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal
      } else {
        cmp = String(aVal).localeCompare(String(bVal))
      }

      return sortDirection === 'desc' ? -cmp : cmp
    })
  }, [data, sortColumn, sortDirection, columns])

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!enableInput || sortedData.length === 0) return

      if (key.upArrow || input === 'k') {
        const newRow = Math.max(0, selectedRow - 1)
        setSelectedRow(newRow)
        if (newRow < scrollOffset) setScrollOffset(newRow)
      } else if (key.downArrow || input === 'j') {
        const newRow = Math.min(sortedData.length - 1, selectedRow + 1)
        setSelectedRow(newRow)
        if (newRow >= scrollOffset + maxRows) setScrollOffset(newRow - maxRows + 1)
      } else if (key.return) {
        if (onRowSelect) {
          onRowSelect(sortedData[selectedRow]!, selectedRow)
        }
      } else if (input === 's') {
        // Cycle through sortable columns
        const sortableColumns = columns.filter((c) => c.sortable !== false)
        if (sortableColumns.length === 0) return

        const currentIdx = sortableColumns.findIndex((c) => c.key === sortColumn)
        if (currentIdx === -1) {
          setSortColumn(sortableColumns[0]!.key)
          setSortDirection('asc')
        } else if (sortDirection === 'asc') {
          setSortDirection('desc')
        } else {
          const nextIdx = (currentIdx + 1) % sortableColumns.length
          if (nextIdx === 0 && currentIdx === sortableColumns.length - 1) {
            setSortColumn(null)
            setSortDirection(null)
          } else {
            setSortColumn(sortableColumns[nextIdx]!.key)
            setSortDirection('asc')
          }
        }
      }
    },
    { isActive: enableInput }
  )

  // Calculate column widths
  const colWidths = columns.map((col) => {
    if (col.width) return col.width
    // Auto-width based on header and data
    let max = col.header.length
    for (const row of sortedData.slice(0, 20)) {
      const val = (row as Record<string, unknown>)[col.key]
      const formatted = col.format ? col.format(val, row) : String(val ?? '')
      max = Math.max(max, formatted.length)
    }
    return Math.min(max + 2, 20) // Cap at 20 chars
  })

  // Visible rows
  const visibleData = sortedData.slice(scrollOffset, scrollOffset + maxRows)

  // Format cell value
  const formatCell = (col: TableColumn<T>, row: T, width: number): string => {
    const val = (row as Record<string, unknown>)[col.key]
    const formatted = col.format ? col.format(val, row) : String(val ?? '')
    const truncated = formatted.length > width ? formatted.slice(0, width - 1) + '…' : formatted

    switch (col.align) {
      case 'right':
        return truncated.padStart(width)
      case 'center':
        const pad = width - truncated.length
        const left = Math.floor(pad / 2)
        return ' '.repeat(left) + truncated + ' '.repeat(pad - left)
      default:
        return truncated.padEnd(width)
    }
  }

  // Get highlight color
  const getHighlightColor = (level: 'normal' | 'success' | 'warning' | 'error'): string | undefined => {
    switch (level) {
      case 'success':
        return 'green'
      case 'warning':
        return 'yellow'
      case 'error':
        return 'red'
      default:
        return undefined
    }
  }

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {/* Header */}
      {title && (
        <Box justifyContent="space-between">
          <Text bold>{title}</Text>
          <Text dimColor>
            {sortedData.length} rows
            {sortColumn && ` (${sortColumn} ${sortDirection})`}
          </Text>
        </Box>
      )}

      {/* Column headers */}
      <Box>
        {showRowNumbers && <Text dimColor>{'#'.padEnd(4)}</Text>}
        {columns.map((col, i) => (
          <Text key={col.key} bold>
            {formatCell({ ...col, format: undefined } as TableColumn<T>, { [col.key]: col.header } as T, colWidths[i]!)}
            {col.key === sortColumn && (sortDirection === 'asc' ? '↑' : '↓')}
          </Text>
        ))}
      </Box>

      {/* Separator */}
      <Text dimColor>
        {showRowNumbers && '────'}
        {colWidths.map((w) => '─'.repeat(w)).join('─')}
      </Text>

      {/* Data rows */}
      {visibleData.length === 0 ? (
        <Text dimColor>No data</Text>
      ) : (
        visibleData.map((row, i) => {
          const actualIndex = scrollOffset + i
          const selected = actualIndex === selectedRow
          const level = highlight ? highlight(row, actualIndex) : 'normal'
          const color = getHighlightColor(level)

          return (
            <Box key={actualIndex}>
              {showRowNumbers && (
                <Text dimColor>{String(actualIndex + 1).padEnd(4)}</Text>
              )}
              {columns.map((col, j) => (
                <Text
                  key={col.key}
                  color={color}
                  bold={selected}
                  inverse={selected}
                >
                  {formatCell(col, row, colWidths[j]!)}
                </Text>
              ))}
            </Box>
          )
        })
      )}

      {/* Footer */}
      {enableInput && (
        <Text dimColor>↑↓ navigate, s sort, Enter select</Text>
      )}
    </Box>
  )
}

export default TableWidget
