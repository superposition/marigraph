/**
 * Gradient and Slope Visualization
 * Maps surface slopes to colors and intensities for risk visualization
 */

import type { Surface } from '../data/surface.ts'
import { computeSlope, type SlopeData } from '../data/surface.ts'
import type { Vec64 } from '../data/vec.ts'

// Color palette for slope visualization
export type ColorName =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'

export interface ColorRGB {
  r: number
  g: number
  b: number
}

export const COLORS: Record<ColorName, ColorRGB> = {
  black: { r: 0, g: 0, b: 0 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 255, b: 0 },
  yellow: { r: 255, g: 255, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  cyan: { r: 0, g: 255, b: 255 },
  white: { r: 255, g: 255, b: 255 },
  gray: { r: 128, g: 128, b: 128 },
}

// Gradient presets for different risk visualizations
export type GradientPreset =
  | 'heat' // Blue → Cyan → Green → Yellow → Red (low → high)
  | 'cool' // Reverse heat
  | 'divergent' // Blue ← White → Red (negative ← neutral → positive)
  | 'risk' // Green → Yellow → Red (safe → warning → danger)
  | 'greyscale' // Black → White

export const GRADIENT_PRESETS: Record<GradientPreset, ColorName[]> = {
  heat: ['blue', 'cyan', 'green', 'yellow', 'red'],
  cool: ['red', 'yellow', 'green', 'cyan', 'blue'],
  divergent: ['blue', 'cyan', 'white', 'yellow', 'red'],
  risk: ['green', 'yellow', 'red'],
  greyscale: ['black', 'gray', 'white'],
}

/**
 * Interpolate between two colors
 */
export function lerpColor(c1: ColorRGB, c2: ColorRGB, t: number): ColorRGB {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  }
}

/**
 * Sample a gradient at position t (0-1)
 */
export function sampleGradient(colors: ColorName[], t: number): ColorRGB {
  const clamped = Math.max(0, Math.min(1, t))
  const n = colors.length - 1
  const idx = clamped * n
  const i = Math.floor(idx)
  const frac = idx - i

  if (i >= n) return COLORS[colors[n]!]!
  return lerpColor(COLORS[colors[i]!]!, COLORS[colors[i + 1]!]!, frac)
}

/**
 * Convert RGB to ANSI 256-color code
 */
export function rgbToAnsi256(color: ColorRGB): number {
  // Convert to 6x6x6 color cube (16-231) or greyscale (232-255)
  const r = Math.round((color.r / 255) * 5)
  const g = Math.round((color.g / 255) * 5)
  const b = Math.round((color.b / 255) * 5)
  return 16 + 36 * r + 6 * g + b
}

/**
 * Generate ANSI escape code for foreground color
 */
export function ansi256Fg(code: number): string {
  return `\x1b[38;5;${code}m`
}

/**
 * Generate ANSI escape code for background color
 */
export function ansi256Bg(code: number): string {
  return `\x1b[48;5;${code}m`
}

/**
 * Map slope magnitude to color
 */
export function slopeToColor(
  magnitude: number,
  maxMagnitude: number,
  preset: GradientPreset = 'heat'
): ColorRGB {
  const t = maxMagnitude > 0 ? magnitude / maxMagnitude : 0
  return sampleGradient(GRADIENT_PRESETS[preset]!, t)
}

/**
 * Map slope direction to color (for vector field visualization)
 */
export function directionToColor(angle: number): ColorRGB {
  // Map angle (-PI to PI) to hue (0-360)
  const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360

  // HSV to RGB with S=1, V=1
  const h = hue / 60
  const i = Math.floor(h) % 6
  const f = h - Math.floor(h)
  const q = 1 - f

  const rgb: [number, number, number][] = [
    [1, f, 0],
    [q, 1, 0],
    [0, 1, f],
    [0, q, 1],
    [f, 0, 1],
    [1, 0, q],
  ]

  const [r, g, b] = rgb[i]!
  return {
    r: Math.round(r! * 255),
    g: Math.round(g! * 255),
    b: Math.round(b! * 255),
  }
}

/**
 * Risk metrics derived from slope analysis
 */
export interface RiskMetrics {
  // Slope statistics
  maxSlope: number
  avgSlope: number
  slopeVariance: number

  // Directional risk
  upwardBias: number // Percentage of points with positive dz/dy
  termStructureSteepness: number // Average dz/dx (term structure slope)
  smileSteepness: number // Average |dz/dy| (smile steepness)

  // Risk zones
  highRiskZones: Array<{ xi: number; yi: number; magnitude: number }>
  flatZones: Array<{ xi: number; yi: number }>

  // Overall risk score (0-1)
  riskScore: number
}

/**
 * Compute risk metrics from surface slope data
 */
export function computeRiskMetrics(
  slope: SlopeData,
  nx: number,
  ny: number
): RiskMetrics {
  const n = slope.magnitude.length
  let maxSlope = 0
  let sumSlope = 0
  let sumSlopeSq = 0
  let upwardCount = 0
  let sumTermSlope = 0
  let sumSmile = 0

  const highRiskZones: RiskMetrics['highRiskZones'] = []
  const flatZones: RiskMetrics['flatZones'] = []

  for (let i = 0; i < n; i++) {
    const mag = slope.magnitude[i]!
    const dzDx = slope.dz_dx[i]!
    const dzDy = slope.dz_dy[i]!

    maxSlope = Math.max(maxSlope, mag)
    sumSlope += mag
    sumSlopeSq += mag * mag

    if (dzDy > 0) upwardCount++
    sumTermSlope += dzDx
    sumSmile += Math.abs(dzDy)
  }

  const avgSlope = sumSlope / n
  const slopeVariance = sumSlopeSq / n - avgSlope * avgSlope

  // Identify high risk zones (top 10% by magnitude)
  const threshold = maxSlope * 0.7
  const flatThreshold = maxSlope * 0.1

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const idx = i * ny + j
      const mag = slope.magnitude[idx]!

      if (mag >= threshold) {
        highRiskZones.push({ xi: i, yi: j, magnitude: mag })
      } else if (mag <= flatThreshold) {
        flatZones.push({ xi: i, yi: j })
      }
    }
  }

  // Sort high risk zones by magnitude
  highRiskZones.sort((a, b) => b.magnitude - a.magnitude)

  // Compute overall risk score
  // Factors: max slope, variance, term structure steepness
  const normalizedMax = Math.min(1, maxSlope / 2) // Assume max reasonable slope is 2
  const normalizedVar = Math.min(1, Math.sqrt(slopeVariance) / 0.5)
  const normalizedTerm = Math.min(1, Math.abs(sumTermSlope / n) / 0.5)

  const riskScore = normalizedMax * 0.4 + normalizedVar * 0.3 + normalizedTerm * 0.3

  return {
    maxSlope,
    avgSlope,
    slopeVariance,
    upwardBias: upwardCount / n,
    termStructureSteepness: sumTermSlope / n,
    smileSteepness: sumSmile / n,
    highRiskZones: highRiskZones.slice(0, 10), // Top 10
    flatZones: flatZones.slice(0, 10),
    riskScore,
  }
}

/**
 * Generate colored intensity grid from slope data
 */
export function slopeToColorGrid(
  slope: SlopeData,
  nx: number,
  ny: number,
  preset: GradientPreset = 'heat'
): ColorRGB[][] {
  const grid: ColorRGB[][] = []
  let maxMag = 0

  // Find max magnitude
  for (let i = 0; i < slope.magnitude.length; i++) {
    maxMag = Math.max(maxMag, slope.magnitude[i]!)
  }

  // Generate color grid
  for (let i = 0; i < nx; i++) {
    const row: ColorRGB[] = []
    for (let j = 0; j < ny; j++) {
      const idx = i * ny + j
      const mag = slope.magnitude[idx]!
      row.push(slopeToColor(mag, maxMag, preset))
    }
    grid.push(row)
  }

  return grid
}

/**
 * Format risk score as colored text
 */
export function formatRiskScore(score: number): { text: string; color: ColorName } {
  if (score < 0.3) return { text: 'LOW', color: 'green' }
  if (score < 0.6) return { text: 'MEDIUM', color: 'yellow' }
  if (score < 0.8) return { text: 'HIGH', color: 'red' }
  return { text: 'CRITICAL', color: 'magenta' }
}

/**
 * Generate risk summary text
 */
export function generateRiskSummary(metrics: RiskMetrics): string[] {
  const lines: string[] = []
  const { text: riskText } = formatRiskScore(metrics.riskScore)

  lines.push(`Risk Level: ${riskText} (${(metrics.riskScore * 100).toFixed(1)}%)`)
  lines.push(`Max Slope: ${metrics.maxSlope.toFixed(4)}`)
  lines.push(`Avg Slope: ${metrics.avgSlope.toFixed(4)}`)
  lines.push(`Term Structure: ${metrics.termStructureSteepness > 0 ? '+' : ''}${metrics.termStructureSteepness.toFixed(4)}`)
  lines.push(`Smile Steepness: ${metrics.smileSteepness.toFixed(4)}`)
  lines.push(`Upward Bias: ${(metrics.upwardBias * 100).toFixed(1)}%`)
  lines.push(`High Risk Zones: ${metrics.highRiskZones.length}`)
  lines.push(`Flat Zones: ${metrics.flatZones.length}`)

  return lines
}
