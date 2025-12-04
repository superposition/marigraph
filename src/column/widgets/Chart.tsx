/**
 * Chart Widget
 * Displays sparklines, bar charts, and line charts in the terminal
 */

import React from 'react'
import { Box, Text } from 'ink'

// Sparkline characters (8 levels)
const SPARK_CHARS = '▁▂▃▄▅▆▇█'

// Bar chart characters
const BAR_CHARS = {
  full: '█',
  seven: '▇',
  six: '▆',
  five: '▅',
  four: '▄',
  three: '▃',
  two: '▂',
  one: '▁',
  empty: ' ',
}

export interface ChartData {
  label?: string
  value: number
  color?: string
}

export interface ChartWidgetProps {
  /** Chart type */
  type: 'sparkline' | 'bar' | 'horizontal-bar'
  /** Data points */
  data: number[] | ChartData[]
  /** Chart title */
  title?: string
  /** Width for bar charts */
  width?: number
  /** Height for vertical charts */
  height?: number
  /** Show min/max labels */
  showRange?: boolean
  /** Show value labels */
  showLabels?: boolean
  /** Custom color */
  color?: string
  /** Baseline value for diverging charts */
  baseline?: number
}

/**
 * Generate sparkline string from values
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return ''

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return values
    .map((v) => {
      const norm = (v - min) / range
      const idx = Math.min(Math.floor(norm * SPARK_CHARS.length), SPARK_CHARS.length - 1)
      return SPARK_CHARS[idx]
    })
    .join('')
}

/**
 * Generate horizontal bar
 */
export function horizontalBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width)
  const empty = width - filled
  return BAR_CHARS.full.repeat(filled) + BAR_CHARS.empty.repeat(empty)
}

/**
 * Sparkline chart component
 */
function SparklineChart({
  data,
  title,
  showRange,
  color = 'cyan',
}: {
  data: number[]
  title?: string
  showRange?: boolean
  color?: string
}): React.ReactElement {
  const min = data.length > 0 ? Math.min(...data) : 0
  const max = data.length > 0 ? Math.max(...data) : 0
  const current = data.length > 0 ? data[data.length - 1] : 0

  return (
    <Box flexDirection="column">
      {title && (
        <Box justifyContent="space-between">
          <Text bold>{title}</Text>
          <Text color={color}>{current?.toFixed(2)}</Text>
        </Box>
      )}
      <Text color={color}>{sparkline(data)}</Text>
      {showRange && (
        <Box justifyContent="space-between">
          <Text dimColor>↓{min.toFixed(2)}</Text>
          <Text dimColor>↑{max.toFixed(2)}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * Horizontal bar chart component
 */
function HorizontalBarChart({
  data,
  title,
  width = 20,
  showLabels,
  color = 'green',
}: {
  data: ChartData[]
  title?: string
  width?: number
  showLabels?: boolean
  color?: string
}): React.ReactElement {
  const max = Math.max(...data.map((d) => d.value), 1)
  const labelWidth = Math.max(...data.map((d) => (d.label?.length || 0))) + 1

  return (
    <Box flexDirection="column">
      {title && <Text bold>{title}</Text>}
      {data.map((item, i) => (
        <Box key={i}>
          {item.label && (
            <Text>{item.label.padEnd(labelWidth)}</Text>
          )}
          <Text color={item.color || color}>
            {horizontalBar(item.value, max, width)}
          </Text>
          {showLabels && (
            <Text dimColor> {item.value.toFixed(1)}</Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

/**
 * Vertical bar chart component
 */
function VerticalBarChart({
  data,
  title,
  height = 8,
  showLabels,
  color = 'blue',
}: {
  data: ChartData[]
  title?: string
  height?: number
  showLabels?: boolean
  color?: string
}): React.ReactElement {
  const max = Math.max(...data.map((d) => d.value), 1)

  // Build rows from top to bottom
  const rows: string[][] = []
  for (let row = height; row > 0; row--) {
    const threshold = (row / height) * max
    const rowChars = data.map((item) => {
      const value = item.value
      if (value >= threshold) return BAR_CHARS.full
      const partialThreshold = ((row - 1) / height) * max
      if (value > partialThreshold) {
        // Partial fill
        const partial = (value - partialThreshold) / (threshold - partialThreshold)
        const idx = Math.floor(partial * 8)
        return Object.values(BAR_CHARS)[Math.min(idx, 7)] || BAR_CHARS.empty
      }
      return BAR_CHARS.empty
    })
    rows.push(rowChars)
  }

  return (
    <Box flexDirection="column">
      {title && <Text bold>{title}</Text>}
      {rows.map((row, i) => (
        <Box key={i}>
          {row.map((char, j) => (
            <Text key={j} color={data[j]?.color || color}>
              {char}
            </Text>
          ))}
        </Box>
      ))}
      {showLabels && (
        <Box>
          {data.map((item, i) => (
            <Text key={i} dimColor>
              {(item.label || String(i)).slice(0, 1)}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

/**
 * Main chart widget
 */
export function ChartWidget({
  type,
  data,
  title,
  width,
  height,
  showRange,
  showLabels,
  color,
}: ChartWidgetProps): React.ReactElement {
  // Normalize data
  const chartData: ChartData[] = Array.isArray(data)
    ? data.map((d) => (typeof d === 'number' ? { value: d } : d))
    : []
  const numericData = chartData.map((d) => d.value)

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {type === 'sparkline' && (
        <SparklineChart
          data={numericData}
          title={title}
          showRange={showRange}
          color={color}
        />
      )}
      {type === 'horizontal-bar' && (
        <HorizontalBarChart
          data={chartData}
          title={title}
          width={width}
          showLabels={showLabels}
          color={color}
        />
      )}
      {type === 'bar' && (
        <VerticalBarChart
          data={chartData}
          title={title}
          height={height}
          showLabels={showLabels}
          color={color}
        />
      )}
    </Box>
  )
}

/**
 * Multi-series sparkline
 */
export interface MultiSparklineProps {
  series: Array<{
    label: string
    data: number[]
    color?: string
  }>
  title?: string
}

export function MultiSparkline({ series, title }: MultiSparklineProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {title && <Text bold>{title}</Text>}
      {series.map((s, i) => (
        <Box key={i} justifyContent="space-between">
          <Text>{s.label}: </Text>
          <Text color={s.color || 'cyan'}>{sparkline(s.data)}</Text>
          <Text dimColor> {s.data[s.data.length - 1]?.toFixed(2)}</Text>
        </Box>
      ))}
    </Box>
  )
}

export default ChartWidget
