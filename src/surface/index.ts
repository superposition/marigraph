/**
 * Surface module exports
 */

export {
  bilinearInterpolate,
  bicubicInterpolate,
  nearestInterpolate,
  interpolate,
  interpolateLine,
  resampleSurface,
  sliceAtX,
  sliceAtY,
  findIndex,
  lerp,
} from './interpolate.ts'
export type { InterpolationMethod } from './interpolate.ts'

export {
  sviTotalVariance,
  sviImpliedVol,
  sviVolAtStrike,
  sviDerivative,
  sviSecondDerivative,
  logMoneyness,
  checkCalendarArbitrage as sviCheckCalendar,
  checkButterflyArbitrage as sviCheckButterfly,
  sviRawToJumpWing,
  calibrateSVI,
  generateSVISmile,
  generateSVISurface,
  DEFAULT_SVI,
} from './svi.ts'
export type { SVIParams, SVIJumpWing, SVICalibrationInput } from './svi.ts'

export {
  checkCalendarArbitrage,
  checkButterflyArbitrage,
  checkVerticalArbitrage,
  checkAllArbitrage,
  smoothSurface,
  enforceArbitrageFree,
  formatArbitrageSummary,
} from './arbitrage.ts'
export type { ArbitrageViolation, ArbitrageCheckResult } from './arbitrage.ts'
