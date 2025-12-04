/**
 * Main TUI Application
 * Renders the 7-column risk oracle layout with Ink
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { useMouse } from './useMouseScroll.ts'
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
import { Timeline, EventList } from './Timeline.tsx'
import {
  createPlaylist,
  nextSnapshot,
  prevSnapshot,
  jumpToEvent,
  type VolatilityPlaylist,
  type VolatilitySnapshot,
} from '../chain/volatility.ts'
import { VOLATILITY_EVENTS } from '../chain/config.ts'

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

// Pool Liquidity Panel - shows liquidity across fee tiers
function LiquidityPanel({ snapshot, width, height }: { snapshot: VolatilitySnapshot | null; width: number; height: number }) {
  if (!snapshot) return <Box width={width} height={height}><Text dimColor>Loading...</Text></Box>

  const tiers = [500, 3000, 10000] // Fee tiers in bps
  const tierLabels = ['0.05%', '0.30%', '1.00%']

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" width={width} height={height} paddingX={1}>
      <Text bold color="green">◈ Pool Liquidity</Text>
      {tiers.map((fee, i) => {
        const state = snapshot.poolStates.get(fee)
        const liq = state ? Number(state.liquidity) / 1e15 : 0
        const barWidth = Math.min(width - 12, Math.floor(liq * 2))
        return (
          <Box key={fee}>
            <Text color="cyan">{tierLabels[i]} </Text>
            <Text color="green">{'█'.repeat(Math.max(1, barWidth))}</Text>
            <Text dimColor> {liq.toFixed(1)}T</Text>
          </Box>
        )
      })}
    </Box>
  )
}

// Volatility Stats Panel - ATM IV, wings, term spread
function VolStatsPanel({ surface, width, height }: { surface: any; width: number; height: number }) {
  if (!surface) return <Box width={width} height={height}><Text dimColor>Loading...</Text></Box>

  // Calculate key vol metrics
  const z = surface.z as Float64Array
  const nx = surface.nx
  const ny = surface.ny
  const atmIndex = Math.floor(nx / 2)

  // ATM IV across expiries
  const atmIVs: number[] = []
  for (let j = 0; j < ny; j++) {
    atmIVs.push(z[j * nx + atmIndex]! * 100)
  }

  // Wing IVs (25-delta equivalent)
  const wingOffset = Math.floor(nx * 0.25)
  const putWing = z[wingOffset]! * 100
  const callWing = z[nx - 1 - wingOffset]! * 100

  // Skew = put wing - call wing
  const skew25 = putWing - callWing

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" width={width} height={height} paddingX={1}>
      <Text bold color="yellow">◈ Vol Stats</Text>
      <Box>
        <Text color="cyan">ATM: </Text>
        <Text bold color="white">{atmIVs[0]?.toFixed(1)}%</Text>
        <Text dimColor> → </Text>
        <Text color="white">{atmIVs[ny - 1]?.toFixed(1)}%</Text>
      </Box>
      <Box>
        <Text color="magenta">Put25: </Text>
        <Text color="red">{putWing.toFixed(1)}%</Text>
        <Text dimColor> | </Text>
        <Text color="magenta">Call25: </Text>
        <Text color="green">{callWing.toFixed(1)}%</Text>
      </Box>
      <Box>
        <Text color="blue">25Δ Skew: </Text>
        <Text color={skew25 > 5 ? 'red' : skew25 < -5 ? 'green' : 'yellow'}>{skew25 > 0 ? '+' : ''}{skew25.toFixed(1)}%</Text>
      </Box>
    </Box>
  )
}

// Greeks Panel - estimated sensitivities
function GreeksPanel({ surface, snapshot, width, height }: { surface: any; snapshot: VolatilitySnapshot | null; width: number; height: number }) {
  if (!surface || !snapshot) return <Box width={width} height={height}><Text dimColor>Loading...</Text></Box>

  // Estimate vega and gamma from surface shape
  const z = surface.z as Float64Array
  const nx = surface.nx
  const avgIV = Array.from(z).reduce((a, b) => a + b, 0) / z.length

  // Vega estimate: higher IV = higher vega
  const vegaEst = avgIV * snapshot.ethPrice * 0.01 * Math.sqrt(30 / 365)

  // Gamma estimate: curvature of surface
  const atmIndex = Math.floor(nx / 2)
  const gamma = Math.abs(z[atmIndex]! - z[atmIndex - 1]!) * 100

  // Theta estimate: term structure slope
  const frontIV = z[atmIndex]!
  const backIV = z[(surface.ny - 1) * nx + atmIndex]!
  const theta = (frontIV - backIV) * snapshot.ethPrice * -0.1

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" width={width} height={height} paddingX={1}>
      <Text bold color="blue">◈ Greeks (Est)</Text>
      <Box>
        <Text color="cyan">Vega: </Text>
        <Text color="white">${vegaEst.toFixed(2)}</Text>
        <Text dimColor>/1% IV</Text>
      </Box>
      <Box>
        <Text color="magenta">Gamma: </Text>
        <Text color="white">{gamma.toFixed(3)}</Text>
        <Text dimColor>/1% move</Text>
      </Box>
      <Box>
        <Text color="yellow">Θ decay: </Text>
        <Text color={theta < 0 ? 'red' : 'green'}>${theta.toFixed(2)}</Text>
        <Text dimColor>/day</Text>
      </Box>
    </Box>
  )
}

// Oracle Data Panel - shows what would be pushed on-chain (horizontal layout)
function OracleDataPanel({
  surface,
  snapshot,
  metrics,
  width,
  height
}: {
  surface: any;
  snapshot: VolatilitySnapshot | null;
  metrics: RiskMetrics | null;
  width: number;
  height: number
}) {
  if (!surface || !snapshot) {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="green" width={width} height={height} paddingX={1}>
        <Text bold color="green">◆ ORACLE TX</Text>
        <Text dimColor>Awaiting data...</Text>
      </Box>
    )
  }

  // Calculate the key on-chain metrics (matching IVolatilityOracle.sol)
  const z = surface.z as Float64Array
  const nx = surface.nx
  const ny = surface.ny
  const atmIndex = Math.floor(nx / 2)

  // Realized Vol (from surface variance)
  const allIVs = Array.from(z)
  const avgIV = allIVs.reduce((a, b) => a + b, 0) / allIVs.length
  const variance = allIVs.reduce((a, b) => a + (b - avgIV) ** 2, 0) / allIVs.length
  const realizedVol = Math.sqrt(variance) * Math.sqrt(252) // Annualized

  // Implied Vol (ATM)
  const impliedVol = z[atmIndex]!

  // Vol Risk Premium (IV - RV)
  const volRiskPremium = impliedVol - realizedVol

  // 25-delta Skew
  const wingOffset = Math.floor(nx * 0.25)
  const putWing = z[wingOffset]!
  const callWing = z[nx - 1 - wingOffset]!
  const skew25Delta = putWing - callWing

  // Term Structure (back - front)
  const frontIV = z[atmIndex]!
  const backIV = z[(ny - 1) * nx + atmIndex]!
  const termStructure = backIV - frontIV

  // Risk Score from metrics
  const riskScore = metrics?.riskScore ?? snapshot.riskScore

  // Format values for display (18 decimals on-chain, show as %)
  const formatPct = (v: number) => (v * 100).toFixed(1)
  const formatSigned = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1)

  // Vertical bar component (height-based)
  const VerticalBar = ({ label, value, maxVal, color, displayVal }: {
    label: string; value: number; maxVal: number; color: string; displayVal: string
  }) => {
    const barHeight = height - 5 // Leave room for label and value
    const normalized = Math.min(1, Math.abs(value) / maxVal)
    const filled = Math.floor(normalized * barHeight)
    const empty = barHeight - filled

    return (
      <Box flexDirection="column" alignItems="center" marginX={1}>
        <Text bold color={color as any}>{displayVal}</Text>
        {Array.from({ length: empty }).map((_, i) => (
          <Text key={`e${i}`} dimColor>░</Text>
        ))}
        {Array.from({ length: filled }).map((_, i) => (
          <Text key={`f${i}`} color={color as any}>█</Text>
        ))}
        <Text bold color="cyan">{label}</Text>
      </Box>
    )
  }

  // Calculate colors for each metric
  const rvColor = 'green'
  const ivColor = 'cyan'
  const vrpColor = volRiskPremium >= 0 ? 'green' : 'red'
  const skewColor = Math.abs(skew25Delta) > 0.1 ? 'red' : skew25Delta >= 0 ? 'yellow' : 'blue'
  const termColor = termStructure >= 0 ? 'yellow' : 'magenta'
  const riskColor = riskScore > 0.7 ? 'red' : riskScore > 0.4 ? 'yellow' : 'green'

  return (
    <Box borderStyle="double" borderColor="green" width={width} height={height} paddingX={1}>
      {/* Title and metadata */}
      <Box flexDirection="column" width={20} marginRight={2}>
        <Box>
          <Text bold color="green">◆ </Text>
          <Text bold color="white">ORACLE</Text>
        </Box>
        <Box>
          <Text bold color="green">  PAYLOAD</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="blue">Block</Text>
        </Box>
        <Box>
          <Text color="white">{snapshot.blockNumber.toLocaleString()}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="blue">Gas: </Text>
          <Text color="green">~45k</Text>
        </Box>
        <Box>
          <Text color="cyan">21 ticks</Text>
        </Box>
      </Box>

      {/* Vertical bars for each metric */}
      <Box flexGrow={1} justifyContent="space-around">
        <VerticalBar label="RV" value={realizedVol} maxVal={3} color={rvColor} displayVal={formatPct(realizedVol) + '%'} />
        <VerticalBar label="IV" value={impliedVol} maxVal={1.5} color={ivColor} displayVal={formatPct(impliedVol) + '%'} />
        <VerticalBar label="VRP" value={Math.abs(volRiskPremium)} maxVal={1.5} color={vrpColor} displayVal={formatSigned(volRiskPremium) + '%'} />
        <VerticalBar label="Skew" value={Math.abs(skew25Delta)} maxVal={0.3} color={skewColor} displayVal={formatSigned(skew25Delta) + '%'} />
        <VerticalBar label="Term" value={Math.abs(termStructure)} maxVal={0.3} color={termColor} displayVal={formatSigned(termStructure) + '%'} />
        <VerticalBar label="RISK" value={riskScore} maxVal={1} color={riskColor} displayVal={(riskScore * 100).toFixed(0) + '%'} />
      </Box>

      {/* Encoded calldata preview */}
      <Box flexDirection="column" width={35} marginLeft={2} borderStyle="round" borderColor="blue" paddingX={1}>
        <Text bold color="blue">Calldata Preview</Text>
        <Text color="gray" wrap="truncate">update(</Text>
        <Text color="white" wrap="truncate">  price: {snapshot.ethPrice}e18</Text>
        <Text color="white" wrap="truncate">  rv: {(realizedVol * 1e18).toExponential(2)}</Text>
        <Text color="white" wrap="truncate">  iv: {(impliedVol * 1e18).toExponential(2)}</Text>
        <Text color="white" wrap="truncate">  skew: {(skew25Delta * 1e18).toExponential(2)}</Text>
        <Text color="white" wrap="truncate">  risk: {(riskScore * 1e18).toExponential(2)}</Text>
        <Text color="gray" wrap="truncate">)</Text>
      </Box>
    </Box>
  )
}

// Market Context Panel
function MarketPanel({ snapshot, width, height }: { snapshot: VolatilitySnapshot | null; width: number; height: number }) {
  if (!snapshot) return <Box width={width} height={height}><Text dimColor>Loading...</Text></Box>

  const severityColor = snapshot.eventSeverity === 'extreme' ? 'red' :
    snapshot.eventSeverity === 'high' ? 'yellow' :
    snapshot.eventSeverity === 'elevated' ? 'magenta' : 'green'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" width={width} height={height} paddingX={1}>
      <Text bold color="cyan">◈ Market</Text>
      <Box>
        <Text color="green">ETH: </Text>
        <Text bold color="white">${snapshot.ethPrice.toFixed(0)}</Text>
      </Box>
      <Box>
        <Text color="blue">Block: </Text>
        <Text color="white">{snapshot.blockNumber.toLocaleString()}</Text>
      </Box>
      {snapshot.eventName && (
        <Box>
          <Text color={severityColor}>⚡ {snapshot.eventName.slice(0, width - 6)}</Text>
        </Box>
      )}
      <Box>
        <Text color="yellow">Risk: </Text>
        <Text bold color={severityColor}>{(snapshot.riskScore * 100).toFixed(0)}%</Text>
      </Box>
    </Box>
  )
}

// Status Bar
function StatusBar({ width }: { width: number }) {
  const time = new Date().toLocaleTimeString()
  return (
    <Box width={width} justifyContent="space-between" paddingX={1} borderStyle="double" borderColor="magenta">
      <Text bold color="magenta">◆ UNISWAP v4 ◆</Text>
      <Text color="cyan">{time}</Text>
      <Text color="blue">scroll seek</Text>
      <Text color="yellow">drag rotate</Text>
      <Text color="green">z+scroll zoom</Text>
      <Text color="white">p play</Text>
      <Text color="magenta">1-5 events</Text>
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

  // New layout: cube + two rows of bottom panels
  const timelineHeight = 7           // Compact timeline
  const bottomPanelHeight = 7        // Data panels row (slightly shorter)
  const oraclePanelHeight = 12       // Oracle panel row (taller for bars)
  const statusHeight = 3             // Status bar
  const cubeHeight = termHeight - timelineHeight - bottomPanelHeight - oraclePanelHeight - statusHeight
  const cubeWidth = termWidth
  const panelWidth = Math.floor(termWidth / 6) // 6 panels across bottom

  // State
  const [playlist, setPlaylist] = useState<VolatilityPlaylist>(() => createPlaylist())
  const [currentSnapshot, setCurrentSnapshot] = useState<VolatilitySnapshot | null>(() =>
    playlist.snapshots[0] || null
  )
  const [surface, setSurface] = useState(() =>
    currentSnapshot?.surface || generateDemoSurface()
  )
  const [projection, setProjection] = useState(() =>
    createProjection(cubeWidth - 4, cubeHeight - 4, { azimuth: 45, elevation: 30, zoom: 40 })
  )
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null)
  const [arbitrage, setArbitrage] = useState<ArbitrageOpportunity[]>([])
  const [alerts, setAlerts] = useState<string[]>(['◆ Uniswap v4 Volatility Surface'])
  const [paused, setPaused] = useState(false)
  const [playlistPlaying, setPlaylistPlaying] = useState(false)

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

  // Update surface when snapshot changes
  useEffect(() => {
    if (currentSnapshot) {
      setSurface(currentSnapshot.surface)
      setAlerts(prev => {
        const newAlert = currentSnapshot.eventName
          ? `⚡ ${currentSnapshot.eventName} - ${currentSnapshot.date}`
          : `Block ${currentSnapshot.blockNumber.toLocaleString()}`
        return [...prev.slice(-10), newAlert]
      })
    }
  }, [currentSnapshot])

  // Playlist auto-advance when playing
  useEffect(() => {
    if (!playlistPlaying) return
    const interval = setInterval(() => {
      setPlaylist(p => {
        const next = nextSnapshot(p)
        if (next) {
          setCurrentSnapshot(next)
        } else {
          setPlaylistPlaying(false) // Stop at end
        }
        return { ...p }
      })
    }, playlist.playbackSpeed)
    return () => clearInterval(interval)
  }, [playlistPlaying, playlist.playbackSpeed])

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
    if (input === ' ') setPaused(p => !p) // spacebar toggles rotation pause
    if (input === 'p') setPlaylistPlaying(p => !p) // p toggles playlist playback

    // Playlist navigation with [ and ]
    if (input === '[' || input === ',') {
      setPlaylist(p => {
        const prev = prevSnapshot(p)
        if (prev) setCurrentSnapshot(prev)
        return { ...p }
      })
    }
    if (input === ']' || input === '.') {
      setPlaylist(p => {
        const next = nextSnapshot(p)
        if (next) setCurrentSnapshot(next)
        return { ...p }
      })
    }

    // Jump to events with number keys
    if (input >= '1' && input <= '5') {
      const eventIndex = parseInt(input) - 1
      const event = VOLATILITY_EVENTS[eventIndex]
      if (event) {
        setPlaylist(p => {
          const snapshot = jumpToEvent(p, event.name)
          if (snapshot) setCurrentSnapshot(snapshot)
          return { ...p }
        })
      }
    }

    // Rotation controls
    if (key.leftArrow) setProjection(p => rotateProjection(p, -5, 0))
    if (key.rightArrow) setProjection(p => rotateProjection(p, 5, 0))
    if (key.upArrow) setProjection(p => rotateProjection(p, 0, 5))
    if (key.downArrow) setProjection(p => rotateProjection(p, 0, -5))
    if (input === '+' || input === '=') setProjection(p => zoomProjection(p, 1.1))
    if (input === '-') setProjection(p => zoomProjection(p, 0.9))
    if (input === 'r') setSurface(generateDemoSurface())
  })

  // Mouse controls: scroll for playlist, shift+scroll for zoom, drag for rotation
  useMouse({
    onScroll: useCallback((event) => {
      if (event.shift) {
        // Shift + scroll = zoom
        const zoomFactor = event.direction === 'up' ? 1.15 : 0.87
        setProjection(p => zoomProjection(p, zoomFactor))
      } else {
        // Normal scroll = playlist navigation
        if (event.direction === 'up') {
          setPlaylist(p => {
            const prev = prevSnapshot(p)
            if (prev) setCurrentSnapshot(prev)
            return { ...p }
          })
        } else {
          setPlaylist(p => {
            const next = nextSnapshot(p)
            if (next) setCurrentSnapshot(next)
            return { ...p }
          })
        }
      }
    }, []),
    onDrag: useCallback((event) => {
      // Click and drag to rotate
      const azDelta = event.deltaX * 3  // 3 degrees per character
      const elDelta = -event.deltaY * 3 // Invert Y for natural feel
      setProjection(p => rotateProjection(p, azDelta, elDelta))
    }, []),
  })

  // Update playlist state for display
  const displayPlaylist: VolatilityPlaylist = {
    ...playlist,
    isPlaying: playlistPlaying,
  }

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* Timeline at top */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Timeline playlist={displayPlaylist} width={termWidth - 4} />
      </Box>

      {/* Large 3D surface - full width */}
      <SurfacePanel
        surface={surface}
        projection={projection}
        width={cubeWidth}
        height={cubeHeight}
        paused={paused}
      />

      {/* Oracle Data panel - full width, shows what gets pushed on-chain */}
      <OracleDataPanel
        surface={surface}
        snapshot={currentSnapshot}
        metrics={metrics}
        width={termWidth}
        height={oraclePanelHeight}
      />

      {/* Bottom data panels row */}
      <Box>
        <MarketPanel snapshot={currentSnapshot} width={panelWidth} height={bottomPanelHeight} />
        <VolStatsPanel surface={surface} width={panelWidth} height={bottomPanelHeight} />
        <GreeksPanel surface={surface} snapshot={currentSnapshot} width={panelWidth} height={bottomPanelHeight} />
        <LiquidityPanel snapshot={currentSnapshot} width={panelWidth} height={bottomPanelHeight} />
        <TermStructurePanel surface={surface} width={panelWidth} height={bottomPanelHeight} />
        <SmilePanel surface={surface} width={panelWidth} height={bottomPanelHeight} />
      </Box>

      {/* Status bar at bottom */}
      <StatusBar width={termWidth} />
    </Box>
  )
}

export default App
