/**
 * Timeline Scrubber Component
 * Allows scrubbing through historical volatility snapshots
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { VolatilityPlaylist, VolatilitySnapshot } from '../chain/volatility.ts'
import { VOLATILITY_EVENTS } from '../chain/config.ts'

export interface TimelineProps {
  playlist: VolatilityPlaylist
  width: number
  onSeek?: (index: number) => void
}

/**
 * Timeline progress bar with event markers
 */
export function Timeline({ playlist, width }: TimelineProps): React.ReactElement {
  const { snapshots, currentIndex, isPlaying } = playlist
  const current = snapshots[currentIndex]

  if (!current || snapshots.length === 0) {
    return (
      <Box width={width} flexDirection="column">
        <Text dimColor>No data loaded...</Text>
      </Box>
    )
  }

  // Calculate progress
  const progress = snapshots.length > 1
    ? currentIndex / (snapshots.length - 1)
    : 1

  // Build progress bar
  const barWidth = width - 20 // Leave room for labels
  const filledWidth = Math.floor(progress * barWidth)
  const emptyWidth = barWidth - filledWidth

  // Find event positions on the timeline
  const eventPositions: { pos: number; severity: string; name: string }[] = []
  for (const event of VOLATILITY_EVENTS) {
    const snapIndex = snapshots.findIndex(s => s.blockNumber === event.block)
    if (snapIndex >= 0) {
      const pos = Math.floor((snapIndex / (snapshots.length - 1)) * barWidth)
      eventPositions.push({ pos, severity: event.severity, name: event.name })
    }
  }

  // Build the bar string with event markers
  let barChars = ''
  for (let i = 0; i < barWidth; i++) {
    const event = eventPositions.find(e => Math.abs(e.pos - i) < 1)
    if (event) {
      // Event marker
      if (event.severity === 'extreme') barChars += '▼'
      else if (event.severity === 'high') barChars += '▽'
      else barChars += '○'
    } else if (i < filledWidth) {
      barChars += '█'
    } else if (i === filledWidth) {
      barChars += '●' // Current position
    } else {
      barChars += '░'
    }
  }

  // Get severity color
  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case 'extreme': return 'red'
      case 'high': return 'yellow'
      case 'elevated': return 'magenta'
      default: return 'green'
    }
  }

  const startDate = snapshots[0]?.date || ''
  const endDate = snapshots[snapshots.length - 1]?.date || ''

  return (
    <Box flexDirection="column" width={width}>
      {/* Current snapshot info */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">Block </Text>
          <Text color="white">{current.blockNumber.toLocaleString()}</Text>
          <Text dimColor> | </Text>
          <Text color="yellow">{current.date}</Text>
        </Box>
        <Box>
          <Text color="green">ETH: </Text>
          <Text bold color="white">${current.ethPrice.toFixed(0)}</Text>
          <Text dimColor> | </Text>
          <Text color={getSeverityColor(current.eventSeverity)}>
            Risk: {(current.riskScore * 100).toFixed(0)}%
          </Text>
        </Box>
      </Box>

      {/* Event name if present */}
      {current.eventName && (
        <Box>
          <Text color={getSeverityColor(current.eventSeverity)} bold>
            ⚡ {current.eventName}
          </Text>
          {current.eventSeverity && (
            <Text dimColor> ({current.eventSeverity})</Text>
          )}
        </Box>
      )}

      {/* Progress bar */}
      <Box marginTop={1}>
        <Text dimColor>{startDate} </Text>
        <Text color={isPlaying ? 'green' : 'cyan'}>{barChars}</Text>
        <Text dimColor> {endDate}</Text>
      </Box>

      {/* Controls hint */}
      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>
          {isPlaying ? '▶ Playing' : '⏸ Paused'} | ◀/▶ seek | [ ] jump events | p play/pause
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Compact timeline for smaller displays
 */
export function CompactTimeline({ playlist, width }: TimelineProps): React.ReactElement {
  const { snapshots, currentIndex, isPlaying } = playlist
  const current = snapshots[currentIndex]

  if (!current) {
    return <Text dimColor>No data</Text>
  }

  const progress = snapshots.length > 1
    ? currentIndex / (snapshots.length - 1)
    : 1

  const barWidth = Math.max(10, width - 30)
  const filled = Math.floor(progress * barWidth)

  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)

  return (
    <Box width={width}>
      <Text color={isPlaying ? 'green' : 'cyan'}>{isPlaying ? '▶' : '⏸'} </Text>
      <Text dimColor>[</Text>
      <Text color="cyan">{bar}</Text>
      <Text dimColor>] </Text>
      <Text color="yellow">{current.date}</Text>
      {current.eventName && (
        <Text color="red"> ⚡</Text>
      )}
    </Box>
  )
}

/**
 * Event list panel showing all volatility events
 */
export function EventList({ playlist, width, height }: {
  playlist: VolatilityPlaylist
  width: number
  height: number
}): React.ReactElement {
  const { snapshots, currentIndex } = playlist
  const current = snapshots[currentIndex]

  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">◈ Events</Text>
      {VOLATILITY_EVENTS.slice(0, height - 3).map((event, i) => {
        const isActive = current?.eventName === event.name
        const color = event.severity === 'extreme' ? 'red' :
          event.severity === 'high' ? 'yellow' :
            event.severity === 'elevated' ? 'magenta' : 'green'

        return (
          <Box key={i}>
            <Text color={isActive ? 'white' : 'gray'} bold={isActive}>
              {isActive ? '▶ ' : '  '}
            </Text>
            <Text color={isActive ? color : 'gray'}>
              {event.date.slice(5)} {event.name.slice(0, width - 12)}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default Timeline
