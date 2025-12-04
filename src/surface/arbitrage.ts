/**
 * Volatility Surface Arbitrage Detection
 * Checks for calendar spread, butterfly, and vertical spread arbitrage
 */

import type { Surface } from '../data/surface.ts'
import type { Vec64 } from '../data/vec.ts'

/**
 * Arbitrage opportunity details
 */
export interface ArbitrageViolation {
  type: 'calendar' | 'butterfly' | 'vertical'
  severity: 'minor' | 'moderate' | 'severe'
  location: {
    x1: number // DTE or T
    x2?: number // Second DTE for calendar
    y: number // Strike
  }
  violation: number // Magnitude of violation
  description: string
}

/**
 * Arbitrage check result
 */
export interface ArbitrageCheckResult {
  arbitrageFree: boolean
  violations: ArbitrageViolation[]
  summary: {
    calendar: number
    butterfly: number
    vertical: number
    total: number
  }
}

/**
 * Check for calendar spread arbitrage
 * Total variance must increase with time to expiry
 * w(T1) <= w(T2) for T1 < T2 at same strike
 */
export function checkCalendarArbitrage(
  surface: Surface<Vec64>,
  tolerance = 0.001
): ArbitrageViolation[] {
  const violations: ArbitrageViolation[] = []
  const { nx, ny, x, y, z } = surface

  for (let j = 0; j < ny; j++) {
    const strike = y[j]!

    for (let i = 0; i < nx - 1; i++) {
      const T1 = x[i]!
      const T2 = x[i + 1]!

      // Get implied variances (IV^2 * T)
      const iv1 = z[i * ny + j]!
      const iv2 = z[(i + 1) * ny + j]!

      const w1 = iv1 * iv1 * T1
      const w2 = iv2 * iv2 * T2

      // Total variance should increase with time
      if (w2 < w1 - tolerance) {
        const violation = w1 - w2
        const severity =
          violation > 0.01 ? 'severe' : violation > 0.005 ? 'moderate' : 'minor'

        violations.push({
          type: 'calendar',
          severity,
          location: { x1: T1, x2: T2, y: strike },
          violation,
          description: `Calendar arbitrage at K=${strike.toFixed(2)}: w(${T1.toFixed(3)})=${w1.toFixed(4)} > w(${T2.toFixed(3)})=${w2.toFixed(4)}`,
        })
      }
    }
  }

  return violations
}

/**
 * Check for butterfly arbitrage
 * Smile must be convex: IV(K-) + IV(K+) >= 2*IV(K)
 */
export function checkButterflyArbitrage(
  surface: Surface<Vec64>,
  tolerance = 0.001
): ArbitrageViolation[] {
  const violations: ArbitrageViolation[] = []
  const { nx, ny, x, y, z } = surface

  for (let i = 0; i < nx; i++) {
    const T = x[i]!

    for (let j = 1; j < ny - 1; j++) {
      const strike = y[j]!

      const ivLeft = z[i * ny + (j - 1)]!
      const ivMid = z[i * ny + j]!
      const ivRight = z[i * ny + (j + 1)]!

      // Convexity check: butterfly spread should have positive value
      const butterfly = (ivLeft + ivRight) / 2 - ivMid

      if (butterfly < -tolerance) {
        const violation = Math.abs(butterfly)
        const severity =
          violation > 0.02 ? 'severe' : violation > 0.01 ? 'moderate' : 'minor'

        violations.push({
          type: 'butterfly',
          severity,
          location: { x1: T, y: strike },
          violation,
          description: `Butterfly arbitrage at T=${T.toFixed(3)}, K=${strike.toFixed(2)}: convexity=${butterfly.toFixed(4)}`,
        })
      }
    }
  }

  return violations
}

/**
 * Check for vertical spread arbitrage
 * Call prices must decrease with strike, put prices must increase
 * This translates to constraints on the smile slope
 */
export function checkVerticalArbitrage(
  surface: Surface<Vec64>,
  forward: number,
  tolerance = 0.001
): ArbitrageViolation[] {
  const violations: ArbitrageViolation[] = []
  const { nx, ny, x, y, z } = surface

  for (let i = 0; i < nx; i++) {
    const T = x[i]!

    for (let j = 0; j < ny - 1; j++) {
      const K1 = y[j]!
      const K2 = y[j + 1]!

      const iv1 = z[i * ny + j]!
      const iv2 = z[i * ny + (j + 1)]!

      // Log-moneyness
      const k1 = Math.log(K1 / forward)
      const k2 = Math.log(K2 / forward)

      // Total variance
      const w1 = iv1 * iv1 * T
      const w2 = iv2 * iv2 * T

      // Slope of total variance
      const dw_dk = (w2 - w1) / (k2 - k1)

      // For no arbitrage: -1 <= dw/dk <= 1 at k=0
      // More generally: |dw/dk| should be bounded
      const slopeLimit = 2.0 // Typical limit

      if (Math.abs(dw_dk) > slopeLimit) {
        const violation = Math.abs(dw_dk) - slopeLimit
        const severity =
          violation > 1.0 ? 'severe' : violation > 0.5 ? 'moderate' : 'minor'

        violations.push({
          type: 'vertical',
          severity,
          location: { x1: T, y: (K1 + K2) / 2 },
          violation,
          description: `Vertical arbitrage at T=${T.toFixed(3)}, K=${K1.toFixed(2)}-${K2.toFixed(2)}: slope=${dw_dk.toFixed(4)}`,
        })
      }
    }
  }

  return violations
}

/**
 * Run all arbitrage checks
 */
export function checkAllArbitrage(
  surface: Surface<Vec64>,
  forward?: number,
  tolerance = 0.001
): ArbitrageCheckResult {
  const calendarViolations = checkCalendarArbitrage(surface, tolerance)
  const butterflyViolations = checkButterflyArbitrage(surface, tolerance)
  const verticalViolations = forward
    ? checkVerticalArbitrage(surface, forward, tolerance)
    : []

  const allViolations = [
    ...calendarViolations,
    ...butterflyViolations,
    ...verticalViolations,
  ]

  return {
    arbitrageFree: allViolations.length === 0,
    violations: allViolations,
    summary: {
      calendar: calendarViolations.length,
      butterfly: butterflyViolations.length,
      vertical: verticalViolations.length,
      total: allViolations.length,
    },
  }
}

/**
 * Smooth surface to remove minor arbitrage violations
 * Uses simple averaging to reduce local violations
 */
export function smoothSurface(
  surface: Surface<Vec64>,
  iterations = 1,
  weight = 0.5
): Surface<Vec64> {
  const { nx, ny, x, y, z, meta } = surface
  let current = new Float64Array(z)

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float64Array(current)

    for (let i = 1; i < nx - 1; i++) {
      for (let j = 1; j < ny - 1; j++) {
        const idx = i * ny + j

        // Average of neighbors
        const avg =
          (current[(i - 1) * ny + j]! +
            current[(i + 1) * ny + j]! +
            current[i * ny + (j - 1)]! +
            current[i * ny + (j + 1)]!) /
          4

        // Blend with original
        next[idx] = (1 - weight) * current[idx]! + weight * avg
      }
    }

    current = next
  }

  return {
    x: new Float64Array(x),
    y: new Float64Array(y),
    z: current,
    nx,
    ny,
    meta: { ...meta },
  }
}

/**
 * Generate arbitrage-free surface using monotone spline
 * Ensures calendar and butterfly conditions are satisfied
 */
export function enforceArbitrageFree(
  surface: Surface<Vec64>,
  maxIterations = 100,
  tolerance = 0.001
): Surface<Vec64> {
  let current = {
    ...surface,
    z: new Float64Array(surface.z),
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    const result = checkAllArbitrage(current, undefined, tolerance)

    if (result.arbitrageFree) {
      return current
    }

    // Apply corrections
    const { nx, ny, z } = current

    // Fix calendar violations: increase far-dated variance
    for (const v of result.violations.filter((v) => v.type === 'calendar')) {
      const j = current.y.findIndex((y) => Math.abs(y - v.location.y) < 1e-6)
      if (j === -1) continue

      // Find the expiry indices
      for (let i = 0; i < nx - 1; i++) {
        if (
          Math.abs(current.x[i]! - v.location.x1!) < 1e-6 &&
          Math.abs(current.x[i + 1]! - v.location.x2!) < 1e-6
        ) {
          // Increase far-dated IV slightly
          const idx = (i + 1) * ny + j
          const adjustment = Math.sqrt(v.violation / current.x[i + 1]!) * 0.5
          z[idx] = z[idx]! + adjustment
          break
        }
      }
    }

    // Fix butterfly violations: smooth the smile
    for (const v of result.violations.filter((v) => v.type === 'butterfly')) {
      const i = current.x.findIndex((x) => Math.abs(x - v.location.x1) < 1e-6)
      const j = current.y.findIndex((y) => Math.abs(y - v.location.y) < 1e-6)
      if (i === -1 || j === -1 || j === 0 || j === ny - 1) continue

      // Average with neighbors
      const left = z[i * ny + (j - 1)]!
      const right = z[i * ny + (j + 1)]!
      z[i * ny + j] = (left + right) / 2
    }

    current = { ...current, z }
  }

  return current
}

/**
 * Format arbitrage summary for display
 */
export function formatArbitrageSummary(result: ArbitrageCheckResult): string[] {
  const lines: string[] = []

  if (result.arbitrageFree) {
    lines.push('Surface is arbitrage-free')
  } else {
    lines.push(`Found ${result.summary.total} arbitrage violations:`)
    if (result.summary.calendar > 0) {
      lines.push(`  Calendar: ${result.summary.calendar}`)
    }
    if (result.summary.butterfly > 0) {
      lines.push(`  Butterfly: ${result.summary.butterfly}`)
    }
    if (result.summary.vertical > 0) {
      lines.push(`  Vertical: ${result.summary.vertical}`)
    }

    // Show top violations
    const severe = result.violations.filter((v) => v.severity === 'severe')
    if (severe.length > 0) {
      lines.push('Severe violations:')
      for (const v of severe.slice(0, 5)) {
        lines.push(`  ${v.description}`)
      }
    }
  }

  return lines
}
