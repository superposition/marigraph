/**
 * 3D Surface Widget
 * Renders volatility surface with slope visualization in Ink
 */

import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text, useInput, useApp, useStdout } from 'ink'
import type { Surface as SurfaceData } from '../../data/surface.ts'
import { computeSlope } from '../../data/surface.ts'
import type { Vec64, Vec32 } from '../../data/vec.ts'
import { createProjection, rotateProjection, zoomProjection } from '../../render/project.ts'
import type { Projection } from '../../render/project.ts'
import { renderCubeFrame, surfaceToPoints } from '../../render/cube.ts'
import { rasterizeCubeFrame, type RasterBuffer } from '../../render/rasterize.ts'
import { computeRiskMetrics, formatRiskScore, generateRiskSummary } from '../../render/gradient.ts'
import type { RiskMetrics } from '../../render/gradient.ts'

// Map color names to Ink color props
type InkColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'

/**
 * Render a colored buffer using Ink Text components
 */
function ColoredBuffer({ buffer }: { buffer: RasterBuffer }): React.ReactElement {
  const rows: React.ReactElement[] = []

  for (let y = 0; y < buffer.height; y++) {
    const spans: React.ReactElement[] = []
    let currentColor = buffer.colors[y]![0] || ''
    let currentText = ''

    for (let x = 0; x < buffer.width; x++) {
      const color = buffer.colors[y]![x] || ''
      const char = buffer.chars[y]![x] || ' '

      if (color === currentColor) {
        currentText += char
      } else {
        // Flush current span
        if (currentText) {
          const key = `${y}-${spans.length}`
          if (currentColor) {
            spans.push(
              <Text key={key} color={currentColor as InkColor}>
                {currentText}
              </Text>
            )
          } else {
            spans.push(<Text key={key}>{currentText}</Text>)
          }
        }
        currentColor = color
        currentText = char
      }
    }

    // Flush final span
    if (currentText) {
      const key = `${y}-${spans.length}`
      if (currentColor) {
        spans.push(
          <Text key={key} color={currentColor as InkColor}>
            {currentText}
          </Text>
        )
      } else {
        spans.push(<Text key={key}>{currentText}</Text>)
      }
    }

    rows.push(
      <Box key={y}>
        {spans}
      </Box>
    )
  }

  return <Box flexDirection="column">{rows}</Box>
}

export interface SurfaceWidgetProps {
  /** Surface data to render */
  surface: SurfaceData<Vec64 | Vec32> | null
  /** Axis labels */
  labels?: { x: string; y: string; z: string }
  /** Widget dimensions */
  width?: number
  height?: number
  /** Called when risk metrics are computed */
  onRiskMetrics?: (metrics: RiskMetrics) => void
  /** Called when projection changes */
  onProjectionChange?: (proj: Projection) => void
  /** Enable keyboard controls */
  enableControls?: boolean
  /** Show status bar */
  showStatus?: boolean
  /** Initial projection settings */
  initialProjection?: Partial<Projection>
}

/**
 * 3D Surface visualization widget
 * Use arrow keys to rotate, +/- to zoom
 */
export function SurfaceWidget({
  surface,
  labels = { x: 'DTE', y: 'Strike', z: 'IV' },
  width: propWidth,
  height: propHeight,
  onRiskMetrics,
  onProjectionChange,
  enableControls = true,
  showStatus = true,
  initialProjection = {},
}: SurfaceWidgetProps): React.ReactElement {
  const { stdout } = useStdout()
  const { exit } = useApp()

  // Get terminal dimensions
  const termWidth = propWidth || stdout?.columns || 80
  const termHeight = propHeight || stdout?.rows || 24

  // Projection state
  const [projection, setProjection] = useState<Projection>(() =>
    createProjection(termWidth - 4, termHeight - 6, initialProjection)
  )

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!enableControls) return

      if (key.leftArrow) {
        setProjection((p) => rotateProjection(p, -5, 0))
      } else if (key.rightArrow) {
        setProjection((p) => rotateProjection(p, 5, 0))
      } else if (key.upArrow) {
        setProjection((p) => rotateProjection(p, 0, 5))
      } else if (key.downArrow) {
        setProjection((p) => rotateProjection(p, 0, -5))
      } else if (input === '+' || input === '=') {
        setProjection((p) => zoomProjection(p, 1.1))
      } else if (input === '-' || input === '_') {
        setProjection((p) => zoomProjection(p, 0.9))
      } else if (input === 'r') {
        // Reset projection
        setProjection(createProjection(termWidth - 4, termHeight - 6, initialProjection))
      } else if (input === 'q') {
        exit()
      }
    },
    { isActive: enableControls }
  )

  // Auto-rotate azimuth by 5 degrees
  useEffect(() => {
    const interval = setInterval(() => {
      setProjection((p) => rotateProjection(p, 5, 0))
    }, 200) // rotate every 200ms

    return () => clearInterval(interval)
  }, [])

  // Notify on projection change
  useEffect(() => {
    if (onProjectionChange) {
      onProjectionChange(projection)
    }
  }, [projection, onProjectionChange])

  // Compute risk metrics when surface changes
  const riskMetrics = useMemo(() => {
    if (!surface) return null
    const slope = computeSlope(surface as SurfaceData<Vec64>)
    return computeRiskMetrics(slope, surface.nx, surface.ny)
  }, [surface])

  // Notify on risk metrics change
  useEffect(() => {
    if (riskMetrics && onRiskMetrics) {
      onRiskMetrics(riskMetrics)
    }
  }, [riskMetrics, onRiskMetrics])

  // Render the cube frame
  const renderedBuffer = useMemo((): RasterBuffer | null => {
    if (!surface) {
      return null
    }

    // Convert surface to normalized points
    const points = surfaceToPoints(
      surface.x,
      surface.y,
      surface.z,
      surface.nx,
      surface.ny
    )

    // Render cube frame with surface mesh
    const frame = renderCubeFrame(points, projection, {
      showWireframe: true,
      showGrid: true,
      showAxes: true,
      gridDivisions: 4,
      axisLabels: labels,
    })

    // Rasterize to characters with colors
    return rasterizeCubeFrame(frame, termWidth - 4, termHeight - 8, { colorBySurface: true })
  }, [surface, projection, termWidth, termHeight, labels])

  // Loading state
  if (!surface) {
    return (
      <Box flexDirection="column" borderStyle="single" width={termWidth} height={termHeight}>
        <Box justifyContent="center">
          <Text bold>3D Surface</Text>
        </Box>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text dimColor>Loading surface data...</Text>
        </Box>
      </Box>
    )
  }

  const riskDisplay = riskMetrics ? formatRiskScore(riskMetrics.riskScore) : null

  return (
    <Box flexDirection="column" borderStyle="single" width={termWidth}>
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text bold>3D Surface </Text>
          <Text dimColor>
            Az:{projection.azimuth.toFixed(0)}° El:{projection.elevation.toFixed(0)}° Z:{(projection.zoom / 10).toFixed(1)}x
          </Text>
        </Box>
        {riskDisplay && (
          <Text color={riskDisplay.color}>
            Risk: {riskDisplay.text} ({(riskMetrics!.riskScore * 100).toFixed(0)}%)
          </Text>
        )}
      </Box>

      {/* Surface visualization */}
      <Box flexDirection="column" paddingX={1}>
        {renderedBuffer && <ColoredBuffer buffer={renderedBuffer} />}
      </Box>

      {/* Status bar */}
      {showStatus && (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text dimColor>
            Az:{projection.azimuth.toFixed(0)}° El:{projection.elevation.toFixed(0)}° Zoom:{(projection.zoom / 10).toFixed(1)}x | {surface.nx}x{surface.ny} pts
          </Text>
          {enableControls && (
            <Text dimColor>←↑↓→ rotate, +/- zoom, r reset, q quit</Text>
          )}
        </Box>
      )}
    </Box>
  )
}

/**
 * Risk summary widget - shows risk metrics in compact form
 */
export interface RiskSummaryProps {
  metrics: RiskMetrics | null
  title?: string
}

export function RiskSummary({ metrics, title = 'Risk Analysis' }: RiskSummaryProps): React.ReactElement {
  if (!metrics) {
    return (
      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        <Text bold>{title}</Text>
        <Text dimColor>Waiting for data...</Text>
      </Box>
    )
  }

  const lines = generateRiskSummary(metrics)
  const riskDisplay = formatRiskScore(metrics.riskScore)

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text color={riskDisplay.color} bold>
          {riskDisplay.text}
        </Text>
      </Box>
      {lines.map((line, i) => (
        <Text key={i} dimColor={i > 0}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

/**
 * Cross-section widget - shows 2D slice of surface
 */
export interface CrossSectionProps {
  surface: SurfaceData<Vec64 | Vec32> | null
  axis: 'x' | 'y'
  index: number
  title?: string
  width?: number
  height?: number
}

export function CrossSection({
  surface,
  axis,
  index,
  title,
  width = 40,
  height = 10,
}: CrossSectionProps): React.ReactElement {
  if (!surface) {
    return (
      <Box flexDirection="column" borderStyle="single" width={width}>
        <Text bold>{title || `${axis.toUpperCase()} Cross-Section`}</Text>
        <Text dimColor>No data</Text>
      </Box>
    )
  }

  // Extract slice data
  const sliceData: number[] = []
  if (axis === 'x') {
    // Fixed x, varying y
    const xi = Math.min(index, surface.nx - 1)
    for (let j = 0; j < surface.ny; j++) {
      sliceData.push(surface.z[xi * surface.ny + j]!)
    }
  } else {
    // Fixed y, varying x
    const yi = Math.min(index, surface.ny - 1)
    for (let i = 0; i < surface.nx; i++) {
      sliceData.push(surface.z[i * surface.ny + yi]!)
    }
  }

  // Simple sparkline
  const min = Math.min(...sliceData)
  const max = Math.max(...sliceData)
  const range = max - min || 1
  const sparkChars = '▁▂▃▄▅▆▇█'

  const sparkline = sliceData
    .map((v) => {
      const norm = (v - min) / range
      const idx = Math.min(Math.floor(norm * sparkChars.length), sparkChars.length - 1)
      return sparkChars[idx]
    })
    .join('')

  const axisLabel = axis === 'x' ? surface.meta.xLabel : surface.meta.yLabel
  const axisValue = axis === 'x' ? surface.x[index] : surface.y[index]

  return (
    <Box flexDirection="column" borderStyle="single" width={width} paddingX={1}>
      <Text bold>{title || `${axisLabel} = ${axisValue?.toFixed(2)}`}</Text>
      <Text>{sparkline}</Text>
      <Text dimColor>
        Range: {min.toFixed(4)} - {max.toFixed(4)}
      </Text>
    </Box>
  )
}

export default SurfaceWidget
