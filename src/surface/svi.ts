/**
 * SVI (Stochastic Volatility Inspired) Model
 * Parametric volatility smile model by Jim Gatheral
 *
 * The SVI model represents total implied variance as:
 * w(k) = a + b * (rho * (k - m) + sqrt((k - m)^2 + sigma^2))
 *
 * Where:
 *   k = log(K/F) = log-moneyness
 *   w = sigma^2 * T = total implied variance
 *   a = level of variance
 *   b = slope of wings
 *   rho = rotation (-1 to 1, negative = put skew)
 *   m = translation (ATM shift)
 *   sigma = smoothness of ATM region
 */

/**
 * SVI raw parameters
 */
export interface SVIParams {
  a: number // Variance level
  b: number // Wing slope
  rho: number // Rotation/skew (-1 to 1)
  m: number // Translation (log-moneyness shift)
  sigma: number // ATM smoothness
}

/**
 * SVI jump-wing parameters (alternative parameterization)
 */
export interface SVIJumpWing {
  v: number // ATM variance
  psi: number // ATM skew
  p: number // Left wing slope
  c: number // Right wing slope
  vTilde: number // Minimum variance
}

/**
 * Default SVI parameters (typical equity smile)
 */
export const DEFAULT_SVI: SVIParams = {
  a: 0.04, // 20% base vol squared
  b: 0.1, // Moderate wing slope
  rho: -0.4, // Typical put skew
  m: 0, // Centered at ATM
  sigma: 0.1, // Moderate smoothness
}

/**
 * Compute total variance using SVI raw parameterization
 * @param k - Log-moneyness: ln(K/F)
 * @param params - SVI parameters
 * @returns Total implied variance w = sigma^2 * T
 */
export function sviTotalVariance(k: number, params: SVIParams): number {
  const { a, b, rho, m, sigma } = params
  const km = k - m
  return a + b * (rho * km + Math.sqrt(km * km + sigma * sigma))
}

/**
 * Compute implied volatility from SVI parameters
 * @param k - Log-moneyness
 * @param T - Time to expiry in years
 * @param params - SVI parameters
 * @returns Implied volatility (annualized)
 */
export function sviImpliedVol(k: number, T: number, params: SVIParams): number {
  const w = sviTotalVariance(k, params)
  if (w < 0 || T <= 0) return 0
  return Math.sqrt(w / T)
}

/**
 * Compute log-moneyness from strike and forward
 */
export function logMoneyness(strike: number, forward: number): number {
  return Math.log(strike / forward)
}

/**
 * Compute implied volatility for given strike
 * @param strike - Strike price
 * @param forward - Forward price
 * @param T - Time to expiry
 * @param params - SVI parameters
 */
export function sviVolAtStrike(
  strike: number,
  forward: number,
  T: number,
  params: SVIParams
): number {
  const k = logMoneyness(strike, forward)
  return sviImpliedVol(k, T, params)
}

/**
 * SVI derivative with respect to log-moneyness
 * Used for local volatility and Greeks
 */
export function sviDerivative(k: number, params: SVIParams): number {
  const { b, rho, m, sigma } = params
  const km = k - m
  const sqrt_term = Math.sqrt(km * km + sigma * sigma)
  return b * (rho + km / sqrt_term)
}

/**
 * SVI second derivative
 */
export function sviSecondDerivative(k: number, params: SVIParams): number {
  const { b, m, sigma } = params
  const km = k - m
  const denom = Math.pow(km * km + sigma * sigma, 1.5)
  return (b * sigma * sigma) / denom
}

/**
 * Check for calendar arbitrage (variance must increase with time)
 * Returns true if arbitrage-free
 */
export function checkCalendarArbitrage(
  params1: SVIParams,
  T1: number,
  params2: SVIParams,
  T2: number,
  kRange: number[] = [-1, -0.5, 0, 0.5, 1]
): { arbitrageFree: boolean; violations: number[] } {
  if (T1 >= T2) {
    return { arbitrageFree: false, violations: [] }
  }

  const violations: number[] = []

  for (const k of kRange) {
    const w1 = sviTotalVariance(k, params1)
    const w2 = sviTotalVariance(k, params2)

    // Total variance should increase with time
    if (w2 < w1) {
      violations.push(k)
    }
  }

  return {
    arbitrageFree: violations.length === 0,
    violations,
  }
}

/**
 * Check for butterfly arbitrage (local variance must be positive)
 * Returns true if arbitrage-free
 */
export function checkButterflyArbitrage(
  params: SVIParams,
  T: number,
  kRange: number[] = [-1, -0.5, 0, 0.5, 1]
): { arbitrageFree: boolean; violations: number[] } {
  const violations: number[] = []

  for (const k of kRange) {
    const w = sviTotalVariance(k, params)
    const dw = sviDerivative(k, params)
    const d2w = sviSecondDerivative(k, params)

    // g(k) = (1 - k*w'/2w)^2 - w'^2/4 * (1/w + 1/4) + w''/2
    // Must have g(k) >= 0 for no butterfly arbitrage
    const g =
      Math.pow(1 - (k * dw) / (2 * w), 2) -
      (dw * dw) / 4 * (1 / w + 0.25) +
      d2w / 2

    if (g < 0) {
      violations.push(k)
    }
  }

  return {
    arbitrageFree: violations.length === 0,
    violations,
  }
}

/**
 * Convert SVI raw to jump-wing parameters
 */
export function sviRawToJumpWing(params: SVIParams, T: number): SVIJumpWing {
  const { a, b, rho, m, sigma } = params

  const w_atm = a + b * sigma * Math.sqrt(1 - rho * rho)
  const v = w_atm / T

  // ATM skew
  const psi = (b / Math.sqrt(w_atm)) * (rho / Math.sqrt(1 - rho * rho))

  // Wing slopes
  const p = (b * (1 - rho)) / Math.sqrt(w_atm)
  const c = (b * (1 + rho)) / Math.sqrt(w_atm)

  // Minimum variance
  const vTilde = (a + b * sigma * Math.sqrt(1 - rho * rho) * (1 - rho)) / T

  return { v, psi, p, c, vTilde }
}

/**
 * Simple SVI calibration using least squares
 * Fits SVI parameters to market implied volatilities
 */
export interface SVICalibrationInput {
  k: number // Log-moneyness
  iv: number // Market implied volatility
  weight?: number // Optional weight
}

export function calibrateSVI(
  data: SVICalibrationInput[],
  T: number,
  initialParams: SVIParams = DEFAULT_SVI,
  maxIter = 100,
  tolerance = 1e-6
): { params: SVIParams; rmse: number; iterations: number } {
  // Convert IVs to total variance
  const targets = data.map((d) => ({
    k: d.k,
    w: d.iv * d.iv * T,
    weight: d.weight ?? 1,
  }))

  // Simple gradient descent (in production, use Levenberg-Marquardt)
  let params = { ...initialParams }
  let prevRmse = Infinity

  const learningRate = 0.01
  const paramNames: (keyof SVIParams)[] = ['a', 'b', 'rho', 'm', 'sigma']

  for (let iter = 0; iter < maxIter; iter++) {
    // Compute RMSE
    let sumSqError = 0
    let sumWeight = 0

    for (const t of targets) {
      const wModel = sviTotalVariance(t.k, params)
      const error = wModel - t.w
      sumSqError += t.weight * error * error
      sumWeight += t.weight
    }

    const rmse = Math.sqrt(sumSqError / sumWeight)

    if (Math.abs(prevRmse - rmse) < tolerance) {
      return { params, rmse, iterations: iter }
    }
    prevRmse = rmse

    // Compute numerical gradients and update
    const eps = 1e-6
    for (const name of paramNames) {
      const original = params[name]

      // Forward difference
      params[name] = original + eps
      let fwdError = 0
      for (const t of targets) {
        const wModel = sviTotalVariance(t.k, params)
        fwdError += t.weight * Math.pow(wModel - t.w, 2)
      }

      // Backward difference
      params[name] = original - eps
      let bwdError = 0
      for (const t of targets) {
        const wModel = sviTotalVariance(t.k, params)
        bwdError += t.weight * Math.pow(wModel - t.w, 2)
      }

      // Gradient
      const gradient = (fwdError - bwdError) / (2 * eps)

      // Update with constraints
      params[name] = original - learningRate * gradient

      // Apply constraints
      if (name === 'rho') {
        params.rho = Math.max(-0.99, Math.min(0.99, params.rho))
      } else if (name === 'b' || name === 'sigma') {
        params[name] = Math.max(0.001, params[name])
      }
    }
  }

  // Final RMSE
  let sumSqError = 0
  let sumWeight = 0
  for (const t of targets) {
    const wModel = sviTotalVariance(t.k, params)
    sumSqError += t.weight * Math.pow(wModel - t.w, 2)
    sumWeight += t.weight
  }

  return {
    params,
    rmse: Math.sqrt(sumSqError / sumWeight),
    iterations: maxIter,
  }
}

/**
 * Generate SVI smile for plotting
 */
export function generateSVISmile(
  params: SVIParams,
  T: number,
  kMin = -1,
  kMax = 1,
  numPoints = 50
): { k: number; iv: number }[] {
  const result: { k: number; iv: number }[] = []
  const step = (kMax - kMin) / (numPoints - 1)

  for (let i = 0; i < numPoints; i++) {
    const k = kMin + i * step
    const iv = sviImpliedVol(k, T, params)
    result.push({ k, iv })
  }

  return result
}

/**
 * Generate SVI surface (multiple expiries)
 */
export function generateSVISurface(
  paramsByExpiry: Map<number, SVIParams>,
  kMin = -1,
  kMax = 1,
  kPoints = 20
): { T: number; k: number; iv: number }[] {
  const result: { T: number; k: number; iv: number }[] = []
  const kStep = (kMax - kMin) / (kPoints - 1)

  for (const [T, params] of paramsByExpiry) {
    for (let i = 0; i < kPoints; i++) {
      const k = kMin + i * kStep
      const iv = sviImpliedVol(k, T, params)
      result.push({ T, k, iv })
    }
  }

  return result
}
