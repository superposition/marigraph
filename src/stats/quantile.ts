/**
 * Quantile and Percentile Calculations
 * Various interpolation methods for percentile computation
 */

export type InterpolationMethod =
  | 'linear' // Linear interpolation (default)
  | 'lower' // Floor index
  | 'higher' // Ceil index
  | 'nearest' // Nearest index
  | 'midpoint' // Average of lower and higher

/**
 * Compute quantile of sorted array
 * @param sorted - Pre-sorted array
 * @param p - Quantile (0 to 1)
 * @param method - Interpolation method
 */
export function quantile(
  sorted: ArrayLike<number>,
  p: number,
  method: InterpolationMethod = 'linear'
): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]!
  if (p <= 0) return sorted[0]!
  if (p >= 1) return sorted[n - 1]!

  const index = p * (n - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const frac = index - lower

  switch (method) {
    case 'lower':
      return sorted[lower]!
    case 'higher':
      return sorted[upper]!
    case 'nearest':
      return frac < 0.5 ? sorted[lower]! : sorted[upper]!
    case 'midpoint':
      return (sorted[lower]! + sorted[upper]!) / 2
    case 'linear':
    default:
      if (lower === upper) return sorted[lower]!
      return sorted[lower]! * (1 - frac) + sorted[upper]! * frac
  }
}

/**
 * Compute quantile of unsorted array
 * Creates a sorted copy internally
 */
export function quantileUnsorted(
  values: ArrayLike<number>,
  p: number,
  method: InterpolationMethod = 'linear'
): number {
  const sorted = Array.from(values).sort((a, b) => a - b)
  return quantile(sorted, p, method)
}

/**
 * Compute multiple quantiles at once (more efficient for multiple percentiles)
 */
export function quantiles(
  sorted: ArrayLike<number>,
  ps: number[],
  method: InterpolationMethod = 'linear'
): number[] {
  return ps.map((p) => quantile(sorted, p, method))
}

/**
 * Percentile (0-100 scale)
 */
export function percentile(
  sorted: ArrayLike<number>,
  p: number,
  method: InterpolationMethod = 'linear'
): number {
  return quantile(sorted, p / 100, method)
}

/**
 * Interquartile range (Q3 - Q1)
 */
export function iqr(sorted: ArrayLike<number>): number {
  return quantile(sorted, 0.75) - quantile(sorted, 0.25)
}

/**
 * Median (Q2)
 */
export function median(sorted: ArrayLike<number>): number {
  return quantile(sorted, 0.5)
}

/**
 * Median Absolute Deviation (MAD)
 * Robust measure of spread
 */
export function mad(sorted: ArrayLike<number>, medianValue?: number): number {
  const n = sorted.length
  if (n === 0) return NaN

  const med = medianValue ?? median(sorted)

  // Compute absolute deviations from median
  const deviations: number[] = []
  for (let i = 0; i < n; i++) {
    deviations.push(Math.abs(sorted[i]! - med))
  }

  // Return median of deviations
  deviations.sort((a, b) => a - b)
  return median(deviations)
}

/**
 * Five-number summary: min, Q1, median, Q3, max
 */
export interface FiveNumberSummary {
  min: number
  q1: number
  median: number
  q3: number
  max: number
}

export function fiveNumberSummary(sorted: ArrayLike<number>): FiveNumberSummary {
  const n = sorted.length
  if (n === 0) {
    return { min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN }
  }

  return {
    min: sorted[0]!,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[n - 1]!,
  }
}

/**
 * Deciles (10th, 20th, ..., 90th percentiles)
 */
export function deciles(sorted: ArrayLike<number>): number[] {
  return quantiles(sorted, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
}

/**
 * Quintiles (20th, 40th, 60th, 80th percentiles)
 */
export function quintiles(sorted: ArrayLike<number>): number[] {
  return quantiles(sorted, [0.2, 0.4, 0.6, 0.8])
}

/**
 * Rank of a value in the dataset (0-1)
 * Returns the fraction of values less than or equal to the given value
 */
export function rank(sorted: ArrayLike<number>, value: number): number {
  const n = sorted.length
  if (n === 0) return NaN

  let count = 0
  for (let i = 0; i < n; i++) {
    if (sorted[i]! <= value) count++
  }

  return count / n
}

/**
 * Percentile rank (0-100)
 */
export function percentileRank(sorted: ArrayLike<number>, value: number): number {
  return rank(sorted, value) * 100
}

/**
 * Box plot whisker bounds (1.5 * IQR method)
 */
export interface BoxPlotBounds {
  lowerWhisker: number
  q1: number
  median: number
  q3: number
  upperWhisker: number
  outliers: number[]
}

export function boxPlotBounds(sorted: ArrayLike<number>, k = 1.5): BoxPlotBounds {
  const n = sorted.length
  if (n === 0) {
    return {
      lowerWhisker: NaN,
      q1: NaN,
      median: NaN,
      q3: NaN,
      upperWhisker: NaN,
      outliers: [],
    }
  }

  const q1 = quantile(sorted, 0.25)
  const med = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const iqrVal = q3 - q1

  const lowerBound = q1 - k * iqrVal
  const upperBound = q3 + k * iqrVal

  // Find actual whisker positions (last non-outlier values)
  let lowerWhisker = sorted[0]!
  let upperWhisker = sorted[n - 1]!
  const outliers: number[] = []

  for (let i = 0; i < n; i++) {
    const v = sorted[i]!
    if (v >= lowerBound) {
      lowerWhisker = v
      break
    }
    outliers.push(v)
  }

  for (let i = n - 1; i >= 0; i--) {
    const v = sorted[i]!
    if (v <= upperBound) {
      upperWhisker = v
      break
    }
    outliers.push(v)
  }

  return {
    lowerWhisker,
    q1,
    median: med,
    q3,
    upperWhisker,
    outliers,
  }
}

/**
 * Histogram bins
 */
export interface HistogramBin {
  start: number
  end: number
  count: number
  frequency: number // count / total
}

export function histogram(
  values: ArrayLike<number>,
  binCount = 10
): HistogramBin[] {
  const n = values.length
  if (n === 0) return []

  let min = values[0]!
  let max = values[0]!
  for (let i = 1; i < n; i++) {
    min = Math.min(min, values[i]!)
    max = Math.max(max, values[i]!)
  }

  const range = max - min || 1
  const binWidth = range / binCount

  const bins: HistogramBin[] = []
  for (let i = 0; i < binCount; i++) {
    bins.push({
      start: min + i * binWidth,
      end: min + (i + 1) * binWidth,
      count: 0,
      frequency: 0,
    })
  }

  // Count values in each bin
  for (let i = 0; i < n; i++) {
    const v = values[i]!
    const binIndex = Math.min(
      Math.floor((v - min) / binWidth),
      binCount - 1
    )
    bins[binIndex]!.count++
  }

  // Compute frequencies
  for (const bin of bins) {
    bin.frequency = bin.count / n
  }

  return bins
}
