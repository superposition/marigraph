/**
 * Welford's Online Algorithm
 * Streaming computation of mean, variance, skewness, and kurtosis
 * Single-pass, numerically stable
 */

export interface WelfordState {
  n: number
  mean: number
  m2: number // Sum of squared deviations (for variance)
  m3: number // For skewness
  m4: number // For kurtosis
  min: number
  max: number
}

/**
 * Create initial Welford state
 */
export function createWelford(): WelfordState {
  return {
    n: 0,
    mean: 0,
    m2: 0,
    m3: 0,
    m4: 0,
    min: Infinity,
    max: -Infinity,
  }
}

/**
 * Update Welford state with a new value
 * Uses Welford's online algorithm for numerical stability
 */
export function welfordUpdate(state: WelfordState, x: number): void {
  const n1 = state.n
  state.n++
  const n = state.n

  const delta = x - state.mean
  const deltaN = delta / n
  const deltaN2 = deltaN * deltaN
  const term1 = delta * deltaN * n1

  // Update mean
  state.mean += deltaN

  // Update higher moments (order matters!)
  // m4 must be updated before m3, m3 before m2
  state.m4 +=
    term1 * deltaN2 * (n * n - 3 * n + 3) +
    6 * deltaN2 * state.m2 -
    4 * deltaN * state.m3
  state.m3 += term1 * deltaN * (n - 2) - 3 * deltaN * state.m2
  state.m2 += term1

  // Update min/max
  state.min = Math.min(state.min, x)
  state.max = Math.max(state.max, x)
}

/**
 * Update Welford state with multiple values
 */
export function welfordUpdateBatch(state: WelfordState, values: ArrayLike<number>): void {
  for (let i = 0; i < values.length; i++) {
    welfordUpdate(state, values[i]!)
  }
}

/**
 * Merge two Welford states (parallel computation)
 */
export function welfordMerge(a: WelfordState, b: WelfordState): WelfordState {
  if (a.n === 0) return { ...b }
  if (b.n === 0) return { ...a }

  const n = a.n + b.n
  const delta = b.mean - a.mean
  const delta2 = delta * delta
  const delta3 = delta2 * delta
  const delta4 = delta2 * delta2

  const mean = (a.n * a.mean + b.n * b.mean) / n

  const m2 =
    a.m2 +
    b.m2 +
    delta2 * ((a.n * b.n) / n)

  const m3 =
    a.m3 +
    b.m3 +
    delta3 * ((a.n * b.n * (a.n - b.n)) / (n * n)) +
    3 * delta * ((a.n * b.m2 - b.n * a.m2) / n)

  const m4 =
    a.m4 +
    b.m4 +
    delta4 * ((a.n * b.n * (a.n * a.n - a.n * b.n + b.n * b.n)) / (n * n * n)) +
    6 * delta2 * ((a.n * a.n * b.m2 + b.n * b.n * a.m2) / (n * n)) +
    4 * delta * ((a.n * b.m3 - b.n * a.m3) / n)

  return {
    n,
    mean,
    m2,
    m3,
    m4,
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
  }
}

/**
 * Get population variance from Welford state
 */
export function welfordVariance(state: WelfordState): number {
  if (state.n < 1) return 0
  return state.m2 / state.n
}

/**
 * Get sample variance from Welford state
 */
export function welfordSampleVariance(state: WelfordState): number {
  if (state.n < 2) return 0
  return state.m2 / (state.n - 1)
}

/**
 * Get standard deviation from Welford state
 */
export function welfordStdDev(state: WelfordState): number {
  return Math.sqrt(welfordVariance(state))
}

/**
 * Get sample standard deviation from Welford state
 */
export function welfordSampleStdDev(state: WelfordState): number {
  return Math.sqrt(welfordSampleVariance(state))
}

/**
 * Get skewness from Welford state
 * Returns Fisher's definition (0 for normal distribution)
 */
export function welfordSkewness(state: WelfordState): number {
  if (state.n < 3 || state.m2 === 0) return 0
  const variance = state.m2 / state.n
  return (state.m3 / state.n) / Math.pow(variance, 1.5)
}

/**
 * Get excess kurtosis from Welford state
 * Returns Fisher's definition (0 for normal distribution)
 */
export function welfordKurtosis(state: WelfordState): number {
  if (state.n < 4 || state.m2 === 0) return 0
  const variance = state.m2 / state.n
  return (state.m4 / state.n) / (variance * variance) - 3
}

/**
 * Get all statistics from Welford state
 */
export interface WelfordStats {
  n: number
  mean: number
  variance: number
  stdDev: number
  skewness: number
  kurtosis: number
  min: number
  max: number
  range: number
}

export function welfordStats(state: WelfordState): WelfordStats {
  return {
    n: state.n,
    mean: state.mean,
    variance: welfordVariance(state),
    stdDev: welfordStdDev(state),
    skewness: welfordSkewness(state),
    kurtosis: welfordKurtosis(state),
    min: state.min,
    max: state.max,
    range: state.max - state.min,
  }
}

/**
 * Create Welford state from array (batch initialization)
 */
export function welfordFromArray(values: ArrayLike<number>): WelfordState {
  const state = createWelford()
  welfordUpdateBatch(state, values)
  return state
}
