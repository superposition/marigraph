/**
 * Risk Oracle Application
 * 7-column layout with 3D surface in center and risk analysis panels
 *
 * Layout:
 * ┌─────────────┬─────────────────────────┬─────────────┐
 * │ Term        │                         │ Smile       │
 * │ Structure   │     3D SURFACE CUBE     │ Skew        │
 * ├─────────────┤       (center)          ├─────────────┤
 * │ Greeks      │                         │ Arbitrage   │
 * │ Risk        │                         │ Detection   │
 * ├─────────────┼─────────────────────────┼─────────────┤
 * │ Risk Score  │      Status / Log       │ Alerts      │
 * └─────────────┴─────────────────────────┴─────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import type { Surface } from '../../data/surface.ts'
import type { Vec64 } from '../../data/vec.ts'
import { SurfaceWidget, RiskSummary, CrossSection } from './Surface.tsx'
import type { RiskMetrics } from '../../render/gradient.ts'
import {
  createRiskOracleState,
  updateRiskOracle,
  type RiskOracleState,
  type RiskAlert,
  type ArbitrageOpportunity,
} from '../../oracle/risk.ts'

export interface RiskOracleAppProps {
  /** Initial surface data */
  surface?: Surface<Vec64> | null
  /** Called when surface updates */
  onSurfaceUpdate?: (surface: Surface<Vec64>) => void
  /** IPC message handler */
  onMessage?: (msg: unknown) => void
}

/**
 * Term Structure Panel
 */
function TermStructurePanel({
  state,
  width,
  height,
}: {
  state: RiskOracleState
  width: number
  height: number
}): React.ReactElement {
  const analysis = state.termStructure

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      width={width}
      height={height}
    >
      <Box paddingX={1}>
        <Text bold>Term Structure</Text>
      </Box>
      {analysis ? (
        <Box flexDirection="column" paddingX={1}>
          <Text>
            Structure:{' '}
            <Text color={analysis.contango ? 'green' : analysis.backwardation ? 'red' : 'yellow'}>
              {analysis.contango ? 'Contango' : analysis.backwardation ? 'Backwardation' : 'Flat'}
            </Text>
          </Text>
          <Text dimColor>Flatness: {(analysis.flatness * 100).toFixed(0)}%</Text>
          <Text dimColor>Inflections: {analysis.inflectionPoints.length}</Text>
          {state.surface && (
            <CrossSection
              surface={state.surface}
              axis="x"
              index={Math.floor(state.surface.ny / 2)}
              width={width - 4}
              height={4}
            />
          )}
        </Box>
      ) : (
        <Text dimColor paddingX={1}>
          Loading...
        </Text>
      )}
    </Box>
  )
}

/**
 * Smile Skew Panel
 */
function SmileSkewPanel({
  state,
  width,
  height,
}: {
  state: RiskOracleState
  width: number
  height: number
}): React.ReactElement {
  const analysis = state.smile

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      width={width}
      height={height}
    >
      <Box paddingX={1}>
        <Text bold>Smile / Skew</Text>
      </Box>
      {analysis ? (
        <Box flexDirection="column" paddingX={1}>
          <Text>
            Skew:{' '}
            <Text color={analysis.skewDirection === 'put' ? 'red' : analysis.skewDirection === 'call' ? 'green' : 'yellow'}>
              {analysis.skewDirection.toUpperCase()}
            </Text>
          </Text>
          <Text dimColor>ATM IV: {(analysis.atmIV * 100).toFixed(1)}%</Text>
          <Text dimColor>
            Wings: L={(analysis.wings.leftWing * 100).toFixed(1)}% R=
            {(analysis.wings.rightWing * 100).toFixed(1)}%
          </Text>
          <Text dimColor>Butterfly: {(analysis.butterflySpread * 100).toFixed(2)}%</Text>
          {state.surface && (
            <CrossSection
              surface={state.surface}
              axis="y"
              index={Math.floor(state.surface.nx / 2)}
              width={width - 4}
              height={4}
            />
          )}
        </Box>
      ) : (
        <Text dimColor paddingX={1}>
          Loading...
        </Text>
      )}
    </Box>
  )
}

/**
 * Greeks Risk Panel
 */
function GreeksRiskPanel({
  state,
  width,
  height,
}: {
  state: RiskOracleState
  width: number
  height: number
}): React.ReactElement {
  const metrics = state.riskMetrics

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      width={width}
      height={height}
    >
      <Box paddingX={1}>
        <Text bold>Slope Analysis</Text>
      </Box>
      {metrics ? (
        <Box flexDirection="column" paddingX={1}>
          <Text>Max Slope: {metrics.maxSlope.toFixed(4)}</Text>
          <Text>Avg Slope: {metrics.avgSlope.toFixed(4)}</Text>
          <Text dimColor>Variance: {metrics.slopeVariance.toFixed(4)}</Text>
          <Text dimColor>Term Steep: {metrics.termStructureSteepness.toFixed(4)}</Text>
          <Text dimColor>Smile Steep: {metrics.smileSteepness.toFixed(4)}</Text>
          <Text dimColor>Upward Bias: {(metrics.upwardBias * 100).toFixed(0)}%</Text>
        </Box>
      ) : (
        <Text dimColor paddingX={1}>
          Loading...
        </Text>
      )}
    </Box>
  )
}

/**
 * Arbitrage Detection Panel
 */
function ArbitragePanel({
  opportunities,
  width,
  height,
}: {
  opportunities: ArbitrageOpportunity[]
  width: number
  height: number
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      width={width}
      height={height}
    >
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>Arbitrage</Text>
        <Text color={opportunities.length > 0 ? 'yellow' : 'green'}>
          {opportunities.length} found
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={1} overflowY="hidden">
        {opportunities.length === 0 ? (
          <Text dimColor>No arbitrage detected</Text>
        ) : (
          opportunities.slice(0, height - 3).map((arb, i) => (
            <Text key={i} color={arb.type === 'calendar' ? 'yellow' : 'magenta'}>
              {arb.type[0]?.toUpperCase()}: {arb.description.slice(0, width - 8)}
            </Text>
          ))
        )}
      </Box>
    </Box>
  )
}

/**
 * Risk Score Gauge Panel
 */
function RiskScorePanel({
  metrics,
  width,
  height,
}: {
  metrics: RiskMetrics | null
  width: number
  height: number
}): React.ReactElement {
  const score = metrics?.riskScore || 0
  const barWidth = width - 6
  const filled = Math.round(score * barWidth)

  const getColor = (s: number): string => {
    if (s < 0.3) return 'green'
    if (s < 0.6) return 'yellow'
    if (s < 0.8) return 'red'
    return 'magenta'
  }

  const color = getColor(score)
  const label = score < 0.3 ? 'LOW' : score < 0.6 ? 'MED' : score < 0.8 ? 'HIGH' : 'CRIT'

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      width={width}
      height={height}
    >
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>Risk Score</Text>
        <Text bold color={color}>
          {label}
        </Text>
      </Box>
      <Box paddingX={1} flexDirection="column">
        <Text>
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
        </Text>
        <Text dimColor>{(score * 100).toFixed(0)}%</Text>
      </Box>
    </Box>
  )
}

/**
 * Alerts Log Panel
 */
function AlertsPanel({
  alerts,
  width,
  height,
}: {
  alerts: RiskAlert[]
  width: number
  height: number
}): React.ReactElement {
  const visibleAlerts = alerts.slice(-height + 3)

  const getLevelColor = (level: RiskAlert['level']): string => {
    switch (level) {
      case 'critical':
        return 'red'
      case 'warning':
        return 'yellow'
      default:
        return 'blue'
    }
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      width={width}
      height={height}
    >
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>Alerts</Text>
        <Text dimColor>{alerts.length} total</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} overflowY="hidden">
        {visibleAlerts.length === 0 ? (
          <Text dimColor>No alerts</Text>
        ) : (
          visibleAlerts.map((alert, i) => (
            <Text key={i} color={getLevelColor(alert.level)}>
              [{alert.source}] {alert.message.slice(0, width - 15)}
            </Text>
          ))
        )}
      </Box>
    </Box>
  )
}

/**
 * Status Bar
 */
function StatusBar({
  state,
  width,
}: {
  state: RiskOracleState
  width: number
}): React.ReactElement {
  const lastUpdate = state.lastUpdate
    ? new Date(state.lastUpdate).toLocaleTimeString()
    : 'N/A'

  return (
    <Box
      borderStyle="single"
      width={width}
      justifyContent="space-between"
      paddingX={1}
    >
      <Text dimColor>Last Update: {lastUpdate}</Text>
      <Text dimColor>
        Surface: {state.surface ? `${state.surface.nx}x${state.surface.ny}` : 'None'}
      </Text>
      <Text dimColor>Arb: {state.arbitrage.length} | Alerts: {state.alerts.length}</Text>
      <Text dimColor>q=quit ←↑↓→=rotate +/-=zoom r=reset</Text>
    </Box>
  )
}

/**
 * Main Risk Oracle Application
 */
export function RiskOracleApp({
  surface: initialSurface = null,
  onSurfaceUpdate,
  onMessage,
}: RiskOracleAppProps): React.ReactElement {
  const { exit } = useApp()
  const { stdout } = useStdout()

  // Get terminal dimensions
  const termWidth = stdout?.columns || 120
  const termHeight = stdout?.rows || 40

  // Calculate panel sizes
  const sideWidth = Math.floor(termWidth * 0.2)
  const centerWidth = termWidth - sideWidth * 2 - 2
  const topHeight = Math.floor((termHeight - 3) * 0.5)
  const midHeight = Math.floor((termHeight - 3) * 0.3)
  const bottomHeight = termHeight - topHeight - midHeight - 3

  // State
  const [state, setState] = useState<RiskOracleState>(() => {
    const initial = createRiskOracleState()
    if (initialSurface) {
      return updateRiskOracle(initial, initialSurface)
    }
    return initial
  })

  // Handle surface updates
  const handleSurfaceUpdate = useCallback(
    (newSurface: Surface<Vec64>) => {
      setState((prev) => updateRiskOracle(prev, newSurface))
      if (onSurfaceUpdate) {
        onSurfaceUpdate(newSurface)
      }
    },
    [onSurfaceUpdate]
  )

  // Handle risk metrics from surface widget
  const handleRiskMetrics = useCallback((metrics: RiskMetrics) => {
    // Metrics are computed in the oracle, this is just for callbacks
  }, [])

  // Handle quit
  useInput((input) => {
    if (input === 'q') {
      exit()
    }
  })

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* Top Row */}
      <Box flexDirection="row">
        {/* Left: Term Structure */}
        <TermStructurePanel state={state} width={sideWidth} height={topHeight} />

        {/* Center: 3D Surface (spans top and middle rows) */}
        <SurfaceWidget
          surface={state.surface}
          width={centerWidth}
          height={topHeight + midHeight}
          onRiskMetrics={handleRiskMetrics}
          labels={{ x: 'DTE', y: 'Strike', z: 'IV' }}
          showStatus={false}
        />

        {/* Right: Smile Skew */}
        <SmileSkewPanel state={state} width={sideWidth} height={topHeight} />
      </Box>

      {/* Middle Row */}
      <Box flexDirection="row">
        {/* Left: Greeks Risk */}
        <GreeksRiskPanel state={state} width={sideWidth} height={midHeight} />

        {/* Center is occupied by surface above */}
        <Box width={centerWidth} />

        {/* Right: Arbitrage */}
        <ArbitragePanel
          opportunities={state.arbitrage}
          width={sideWidth}
          height={midHeight}
        />
      </Box>

      {/* Bottom Row */}
      <Box flexDirection="row">
        {/* Left: Risk Score */}
        <RiskScorePanel metrics={state.riskMetrics} width={sideWidth} height={bottomHeight} />

        {/* Center: Status */}
        <StatusBar state={state} width={centerWidth} />

        {/* Right: Alerts */}
        <AlertsPanel alerts={state.alerts} width={sideWidth} height={bottomHeight} />
      </Box>
    </Box>
  )
}

export default RiskOracleApp
