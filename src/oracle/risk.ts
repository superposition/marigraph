/**
 * Risk Oracle
 * Infers risk profiles from volatility surface data
 *
 * 7-Column Layout:
 * ┌────────┬────────────────────┬────────┐
 * │ Term   │                    │ Smile  │
 * │ Struct │    3D SURFACE      │ Skew   │
 * ├────────┤      (center)      ├────────┤
 * │ Greeks │                    │ Arb    │
 * │ Risk   │                    │ Detect │
 * ├────────┼────────────────────┼────────┤
 * │ Risk   │       Status       │ Alerts │
 * │ Score  │       / Log        │        │
 * └────────┴────────────────────┴────────┘
 */

import type { Surface } from '../data/surface.ts'
import type { Vec64 } from '../data/vec.ts'
import { computeSlope, type SlopeData } from '../data/surface.ts'
import { computeRiskMetrics, type RiskMetrics } from '../render/gradient.ts'

/**
 * Column configuration for 7-column risk oracle layout
 */
export interface RiskOracleConfig {
  columns: {
    termStructure: ColumnConfig
    surfaceCube: ColumnConfig
    smileSkew: ColumnConfig
    greeksRisk: ColumnConfig
    arbDetect: ColumnConfig
    riskScore: ColumnConfig
    alerts: ColumnConfig
  }
  wiring: EventWiring[]
}

export interface ColumnConfig {
  id: string
  type: string
  position: 'left' | 'center' | 'right'
  row: 'top' | 'middle' | 'bottom'
  width?: number | string
  height?: number | string
}

export interface EventWiring {
  from: string
  event: string
  to: string
  action: string
}

/**
 * Default 7-column risk oracle configuration
 */
export function createRiskOracleConfig(): RiskOracleConfig {
  return {
    columns: {
      termStructure: {
        id: 'term-structure',
        type: 'chart',
        position: 'left',
        row: 'top',
      },
      surfaceCube: {
        id: 'surface-cube',
        type: 'surface',
        position: 'center',
        row: 'top',
        width: '50%',
        height: '70%',
      },
      smileSkew: {
        id: 'smile-skew',
        type: 'chart',
        position: 'right',
        row: 'top',
      },
      greeksRisk: {
        id: 'greeks-risk',
        type: 'table',
        position: 'left',
        row: 'middle',
      },
      arbDetect: {
        id: 'arb-detect',
        type: 'list',
        position: 'right',
        row: 'middle',
      },
      riskScore: {
        id: 'risk-score',
        type: 'gauge',
        position: 'left',
        row: 'bottom',
      },
      alerts: {
        id: 'alerts',
        type: 'log',
        position: 'right',
        row: 'bottom',
      },
    },
    wiring: [
      // Surface updates propagate to all analysis panels
      { from: 'surface-cube', event: 'SURFACE_UPDATE', to: 'term-structure', action: 'UPDATE_SLICE_X' },
      { from: 'surface-cube', event: 'SURFACE_UPDATE', to: 'smile-skew', action: 'UPDATE_SLICE_Y' },
      { from: 'surface-cube', event: 'SURFACE_UPDATE', to: 'greeks-risk', action: 'RECOMPUTE_GREEKS' },
      { from: 'surface-cube', event: 'SURFACE_UPDATE', to: 'arb-detect', action: 'CHECK_ARBITRAGE' },
      { from: 'surface-cube', event: 'RISK_METRICS', to: 'risk-score', action: 'UPDATE_SCORE' },
      // Risk alerts
      { from: 'arb-detect', event: 'ARBITRAGE_FOUND', to: 'alerts', action: 'APPEND' },
      { from: 'risk-score', event: 'RISK_THRESHOLD', to: 'alerts', action: 'APPEND' },
    ],
  }
}

/**
 * Term structure analysis (IV vs DTE at fixed strike)
 */
export interface TermStructureAnalysis {
  strikes: number[]
  curves: Map<number, { dte: number[]; iv: number[] }>
  contango: boolean // Near < Far
  backwardation: boolean // Near > Far
  flatness: number // 0 = steep, 1 = flat
  inflectionPoints: Array<{ dte: number; iv: number }>
}

export function analyzeTermStructure(
  surface: Surface<Vec64>,
  strikeIndices: number[]
): TermStructureAnalysis {
  const curves = new Map<number, { dte: number[]; iv: number[] }>()

  for (const yi of strikeIndices) {
    const strike = surface.y[yi]!
    const dte: number[] = []
    const iv: number[] = []

    for (let xi = 0; xi < surface.nx; xi++) {
      dte.push(surface.x[xi]!)
      iv.push(surface.z[xi * surface.ny + yi]!)
    }

    curves.set(strike, { dte, iv })
  }

  // Analyze first curve for contango/backwardation
  const firstCurve = curves.values().next().value
  let contango = false
  let backwardation = false
  let flatness = 0

  if (firstCurve && firstCurve.iv.length > 1) {
    const nearIV = firstCurve.iv[0]!
    const farIV = firstCurve.iv[firstCurve.iv.length - 1]!
    contango = nearIV < farIV
    backwardation = nearIV > farIV
    flatness = 1 - Math.abs(nearIV - farIV) / Math.max(nearIV, farIV)
  }

  // Find inflection points (where second derivative changes sign)
  const inflectionPoints: Array<{ dte: number; iv: number }> = []
  if (firstCurve && firstCurve.iv.length > 2) {
    for (let i = 1; i < firstCurve.iv.length - 1; i++) {
      const d2 =
        firstCurve.iv[i + 1]! - 2 * firstCurve.iv[i]! + firstCurve.iv[i - 1]!
      const d2Next =
        i + 2 < firstCurve.iv.length
          ? firstCurve.iv[i + 2]! - 2 * firstCurve.iv[i + 1]! + firstCurve.iv[i]!
          : d2

      if (d2 * d2Next < 0) {
        inflectionPoints.push({
          dte: firstCurve.dte[i]!,
          iv: firstCurve.iv[i]!,
        })
      }
    }
  }

  return {
    strikes: strikeIndices.map((i) => surface.y[i]!),
    curves,
    contango,
    backwardation,
    flatness,
    inflectionPoints,
  }
}

/**
 * Smile/Skew analysis (IV vs Strike at fixed DTE)
 */
export interface SmileAnalysis {
  dtes: number[]
  smiles: Map<number, { strike: number[]; iv: number[] }>
  skewDirection: 'put' | 'call' | 'neutral' // Which side is higher
  skewMagnitude: number // Difference between wings
  atmIV: number // At-the-money IV
  wings: {
    leftWing: number // OTM put IV
    rightWing: number // OTM call IV
  }
  butterflySpread: number // Wings avg - ATM
}

export function analyzeSmile(
  surface: Surface<Vec64>,
  dteIndices: number[],
  atmStrikeIndex: number
): SmileAnalysis {
  const smiles = new Map<number, { strike: number[]; iv: number[] }>()

  for (const xi of dteIndices) {
    const dte = surface.x[xi]!
    const strike: number[] = []
    const iv: number[] = []

    for (let yi = 0; yi < surface.ny; yi++) {
      strike.push(surface.y[yi]!)
      iv.push(surface.z[xi * surface.ny + yi]!)
    }

    smiles.set(dte, { strike, iv })
  }

  // Analyze first smile
  const firstSmile = smiles.values().next().value
  let skewDirection: 'put' | 'call' | 'neutral' = 'neutral'
  let skewMagnitude = 0
  let atmIV = 0
  let leftWing = 0
  let rightWing = 0
  let butterflySpread = 0

  if (firstSmile && firstSmile.iv.length > 2) {
    const n = firstSmile.iv.length
    const atmIdx = Math.min(atmStrikeIndex, n - 1)

    leftWing = firstSmile.iv[0]!
    rightWing = firstSmile.iv[n - 1]!
    atmIV = firstSmile.iv[atmIdx]!

    skewMagnitude = Math.abs(leftWing - rightWing)
    if (leftWing > rightWing + 0.01) {
      skewDirection = 'put'
    } else if (rightWing > leftWing + 0.01) {
      skewDirection = 'call'
    }

    butterflySpread = (leftWing + rightWing) / 2 - atmIV
  }

  return {
    dtes: dteIndices.map((i) => surface.x[i]!),
    smiles,
    skewDirection,
    skewMagnitude,
    atmIV,
    wings: { leftWing, rightWing },
    butterflySpread,
  }
}

/**
 * Greeks risk analysis
 */
export interface GreeksRisk {
  // Portfolio-level Greeks (aggregated)
  totalDelta: number
  totalGamma: number
  totalVega: number
  totalTheta: number

  // Risk exposures
  deltaExposure: 'long' | 'short' | 'neutral'
  gammaExposure: 'long' | 'short'
  vegaExposure: 'long' | 'short'
  thetaBleed: number // Daily theta decay

  // Stress scenarios
  spotUp10Pct: number
  spotDown10Pct: number
  volUp5Pts: number
  volDown5Pts: number
}

/**
 * Arbitrage detection
 */
export interface ArbitrageOpportunity {
  type: 'calendar' | 'butterfly' | 'vertical' | 'box'
  description: string
  location: { dte?: number; strike?: number }
  profit: number
  confidence: number
}

export function detectArbitrage(surface: Surface<Vec64>): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = []

  // Calendar spread arbitrage (near IV > far IV at same strike)
  for (let yi = 0; yi < surface.ny; yi++) {
    for (let xi = 0; xi < surface.nx - 1; xi++) {
      const nearIV = surface.z[xi * surface.ny + yi]!
      const farIV = surface.z[(xi + 1) * surface.ny + yi]!

      // Significant calendar arbitrage
      if (nearIV > farIV * 1.1) {
        opportunities.push({
          type: 'calendar',
          description: `Calendar spread at K=${surface.y[yi]?.toFixed(0)}`,
          location: { strike: surface.y[yi], dte: surface.x[xi] },
          profit: (nearIV - farIV) * 100,
          confidence: 0.8,
        })
      }
    }
  }

  // Butterfly arbitrage (smile convexity violation)
  for (let xi = 0; xi < surface.nx; xi++) {
    for (let yi = 1; yi < surface.ny - 1; yi++) {
      const leftIV = surface.z[xi * surface.ny + (yi - 1)]!
      const midIV = surface.z[xi * surface.ny + yi]!
      const rightIV = surface.z[xi * surface.ny + (yi + 1)]!

      // Butterfly should have positive value (wings > body)
      const butterflyValue = (leftIV + rightIV) / 2 - midIV
      if (butterflyValue < -0.01) {
        opportunities.push({
          type: 'butterfly',
          description: `Butterfly at DTE=${surface.x[xi]?.toFixed(0)}`,
          location: { dte: surface.x[xi], strike: surface.y[yi] },
          profit: Math.abs(butterflyValue) * 100,
          confidence: 0.7,
        })
      }
    }
  }

  return opportunities.sort((a, b) => b.profit - a.profit)
}

/**
 * Risk alert
 */
export interface RiskAlert {
  timestamp: number
  level: 'info' | 'warning' | 'critical'
  source: string
  message: string
  data?: unknown
}

/**
 * Risk oracle state - aggregates all analyses
 */
export interface RiskOracleState {
  surface: Surface<Vec64> | null
  slope: SlopeData | null
  riskMetrics: RiskMetrics | null
  termStructure: TermStructureAnalysis | null
  smile: SmileAnalysis | null
  arbitrage: ArbitrageOpportunity[]
  alerts: RiskAlert[]
  lastUpdate: number
}

/**
 * Create initial risk oracle state
 */
export function createRiskOracleState(): RiskOracleState {
  return {
    surface: null,
    slope: null,
    riskMetrics: null,
    termStructure: null,
    smile: null,
    arbitrage: [],
    alerts: [],
    lastUpdate: 0,
  }
}

/**
 * Update risk oracle with new surface data
 */
export function updateRiskOracle(
  state: RiskOracleState,
  surface: Surface<Vec64>
): RiskOracleState {
  const slope = computeSlope(surface)
  const riskMetrics = computeRiskMetrics(slope, surface.nx, surface.ny)

  // Analyze term structure (sample 5 strikes)
  const strikeIndices = [
    0,
    Math.floor(surface.ny * 0.25),
    Math.floor(surface.ny * 0.5),
    Math.floor(surface.ny * 0.75),
    surface.ny - 1,
  ]
  const termStructure = analyzeTermStructure(surface, strikeIndices)

  // Analyze smile (sample 5 DTEs)
  const dteIndices = [
    0,
    Math.floor(surface.nx * 0.25),
    Math.floor(surface.nx * 0.5),
    Math.floor(surface.nx * 0.75),
    surface.nx - 1,
  ]
  const atmIndex = Math.floor(surface.ny / 2)
  const smile = analyzeSmile(surface, dteIndices, atmIndex)

  // Detect arbitrage
  const arbitrage = detectArbitrage(surface)

  // Generate alerts
  const alerts = [...state.alerts]
  const now = Date.now()

  if (riskMetrics.riskScore > 0.8) {
    alerts.push({
      timestamp: now,
      level: 'critical',
      source: 'risk-score',
      message: `Critical risk level: ${(riskMetrics.riskScore * 100).toFixed(0)}%`,
    })
  } else if (riskMetrics.riskScore > 0.6) {
    alerts.push({
      timestamp: now,
      level: 'warning',
      source: 'risk-score',
      message: `Elevated risk: ${(riskMetrics.riskScore * 100).toFixed(0)}%`,
    })
  }

  for (const arb of arbitrage.slice(0, 3)) {
    alerts.push({
      timestamp: now,
      level: 'warning',
      source: 'arb-detect',
      message: `${arb.type}: ${arb.description}`,
      data: arb,
    })
  }

  // Keep only last 100 alerts
  while (alerts.length > 100) {
    alerts.shift()
  }

  return {
    surface,
    slope,
    riskMetrics,
    termStructure,
    smile,
    arbitrage,
    alerts,
    lastUpdate: now,
  }
}
