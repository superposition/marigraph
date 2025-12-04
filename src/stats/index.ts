/**
 * Statistics module exports
 */

export {
  createWelford,
  welfordUpdate,
  welfordUpdateBatch,
  welfordMerge,
  welfordVariance,
  welfordSampleVariance,
  welfordStdDev,
  welfordSampleStdDev,
  welfordSkewness,
  welfordKurtosis,
  welfordStats,
  welfordFromArray,
} from './welford.ts'
export type { WelfordState, WelfordStats } from './welford.ts'

export {
  computeDispersion,
  computeColumnDispersion,
  zScore,
  robustZScore,
  detectOutliersIQR,
  detectOutliersZScore,
  winsorize,
  rollingDispersion,
  dispersionSummary,
} from './dispersion.ts'
export type { Dispersion } from './dispersion.ts'

export {
  quantile,
  quantileUnsorted,
  quantiles,
  percentile,
  iqr,
  median,
  mad,
  fiveNumberSummary,
  deciles,
  quintiles,
  rank,
  percentileRank,
  boxPlotBounds,
  histogram,
} from './quantile.ts'
export type {
  InterpolationMethod,
  FiveNumberSummary,
  BoxPlotBounds,
  HistogramBin,
} from './quantile.ts'
