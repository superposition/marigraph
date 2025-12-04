/**
 * Main TUI Application
 * Renders the 7-column risk oracle layout with Ink
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { createSurface } from '../data/surface.ts'
import { linspace } from '../data/vec.ts'
import { computeSlope } from '../data/surface.ts'
import { computeRiskMetrics, formatRiskScore } from '../render/gradient.ts'
import type { RiskMetrics } from '../render/gradient.ts'
import { createProjection, rotateProjection, zoomProjection } from '../render/project.ts'
import type { Projection } from '../render/project.ts'
import { renderCubeFrame, surfaceToPoints } from '../render/cube.ts'
import { rasterizeCubeFrame, type RasterBuffer } from '../render/rasterize.ts'
import {
  analyzeTermStructure,
  analyzeSmile,
  detectArbitrage,
  type ArbitrageOpportunity,
} from '../oracle/risk.ts'
import { sparkline } from '../column/widgets/Chart.tsx'

// Ink color type
type InkColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'

// Render colored buffer using Ink Text components
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
        if (currentText) {
          const key = `${y}-${spans.length}`
          if (currentColor) {
            spans.push(<Text key={key} color={currentColor as InkColor}>{currentText}</Text>)
          } else {
            spans.push(<Text key={key}>{currentText}</Text>)
          }
        }
        currentColor = color
        currentText = char
      }
    }

    if (currentText) {
      const key = `${y}-${spans.length}`
      if (currentColor) {
        spans.push(<Text key={key} color={currentColor as InkColor}>{currentText}</Text>)
      } else {
        spans.push(<Text key={key}>{currentText}</Text>)
      }
    }

    rows.push(<Box key={y}>{spans}</Box>)
  }

  return <Box flexDirection="column">{rows}</Box>
}

// Generate demo surface data
function generateDemoSurface() {
  const nx = 20 // DTE points (higher resolution)
  const ny = 25 // Strike points (higher resolution)

  const x = linspace(0.02, 1.0, nx) // 1 week to 1 year
  const y = linspace(80, 120, ny) // Strikes from 80 to 120
  const z = new Float64Array(nx * ny)

  // Generate realistic IV surface with smile and term structure
  for (let i = 0; i < nx; i++) {
    const dte = x[i]!
    for (let j = 0; j < ny; j++) {
      const strike = y[j]!
      const moneyness = (strike - 100) / 100

      // Base IV decreases with time (term structure)
      const baseIV = 0.25 - 0.05 * Math.sqrt(dte)

      // Smile effect (quadratic in moneyness)
      const smile = 0.15 * moneyness * moneyness

      // Skew (puts have higher IV)
      const skew = -0.08 * moneyness

      // Add some noise
      const noise = (Math.random() - 0.5) * 0.02

      z[i * ny + j] = Math.max(0.05, baseIV + smile + skew + noise)
    }
  }

  return createSurface(x, y, z, {
    xLabel: 'DTE',
    yLabel: 'Strike',
    zLabel: 'IV',
  })
}

// Synthwave color palette
const SYNTH = {
  pink: '#ff6ac1',
  cyan: '#00d9ff',
  purple: '#bd93f9',
  yellow: '#f1fa8c',
  orange: '#ffb86c',
  green: '#50fa7b',
  red: '#ff5555',
  blue: '#8be9fd',
}

// Term Structure Panel
function TermStructurePanel({ surface, width, height }: { surface: any; width: number; height: number }) {
  if (!surface) return <Box borderStyle="round" borderColor="magenta" width={width} height={height}><Text color="magenta">Loading...</Text></Box>

  const analysis = analyzeTermStructure(surface, [0, Math.floor(surface.ny / 2), surface.ny - 1])
  const midCurve = analysis.curves.get(analysis.strikes[1]!)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" width={width} height={height} paddingX={1}>
      <Text bold color="magenta">Term Structure</Text>
      <Text color={analysis.contango ? 'green' : analysis.backwardation ? 'red' : 'yellow'}>
        {analysis.contango ? '↗ Contango' : analysis.backwardation ? '↘ Backwardation' : '→ Flat'}
      </Text>
      {midCurve && (
        <Text color="cyan">{sparkline(midCurve.iv.map(v => v * 100))}</Text>
      )}
      <Text color="magenta">Flat: {(analysis.flatness * 100).toFixed(0)}%</Text>
    </Box>
  )
}

// Smile Panel
function SmilePanel({ surface, width, height }: { surface: any; width: number; height: number }) {
  if (!surface) return <Box borderStyle="round" borderColor="cyan" width={width} height={height}><Text color="cyan">Loading...</Text></Box>

  const analysis = analyzeSmile(surface, [0, Math.floor(surface.nx / 2)], Math.floor(surface.ny / 2))
  const midSmile = analysis.smiles.get(analysis.dtes[1]!)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" width={width} height={height} paddingX={1}>
      <Text bold color="cyan">Smile / Skew</Text>
      <Text color={analysis.skewDirection === 'put' ? 'red' : analysis.skewDirection === 'call' ? 'green' : 'yellow'}>
        ◈ {analysis.skewDirection.toUpperCase()}
      </Text>
      {midSmile && (
        <Text color="magenta">{sparkline(midSmile.iv.map(v => v * 100))}</Text>
      )}
      <Text color="cyan">ATM: {(analysis.atmIV * 100).toFixed(1)}%</Text>
      <Text color="blue">Bfly: {(analysis.butterflySpread * 100).toFixed(2)}%</Text>
    </Box>
  )
}

// 3D Surface Panel
function SurfacePanel({
  surface,
  projection,
  width,
  height,
  paused = false
}: {
  surface: any;
  projection: Projection;
  width: number;
  height: number;
  paused?: boolean;
}) {
  if (!surface) {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="magenta" width={width} height={height}>
        <Text bold color="magenta"> ◇ 3D Surface</Text>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color="cyan">Loading surface data...</Text>
        </Box>
      </Box>
    )
  }

  // Render the surface with colors
  const points = surfaceToPoints(surface.x, surface.y, surface.z, surface.nx, surface.ny)
  const frame = renderCubeFrame(points, projection, {
    showWireframe: true,
    showGrid: true,
    showAxes: true,
    axisLabels: { x: 'DTE', y: 'K', z: 'IV' },
  })
  const buffer = rasterizeCubeFrame(frame, width - 4, height - 4, { colorBySurface: true })

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="magenta" width={width} height={height}>
      <Box justifyContent="center">
        <Text bold color="magenta"> ◆ </Text>
        <Text bold color="cyan">Volatility Surface</Text>
        <Text bold color="magenta"> ◆ </Text>
      </Box>
      <Box paddingX={1} flexDirection="column">
        <ColoredBuffer buffer={buffer} />
      </Box>
      <Box justifyContent="center">
        <Text color="blue">
          Az:{projection.azimuth.toFixed(0)}° El:{projection.elevation.toFixed(0)}° Z:{(projection.zoom / 10).toFixed(1)}x
        </Text>
        {paused && <Text color="yellow" bold> PAUSED</Text>}
      </Box>
    </Box>
  )
}

// Slope Analysis Panel
function SlopePanel({ metrics, width, height }: { metrics: RiskMetrics | null; width: number; height: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" width={width} height={height} paddingX={1}>
      <Text bold color="yellow">◈ Slope</Text>
      {metrics ? (
        <>
          <Text color="white">Max: {metrics.maxSlope.toFixed(4)}</Text>
          <Text color="white">Avg: {metrics.avgSlope.toFixed(4)}</Text>
          <Text color="yellow">Var: {metrics.slopeVariance.toFixed(4)}</Text>
          <Text color="yellow">Term: {metrics.termStructureSteepness.toFixed(4)}</Text>
        </>
      ) : (
        <Text color="yellow">Computing...</Text>
      )}
    </Box>
  )
}

// Arbitrage Panel
function ArbitragePanel({ opportunities, width, height }: { opportunities: ArbitrageOpportunity[]; width: number; height: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" width={width} height={height} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="green">◈ Arb</Text>
        <Text color={opportunities.length > 0 ? 'red' : 'green'}>{opportunities.length}</Text>
      </Box>
      {opportunities.length === 0 ? (
        <Text color="green">✓ Clean</Text>
      ) : (
        opportunities.slice(0, height - 3).map((arb, i) => (
          <Text key={i} color="red">
            ⚠ {arb.type[0]?.toUpperCase()}: {arb.description.slice(0, width - 8)}
          </Text>
        ))
      )}
    </Box>
  )
}

// Risk Score Panel
function RiskScorePanel({ metrics, width, height }: { metrics: RiskMetrics | null; width: number; height: number }) {
  const score = metrics?.riskScore ?? 0
  const barWidth = width - 6
  const filled = Math.round(score * barWidth)
  const { text, color } = metrics ? formatRiskScore(metrics.riskScore) : { text: '---', color: 'gray' as const }

  // Synthwave gradient for risk bar
  const riskColor = score < 0.3 ? 'cyan' : score < 0.6 ? 'yellow' : score < 0.8 ? 'magenta' : 'red'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" width={width} height={height} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="blue">◈ Risk</Text>
        <Text bold color={riskColor}>{text}</Text>
      </Box>
      <Text>
        <Text color={riskColor}>{'▓'.repeat(filled)}</Text>
        <Text color="blue">{'░'.repeat(Math.max(0, barWidth - filled))}</Text>
      </Text>
      <Text color={riskColor}>{(score * 100).toFixed(0)}%</Text>
    </Box>
  )
}

// Alerts Panel
function AlertsPanel({ alerts, width, height }: { alerts: string[]; width: number; height: number }) {
  const visible = alerts.slice(-height + 3)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" width={width} height={height} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="red">◈ Alerts</Text>
        <Text color="magenta">{alerts.length}</Text>
      </Box>
      {visible.length === 0 ? (
        <Text color="green">✓ Clear</Text>
      ) : (
        visible.map((alert, i) => (
          <Text key={i} color="yellow">⚡ {alert.slice(0, width - 6)}</Text>
        ))
      )}
    </Box>
  )
}

// Status Bar
function StatusBar({ width }: { width: number }) {
  const time = new Date().toLocaleTimeString()
  return (
    <Box width={width} justifyContent="space-between" paddingX={1} borderStyle="double" borderColor="magenta">
      <Text bold color="magenta">◆ MARIGRAPH ◆</Text>
      <Text color="cyan">{time}</Text>
      <Text color="blue">←↑↓→ rotate</Text>
      <Text color="yellow">+/- zoom</Text>
      <Text color="white">space pause</Text>
      <Text color="green">r refresh</Text>
      <Text color="red">q quit</Text>
    </Box>
  )
}

// Main App
export function App() {
  const { exit } = useApp()
  const { stdout } = useStdout()

  const termWidth = stdout?.columns ?? 120
  const termHeight = stdout?.rows ?? 40

  // Layout calculations - maximize cube space
  const sideWidth = Math.floor(termWidth * 0.15) // Narrower side panels
  const centerWidth = termWidth - sideWidth * 2  // ~70% for cube
  const surfaceHeight = termHeight - 3           // Almost full height for surface
  const panelHeight = Math.floor(surfaceHeight / 3) // Stack 3 panels per side

  // State
  const [surface, setSurface] = useState(() => generateDemoSurface())
  const [projection, setProjection] = useState(() =>
    createProjection(centerWidth - 4, surfaceHeight - 4, { azimuth: 45, elevation: 30, zoom: 32 })
  )
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null)
  const [arbitrage, setArbitrage] = useState<ArbitrageOpportunity[]>([])
  const [alerts, setAlerts] = useState<string[]>(['◆ System online'])
  const [paused, setPaused] = useState(false)

  // Compute metrics when surface changes
  useEffect(() => {
    if (surface) {
      const slope = computeSlope(surface)
      const newMetrics = computeRiskMetrics(slope, surface.nx, surface.ny)
      setMetrics(newMetrics)

      const arbs = detectArbitrage(surface)
      setArbitrage(arbs)

      if (newMetrics.riskScore > 0.7) {
        setAlerts(prev => [...prev.slice(-50), `High risk: ${(newMetrics.riskScore * 100).toFixed(0)}%`])
      }
    }
  }, [surface])

  // Regenerate surface periodically for demo
  useEffect(() => {
    const interval = setInterval(() => {
      setSurface(generateDemoSurface())
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Auto-rotate azimuth by 5 degrees (when not paused)
  useEffect(() => {
    if (paused) return
    const interval = setInterval(() => {
      setProjection(p => rotateProjection(p, 5, 0))
    }, 200)
    return () => clearInterval(interval)
  }, [paused])

  // Keyboard controls
  useInput((input, key) => {
    if (input === 'q') exit()
    if (input === ' ') setPaused(p => !p) // spacebar toggles pause
    if (key.leftArrow) setProjection(p => rotateProjection(p, -5, 0))
    if (key.rightArrow) setProjection(p => rotateProjection(p, 5, 0))
    if (key.upArrow) setProjection(p => rotateProjection(p, 0, 5))
    if (key.downArrow) setProjection(p => rotateProjection(p, 0, -5))
    if (input === '+' || input === '=') setProjection(p => zoomProjection(p, 1.1))
    if (input === '-') setProjection(p => zoomProjection(p, 0.9))
    if (input === 'r') setSurface(generateDemoSurface())
  })

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* Main content row - side panels stacked vertically, cube in center */}
      <Box flexGrow={1}>
        {/* Left side - stacked panels */}
        <Box flexDirection="column" width={sideWidth}>
          <TermStructurePanel surface={surface} width={sideWidth} height={panelHeight} />
          <SlopePanel metrics={metrics} width={sideWidth} height={panelHeight} />
          <RiskScorePanel metrics={metrics} width={sideWidth} height={panelHeight} />
        </Box>

        {/* Center - large 3D surface */}
        <SurfacePanel
          surface={surface}
          projection={projection}
          width={centerWidth}
          height={surfaceHeight}
          paused={paused}
        />

        {/* Right side - stacked panels */}
        <Box flexDirection="column" width={sideWidth}>
          <SmilePanel surface={surface} width={sideWidth} height={panelHeight} />
          <ArbitragePanel opportunities={arbitrage} width={sideWidth} height={panelHeight} />
          <AlertsPanel alerts={alerts} width={sideWidth} height={panelHeight} />
        </Box>
      </Box>

      {/* Status bar at bottom */}
      <StatusBar width={termWidth} />
    </Box>
  )
}

export default App
