/**
 * Log Widget
 * Append-only log stream with filtering and levels
 */

import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string | number
  timestamp: number
  level: LogLevel
  source?: string
  message: string
  data?: unknown
}

export interface LogWidgetProps {
  /** Log entries */
  entries: LogEntry[]
  /** Widget title */
  title?: string
  /** Max visible entries */
  maxVisible?: number
  /** Minimum log level to display */
  minLevel?: LogLevel
  /** Filter by source */
  sourceFilter?: string
  /** Enable keyboard navigation */
  enableInput?: boolean
  /** Auto-scroll to bottom on new entries */
  autoScroll?: boolean
  /** Show timestamps */
  showTimestamp?: boolean
  /** Show source */
  showSource?: boolean
  /** Compact mode (single line per entry) */
  compact?: boolean
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'gray',
  info: 'blue',
  warn: 'yellow',
  error: 'red',
}

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '·',
  info: 'ℹ',
  warn: '⚠',
  error: '✖',
}

export function LogWidget({
  entries,
  title = 'Log',
  maxVisible = 10,
  minLevel = 'info',
  sourceFilter,
  enableInput = true,
  autoScroll = true,
  showTimestamp = true,
  showSource = true,
  compact = true,
}: LogWidgetProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0)
  const [paused, setPaused] = useState(false)
  const [localMinLevel, setLocalMinLevel] = useState(minLevel)
  const prevEntriesLen = useRef(entries.length)

  // Filter entries
  const filteredEntries = entries.filter((entry) => {
    if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[localMinLevel]) return false
    if (sourceFilter && entry.source !== sourceFilter) return false
    return true
  })

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (autoScroll && !paused && entries.length > prevEntriesLen.current) {
      const maxOffset = Math.max(0, filteredEntries.length - maxVisible)
      setScrollOffset(maxOffset)
    }
    prevEntriesLen.current = entries.length
  }, [entries.length, filteredEntries.length, autoScroll, paused, maxVisible])

  // Keyboard navigation
  useInput(
    (input, key) => {
      if (!enableInput) return

      if (key.upArrow || input === 'k') {
        setScrollOffset((o) => Math.max(0, o - 1))
        setPaused(true)
      } else if (key.downArrow || input === 'j') {
        const maxOffset = Math.max(0, filteredEntries.length - maxVisible)
        setScrollOffset((o) => Math.min(maxOffset, o + 1))
      } else if (key.pageUp) {
        setScrollOffset((o) => Math.max(0, o - maxVisible))
        setPaused(true)
      } else if (key.pageDown) {
        const maxOffset = Math.max(0, filteredEntries.length - maxVisible)
        setScrollOffset((o) => Math.min(maxOffset, o + maxVisible))
      } else if (input === 'g') {
        setScrollOffset(0)
        setPaused(true)
      } else if (input === 'G') {
        const maxOffset = Math.max(0, filteredEntries.length - maxVisible)
        setScrollOffset(maxOffset)
        setPaused(false)
      } else if (input === ' ') {
        setPaused((p) => !p)
      } else if (input === 'd') {
        setLocalMinLevel('debug')
      } else if (input === 'i') {
        setLocalMinLevel('info')
      } else if (input === 'w') {
        setLocalMinLevel('warn')
      } else if (input === 'e') {
        setLocalMinLevel('error')
      }
    },
    { isActive: enableInput }
  )

  // Visible entries
  const visibleEntries = filteredEntries.slice(scrollOffset, scrollOffset + maxVisible)

  // Format timestamp
  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour12: false })
  }

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Box>
          {paused && <Text color="yellow">[PAUSED] </Text>}
          <Text dimColor>
            {filteredEntries.length}/{entries.length} [{localMinLevel}+]
          </Text>
        </Box>
      </Box>

      {/* Log entries */}
      <Box flexDirection="column" height={maxVisible}>
        {visibleEntries.length === 0 ? (
          <Text dimColor>No log entries</Text>
        ) : (
          visibleEntries.map((entry) => (
            <Box key={entry.id} flexWrap={compact ? 'nowrap' : 'wrap'}>
              {/* Level icon */}
              <Text color={LEVEL_COLORS[entry.level]}>
                {LEVEL_ICONS[entry.level]}{' '}
              </Text>

              {/* Timestamp */}
              {showTimestamp && (
                <Text dimColor>{formatTime(entry.timestamp)} </Text>
              )}

              {/* Source */}
              {showSource && entry.source && (
                <Text color="magenta">[{entry.source}] </Text>
              )}

              {/* Message */}
              <Text color={entry.level === 'error' ? 'red' : undefined}>
                {compact
                  ? entry.message.slice(0, 60) + (entry.message.length > 60 ? '…' : '')
                  : entry.message}
              </Text>
            </Box>
          ))
        )}
      </Box>

      {/* Scroll indicator */}
      {filteredEntries.length > maxVisible && (
        <Box justifyContent="space-between">
          <Text dimColor>
            {scrollOffset > 0 ? '↑ more' : '      '}
          </Text>
          <Text dimColor>
            {scrollOffset + maxVisible}–{Math.min(scrollOffset + maxVisible, filteredEntries.length)}/{filteredEntries.length}
          </Text>
          <Text dimColor>
            {scrollOffset + maxVisible < filteredEntries.length ? '↓ more' : '      '}
          </Text>
        </Box>
      )}

      {/* Help */}
      {enableInput && (
        <Text dimColor>↑↓ scroll, space pause, d/i/w/e filter</Text>
      )}
    </Box>
  )
}

/**
 * Helper to create log entries
 */
let logIdCounter = 0

export function createLogEntry(
  level: LogLevel,
  message: string,
  source?: string,
  data?: unknown
): LogEntry {
  return {
    id: ++logIdCounter,
    timestamp: Date.now(),
    level,
    source,
    message,
    data,
  }
}

export const log = {
  debug: (msg: string, source?: string, data?: unknown) =>
    createLogEntry('debug', msg, source, data),
  info: (msg: string, source?: string, data?: unknown) =>
    createLogEntry('info', msg, source, data),
  warn: (msg: string, source?: string, data?: unknown) =>
    createLogEntry('warn', msg, source, data),
  error: (msg: string, source?: string, data?: unknown) =>
    createLogEntry('error', msg, source, data),
}

export default LogWidget
