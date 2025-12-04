/**
 * Extensive tests for statistics modules
 * Tests Welford's algorithm, dispersion metrics, and quantile calculations
 */

import { describe, it, expect } from 'bun:test'
import {
  createWelford,
  welfordUpdate,
  welfordUpdateBatch,
  welfordMerge,
  welfordVariance,
  welfordSampleVariance,
  welfordStdDev,
  welfordSkewness,
  welfordKurtosis,
  welfordStats,
  welfordFromArray,
} from './welford.ts'
import {
  computeDispersion,
  zScore,
  robustZScore,
  detectOutliersIQR,
  detectOutliersZScore,
  winsorize,
  rollingDispersion,
  dispersionSummary,
} from './dispersion.ts'
import {
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

// Helper to check approximate equality
const approxEqual = (a: number, b: number, epsilon = 1e-10) =>
  Math.abs(a - b) < epsilon

// Test data sets
const normalData = [2.3, 1.8, 2.1, 2.5, 1.9, 2.0, 2.2, 2.4, 1.7, 2.6]
const skewedData = [1, 1, 1, 2, 2, 3, 5, 10, 20, 100]
const uniformData = Array.from({ length: 100 }, (_, i) => i + 1)
const constantData = [5, 5, 5, 5, 5]
const twoValues = [10, 20]
const singleValue = [42]
const emptyData: number[] = []

describe('Welford Algorithm', () => {
  describe('Basic operations', () => {
    it('should initialize with zero count', () => {
      const state = createWelford()
      expect(state.n).toBe(0)
      expect(state.mean).toBe(0)
      expect(state.m2).toBe(0)
    })

    it('should update correctly with single value', () => {
      const state = createWelford()
      welfordUpdate(state, 5)
      expect(state.n).toBe(1)
      expect(state.mean).toBe(5)
      expect(state.min).toBe(5)
      expect(state.max).toBe(5)
    })

    it('should update correctly with multiple values', () => {
      const state = createWelford()
      welfordUpdate(state, 2)
      welfordUpdate(state, 4)
      welfordUpdate(state, 6)
      expect(state.n).toBe(3)
      expect(state.mean).toBe(4)
      expect(state.min).toBe(2)
      expect(state.max).toBe(6)
    })

    it('should batch update correctly', () => {
      const state = createWelford()
      welfordUpdateBatch(state, [2, 4, 6])
      expect(state.n).toBe(3)
      expect(state.mean).toBe(4)
    })

    it('should create from array', () => {
      const state = welfordFromArray(normalData)
      expect(state.n).toBe(10)
      expect(approxEqual(state.mean, 2.15, 0.01)).toBe(true)
    })
  })

  describe('Variance and Standard Deviation', () => {
    it('should compute population variance correctly', () => {
      const state = welfordFromArray([2, 4, 4, 4, 5, 5, 7, 9])
      const variance = welfordVariance(state)
      expect(approxEqual(variance, 4.0, 0.01)).toBe(true)
    })

    it('should compute sample variance correctly', () => {
      const state = welfordFromArray([2, 4, 4, 4, 5, 5, 7, 9])
      const sampleVar = welfordSampleVariance(state)
      expect(approxEqual(sampleVar, 4.571, 0.01)).toBe(true)
    })

    it('should compute standard deviation correctly', () => {
      const state = welfordFromArray([2, 4, 4, 4, 5, 5, 7, 9])
      const stdDev = welfordStdDev(state)
      expect(approxEqual(stdDev, 2.0, 0.01)).toBe(true)
    })

    it('should return 0 variance for constant data', () => {
      const state = welfordFromArray(constantData)
      expect(welfordVariance(state)).toBe(0)
      expect(welfordStdDev(state)).toBe(0)
    })

    it('should return 0 variance for empty data', () => {
      const state = createWelford()
      expect(welfordVariance(state)).toBe(0)
    })

    it('should return 0 sample variance for single value', () => {
      const state = welfordFromArray(singleValue)
      expect(welfordSampleVariance(state)).toBe(0)
    })
  })

  describe('Skewness', () => {
    it('should return near-zero skewness for symmetric data', () => {
      const symmetric = [1, 2, 3, 4, 5, 5, 4, 3, 2, 1]
      const state = welfordFromArray(symmetric)
      expect(Math.abs(welfordSkewness(state))).toBeLessThan(0.1)
    })

    it('should return positive skewness for right-skewed data', () => {
      const state = welfordFromArray(skewedData)
      expect(welfordSkewness(state)).toBeGreaterThan(0)
    })

    it('should return negative skewness for left-skewed data', () => {
      const leftSkewed = skewedData.map((x) => -x + 101) // Mirror the skewed data
      const state = welfordFromArray(leftSkewed)
      expect(welfordSkewness(state)).toBeLessThan(0)
    })

    it('should return 0 for constant data', () => {
      const state = welfordFromArray(constantData)
      expect(welfordSkewness(state)).toBe(0)
    })

    it('should return 0 for insufficient data', () => {
      const state = welfordFromArray(twoValues)
      expect(welfordSkewness(state)).toBe(0)
    })
  })

  describe('Kurtosis', () => {
    it('should return near-zero excess kurtosis for normal-like data', () => {
      // Generate pseudo-normal data
      const normal = Array.from({ length: 1000 }, () => {
        // Box-Muller transform approximation
        let u = 0, v = 0
        while (u === 0) u = Math.random()
        while (v === 0) v = Math.random()
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      })
      const state = welfordFromArray(normal)
      const kurtosis = welfordKurtosis(state)
      // Normal distribution has excess kurtosis of 0
      expect(Math.abs(kurtosis)).toBeLessThan(0.5)
    })

    it('should return high kurtosis for heavy-tailed data', () => {
      const heavyTail = [1, 1, 1, 1, 1, 1, 1, 1, 100, -100]
      const state = welfordFromArray(heavyTail)
      expect(welfordKurtosis(state)).toBeGreaterThan(1)
    })

    it('should return negative kurtosis for uniform data', () => {
      const state = welfordFromArray(uniformData)
      // Uniform distribution has excess kurtosis of -1.2
      expect(welfordKurtosis(state)).toBeLessThan(0)
    })

    it('should return 0 for constant data', () => {
      const state = welfordFromArray(constantData)
      expect(welfordKurtosis(state)).toBe(0)
    })
  })

  describe('Merge operation', () => {
    it('should merge two states correctly', () => {
      const a = welfordFromArray([1, 2, 3])
      const b = welfordFromArray([4, 5, 6])
      const merged = welfordMerge(a, b)

      const combined = welfordFromArray([1, 2, 3, 4, 5, 6])

      expect(merged.n).toBe(combined.n)
      expect(approxEqual(merged.mean, combined.mean, 0.001)).toBe(true)
      expect(approxEqual(welfordVariance(merged), welfordVariance(combined), 0.001)).toBe(true)
    })

    it('should handle merging with empty state', () => {
      const a = welfordFromArray([1, 2, 3])
      const empty = createWelford()

      const merged1 = welfordMerge(a, empty)
      expect(merged1.n).toBe(a.n)
      expect(merged1.mean).toBe(a.mean)

      const merged2 = welfordMerge(empty, a)
      expect(merged2.n).toBe(a.n)
    })

    it('should preserve min/max correctly', () => {
      const a = welfordFromArray([5, 10, 15])
      const b = welfordFromArray([1, 20])
      const merged = welfordMerge(a, b)

      expect(merged.min).toBe(1)
      expect(merged.max).toBe(20)
    })
  })

  describe('welfordStats', () => {
    it('should return all statistics', () => {
      const state = welfordFromArray(normalData)
      const stats = welfordStats(state)

      expect(stats.n).toBe(10)
      expect(typeof stats.mean).toBe('number')
      expect(typeof stats.variance).toBe('number')
      expect(typeof stats.stdDev).toBe('number')
      expect(typeof stats.skewness).toBe('number')
      expect(typeof stats.kurtosis).toBe('number')
      expect(stats.min).toBe(Math.min(...normalData))
      expect(stats.max).toBe(Math.max(...normalData))
      expect(stats.range).toBe(stats.max - stats.min)
    })
  })
})

describe('Quantile Calculations', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  describe('Basic quantile', () => {
    it('should return min for p=0', () => {
      expect(quantile(sorted, 0)).toBe(1)
    })

    it('should return max for p=1', () => {
      expect(quantile(sorted, 1)).toBe(10)
    })

    it('should return median for p=0.5', () => {
      expect(quantile(sorted, 0.5)).toBe(5.5)
    })

    it('should return Q1 for p=0.25', () => {
      expect(quantile(sorted, 0.25)).toBe(3.25)
    })

    it('should return Q3 for p=0.75', () => {
      expect(quantile(sorted, 0.75)).toBe(7.75)
    })

    it('should handle single element', () => {
      expect(quantile([42], 0.5)).toBe(42)
    })

    it('should return NaN for empty array', () => {
      expect(quantile([], 0.5)).toBeNaN()
    })
  })

  describe('Interpolation methods', () => {
    it('should use lower interpolation', () => {
      expect(quantile(sorted, 0.5, 'lower')).toBe(5)
    })

    it('should use higher interpolation', () => {
      expect(quantile(sorted, 0.5, 'higher')).toBe(6)
    })

    it('should use nearest interpolation', () => {
      expect(quantile(sorted, 0.45, 'nearest')).toBe(5)
      expect(quantile(sorted, 0.55, 'nearest')).toBe(6)
    })

    it('should use midpoint interpolation', () => {
      expect(quantile(sorted, 0.5, 'midpoint')).toBe(5.5)
    })
  })

  describe('quantileUnsorted', () => {
    it('should work with unsorted data', () => {
      const unsorted = [5, 2, 8, 1, 9, 3, 7, 4, 6, 10]
      expect(quantileUnsorted(unsorted, 0.5)).toBe(5.5)
    })
  })

  describe('Multiple quantiles', () => {
    it('should compute multiple quantiles', () => {
      const result = quantiles(sorted, [0.25, 0.5, 0.75])
      expect(result.length).toBe(3)
      expect(result[0]).toBe(3.25)
      expect(result[1]).toBe(5.5)
      expect(result[2]).toBe(7.75)
    })
  })

  describe('Percentile', () => {
    it('should compute percentile correctly', () => {
      expect(percentile(sorted, 50)).toBe(5.5)
      expect(percentile(sorted, 25)).toBe(3.25)
    })
  })

  describe('IQR', () => {
    it('should compute interquartile range', () => {
      const result = iqr(sorted)
      expect(result).toBe(7.75 - 3.25)
    })
  })

  describe('Median', () => {
    it('should compute median for even count', () => {
      expect(median(sorted)).toBe(5.5)
    })

    it('should compute median for odd count', () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3)
    })
  })

  describe('MAD', () => {
    it('should compute median absolute deviation', () => {
      const data = [1, 1, 2, 2, 4, 6, 9]
      const sorted = [...data].sort((a, b) => a - b)
      const med = median(sorted)
      const madVal = mad(sorted, med)
      // MAD = median of |x - median|
      expect(madVal).toBeGreaterThan(0)
    })

    it('should return 0 for constant data', () => {
      const sorted = [5, 5, 5, 5, 5]
      expect(mad(sorted)).toBe(0)
    })
  })

  describe('Five number summary', () => {
    it('should compute five number summary', () => {
      const summary = fiveNumberSummary(sorted)
      expect(summary.min).toBe(1)
      expect(summary.q1).toBe(3.25)
      expect(summary.median).toBe(5.5)
      expect(summary.q3).toBe(7.75)
      expect(summary.max).toBe(10)
    })

    it('should handle empty array', () => {
      const summary = fiveNumberSummary([])
      expect(summary.min).toBeNaN()
    })
  })

  describe('Deciles and Quintiles', () => {
    it('should compute deciles', () => {
      const result = deciles(sorted)
      expect(result.length).toBe(9)
    })

    it('should compute quintiles', () => {
      const result = quintiles(sorted)
      expect(result.length).toBe(4)
    })
  })

  describe('Rank', () => {
    it('should compute rank correctly', () => {
      expect(rank(sorted, 5)).toBe(0.5)
      expect(rank(sorted, 1)).toBe(0.1)
      expect(rank(sorted, 10)).toBe(1)
    })

    it('should compute percentile rank', () => {
      expect(percentileRank(sorted, 5)).toBe(50)
    })
  })

  describe('Box plot bounds', () => {
    it('should compute box plot bounds', () => {
      const bounds = boxPlotBounds(sorted)
      expect(bounds.q1).toBe(3.25)
      expect(bounds.median).toBe(5.5)
      expect(bounds.q3).toBe(7.75)
      expect(bounds.outliers.length).toBe(0)
    })

    it('should detect outliers', () => {
      const withOutliers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
      const sorted = [...withOutliers].sort((a, b) => a - b)
      const bounds = boxPlotBounds(sorted)
      expect(bounds.outliers.length).toBeGreaterThan(0)
      expect(bounds.outliers).toContain(100)
    })
  })

  describe('Histogram', () => {
    it('should create histogram bins', () => {
      const bins = histogram(uniformData, 10)
      expect(bins.length).toBe(10)
      bins.forEach((bin) => {
        expect(bin.count).toBe(10) // 100 values / 10 bins
        expect(bin.frequency).toBe(0.1)
      })
    })

    it('should handle empty data', () => {
      const bins = histogram([])
      expect(bins.length).toBe(0)
    })
  })
})

describe('Dispersion Metrics', () => {
  describe('computeDispersion', () => {
    it('should compute all dispersion metrics', () => {
      const disp = computeDispersion(normalData)

      expect(disp.n).toBe(10)
      expect(typeof disp.mean).toBe('number')
      expect(typeof disp.median).toBe('number')
      expect(typeof disp.variance).toBe('number')
      expect(typeof disp.stdDev).toBe('number')
      expect(typeof disp.iqr).toBe('number')
      expect(typeof disp.mad).toBe('number')
      expect(typeof disp.skewness).toBe('number')
      expect(typeof disp.kurtosis).toBe('number')
    })

    it('should handle empty data', () => {
      const disp = computeDispersion([])
      expect(disp.n).toBe(0)
      expect(disp.mean).toBeNaN()
    })

    it('should compute coefficient of variation', () => {
      const disp = computeDispersion(normalData)
      expect(disp.coefficientOfVariation).toBe(disp.stdDev / Math.abs(disp.mean))
    })

    it('should compute MAD-based std dev', () => {
      const disp = computeDispersion(normalData)
      expect(disp.madStdDev).toBe(disp.mad * 1.4826)
    })

    it('should compute percentiles', () => {
      const disp = computeDispersion(uniformData)
      expect(disp.p5).toBeLessThan(disp.p10)
      expect(disp.p10).toBeLessThan(disp.median)
      expect(disp.median).toBeLessThan(disp.p90)
      expect(disp.p90).toBeLessThan(disp.p95)
    })
  })

  describe('Z-score', () => {
    it('should compute z-score correctly', () => {
      expect(zScore(10, 10, 2)).toBe(0)
      expect(zScore(12, 10, 2)).toBe(1)
      expect(zScore(8, 10, 2)).toBe(-1)
    })

    it('should return 0 for zero std dev', () => {
      expect(zScore(10, 10, 0)).toBe(0)
    })
  })

  describe('Robust Z-score', () => {
    it('should compute robust z-score', () => {
      const z = robustZScore(10, 8, 2)
      expect(z).toBeCloseTo((10 - 8) / (2 * 1.4826))
    })

    it('should return 0 for zero MAD', () => {
      expect(robustZScore(10, 10, 0)).toBe(0)
    })
  })

  describe('Outlier detection', () => {
    it('should detect outliers using IQR', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
      const { lower, upper } = detectOutliersIQR(data)
      expect(upper.length).toBeGreaterThan(0)
    })

    it('should detect outliers using z-score', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
      const outliers = detectOutliersZScore(data, 2)
      expect(outliers.length).toBeGreaterThan(0)
    })

    it('should return empty for no outliers', () => {
      const { lower, upper } = detectOutliersIQR(normalData)
      expect(lower.length).toBe(0)
      expect(upper.length).toBe(0)
    })
  })

  describe('Winsorize', () => {
    it('should cap extreme values', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
      const winsorized = winsorize(data, 0.1, 0.9)
      expect(Math.max(...winsorized)).toBeLessThan(100)
    })

    it('should preserve middle values', () => {
      const data = [1, 2, 3, 4, 5]
      const winsorized = winsorize(data, 0.2, 0.8)
      expect(winsorized[2]).toBe(3)
    })
  })

  describe('Rolling dispersion', () => {
    it('should compute rolling statistics', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const rolling = rollingDispersion(data, 3)
      expect(rolling.length).toBe(8) // 10 - 3 + 1
      rolling.forEach((d) => {
        expect(d.n).toBe(3)
      })
    })
  })

  describe('Dispersion summary', () => {
    it('should generate summary string', () => {
      const disp = computeDispersion(normalData)
      const summary = dispersionSummary(disp)
      expect(summary).toContain('n=10')
      expect(summary).toContain('μ=')
      expect(summary).toContain('σ=')
    })

    it('should handle empty data', () => {
      const disp = computeDispersion([])
      expect(dispersionSummary(disp)).toBe('No data')
    })
  })
})

describe('Edge cases and numerical stability', () => {
  it('should handle very large numbers', () => {
    const large = [1e15, 1e15 + 1, 1e15 + 2]
    const state = welfordFromArray(large)
    expect(state.mean).toBeCloseTo(1e15 + 1)
    expect(welfordVariance(state)).toBeGreaterThan(0)
  })

  it('should handle very small numbers', () => {
    const small = [1e-15, 2e-15, 3e-15]
    const state = welfordFromArray(small)
    expect(state.mean).toBeCloseTo(2e-15)
  })

  it('should handle mixed positive and negative', () => {
    const mixed = [-100, -50, 0, 50, 100]
    const state = welfordFromArray(mixed)
    expect(state.mean).toBe(0)
    expect(state.min).toBe(-100)
    expect(state.max).toBe(100)
  })

  it('should handle repeated values', () => {
    const repeated = [1, 1, 1, 1, 2, 2, 2, 2]
    const disp = computeDispersion(repeated)
    expect(disp.median).toBe(1.5)
  })

  it('should handle single large outlier', () => {
    const data = Array(99).fill(0).concat([1000])
    const disp = computeDispersion(data)
    expect(disp.mean).toBe(10)
    expect(disp.median).toBe(0)
    expect(disp.mad).toBe(0)
  })
})
