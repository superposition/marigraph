/**
 * Statistical Dispersion Metrics
 * Comprehensive measures of spread and variability
 */

import {
  createWelford,
  welfordUpdateBatch,
  welfordStats,
  type WelfordState,
} from './welford.ts'
import { quantile, iqr, mad } from './quantile.ts'

/**
 * Full dispersion statistics
 */
export interface Dispersion {
  // Count
  n: number

  // Central tendency
  mean: number
  median: number

  // Spread measures
  variance: number
  stdDev: number
  coefficientOfVariation: number // stdDev / mean (relative spread)

  // Range measures
  min: number
  max: number
  range: number

  // Quartiles
  q1: number
  q3: number
  iqr: number // Interquartile range

  // Robust measures
  mad: number // Median absolute deviation
  madStdDev: number // MAD-based estimate of std dev (MAD * 1.4826)

  // Shape measures
  skewness: number
  kurtosis: number // Excess kurtosis (0 for normal)

  // Percentiles
  p5: number
  p10: number
  p90: number
  p95: number
}

/**
 * Compute full dispersion statistics for an array
 */
export function computeDispersion(values: ArrayLike<number>): Dispersion {
  const n = values.length
  if (n === 0) {
    return {
      n: 0,
      mean: NaN,
      median: NaN,
      variance: NaN,
      stdDev: NaN,
      coefficientOfVariation: NaN,
      min: NaN,
      max: NaN,
      range: NaN,
      q1: NaN,
      q3: NaN,
      iqr: NaN,
      mad: NaN,
      madStdDev: NaN,
      skewness: NaN,
      kurtosis: NaN,
      p5: NaN,
      p10: NaN,
      p90: NaN,
      p95: NaN,
    }
  }

  // Sort for quantiles
  const sorted = Array.from(values).sort((a, b) => a - b)

  // Welford stats
  const welford = createWelford()
  welfordUpdateBatch(welford, values)
  const wStats = welfordStats(welford)

  // Quantiles
  const q1Val = quantile(sorted, 0.25)
  const medianVal = quantile(sorted, 0.5)
  const q3Val = quantile(sorted, 0.75)
  const iqrVal = q3Val - q1Val
  const madVal = mad(sorted, medianVal)

  return {
    n,
    mean: wStats.mean,
    median: medianVal,
    variance: wStats.variance,
    stdDev: wStats.stdDev,
    coefficientOfVariation: wStats.mean !== 0 ? wStats.stdDev / Math.abs(wStats.mean) : NaN,
    min: wStats.min,
    max: wStats.max,
    range: wStats.range,
    q1: q1Val,
    q3: q3Val,
    iqr: iqrVal,
    mad: madVal,
    madStdDev: madVal * 1.4826, // Consistency constant for normal distribution
    skewness: wStats.skewness,
    kurtosis: wStats.kurtosis,
    p5: quantile(sorted, 0.05),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
  }
}

/**
 * Compute dispersion for each column of a 2D array
 */
export function computeColumnDispersion(
  data: number[][],
  columnCount: number
): Dispersion[] {
  const result: Dispersion[] = []

  for (let col = 0; col < columnCount; col++) {
    const column: number[] = []
    for (const row of data) {
      if (row[col] !== undefined) {
        column.push(row[col]!)
      }
    }
    result.push(computeDispersion(column))
  }

  return result
}

/**
 * Z-score normalization
 */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0
  return (value - mean) / stdDev
}

/**
 * Robust z-score using median and MAD
 */
export function robustZScore(value: number, median: number, mad: number): number {
  if (mad === 0) return 0
  return (value - median) / (mad * 1.4826)
}

/**
 * Detect outliers using IQR method
 * Returns indices of outliers
 */
export function detectOutliersIQR(
  values: ArrayLike<number>,
  k = 1.5
): { lower: number[]; upper: number[] } {
  const sorted = Array.from(values).sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const iqrVal = q3 - q1

  const lowerBound = q1 - k * iqrVal
  const upperBound = q3 + k * iqrVal

  const lower: number[] = []
  const upper: number[] = []

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if (v < lowerBound) lower.push(i)
    else if (v > upperBound) upper.push(i)
  }

  return { lower, upper }
}

/**
 * Detect outliers using z-score method
 * Returns indices of outliers
 */
export function detectOutliersZScore(
  values: ArrayLike<number>,
  threshold = 3
): number[] {
  const welford = createWelford()
  welfordUpdateBatch(welford, values)
  const { mean, stdDev } = welfordStats(welford)

  const outliers: number[] = []
  for (let i = 0; i < values.length; i++) {
    const z = Math.abs(zScore(values[i]!, mean, stdDev))
    if (z > threshold) outliers.push(i)
  }

  return outliers
}

/**
 * Winsorize values (cap extreme values)
 * Returns new array with outliers capped at percentile bounds
 */
export function winsorize(
  values: ArrayLike<number>,
  lowerPercentile = 0.05,
  upperPercentile = 0.95
): number[] {
  const sorted = Array.from(values).sort((a, b) => a - b)
  const lower = quantile(sorted, lowerPercentile)
  const upper = quantile(sorted, upperPercentile)

  return Array.from(values).map((v) =>
    Math.min(upper, Math.max(lower, v))
  )
}

/**
 * Compute rolling dispersion
 */
export function rollingDispersion(
  values: ArrayLike<number>,
  windowSize: number
): Dispersion[] {
  const result: Dispersion[] = []

  for (let i = 0; i <= values.length - windowSize; i++) {
    const window: number[] = []
    for (let j = 0; j < windowSize; j++) {
      window.push(values[i + j]!)
    }
    result.push(computeDispersion(window))
  }

  return result
}

/**
 * Summary statistics string
 */
export function dispersionSummary(d: Dispersion): string {
  if (d.n === 0) return 'No data'

  return [
    `n=${d.n}`,
    `μ=${d.mean.toFixed(4)}`,
    `σ=${d.stdDev.toFixed(4)}`,
    `med=${d.median.toFixed(4)}`,
    `IQR=${d.iqr.toFixed(4)}`,
    `range=[${d.min.toFixed(4)}, ${d.max.toFixed(4)}]`,
    `skew=${d.skewness.toFixed(2)}`,
    `kurt=${d.kurtosis.toFixed(2)}`,
  ].join(', ')
}
